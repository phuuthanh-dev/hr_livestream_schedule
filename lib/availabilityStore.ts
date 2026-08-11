import type { Collection } from "mongodb";
import { getMongoClient, getMongoDatabase } from "@/lib/mongodb";
import { findActiveSchedulePerson } from "@/lib/employeeRoster";
import { DEFAULT_HOST_LOCATION_PREFERENCE, DEFAULT_SCHEDULE_SLOTS } from "@/lib/scheduleConfig";
import {
  addDaysToScheduleDateKey,
  getScheduleWeekDateKeys,
  getScheduleWeekStartKey,
  isValidScheduleDateKey
} from "@/lib/scheduleDate";
import type {
  AvailabilityLocationPreference,
  AvailabilityPayload,
  AvailabilitySlot,
  AvailabilitySummary,
  AvailabilityWeek,
  AvailabilityWeekStatus,
  EmployeeRole
} from "@/lib/types";

const AVAILABILITY_WEEK_COLLECTION = "schedule_availability_weeks";
const AVAILABILITY_SLOT_COLLECTION = "schedule_availability_slots";

type AvailabilityWeekDocument = {
  personKey: string;
  role: EmployeeRole;
  employeeId: string;
  normalizedEmployeeId: string;
  weekStartKey: string;
  status: AvailabilityWeekStatus;
  submittedAt?: Date | null;
  lockedAt?: Date | null;
  lockedReason?: string;
  updatedAt: Date;
  updatedBy: string;
};

type AvailabilitySlotDocument = {
  personKey: string;
  role: EmployeeRole;
  employeeId: string;
  normalizedEmployeeId: string;
  weekStartKey: string;
  dateKey: string;
  slot: string;
  available: true;
  locationPreference?: AvailabilityLocationPreference;
  note?: string;
  updatedAt: Date;
  updatedBy: string;
};

type SaveAvailabilityWeekInput = {
  role: EmployeeRole;
  employeeId: string;
  weekStartKey: string;
  slots: AvailabilitySlot[];
  actorAccountKey: string;
  allowLockedOverwrite?: boolean;
};

type SubmitAvailabilityWeekInput = {
  role: EmployeeRole;
  employeeId: string;
  weekStartKey: string;
  actorAccountKey: string;
  allowLockedOverwrite?: boolean;
};

let availabilityIndexesPromise: Promise<void> | null = null;

function normalizeEmployeeId(employeeId: string) {
  return employeeId.trim().toLowerCase();
}

function buildPersonKey(role: EmployeeRole, employeeId: string) {
  return `${role}:${normalizeEmployeeId(employeeId)}`;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeWeekStartKey(value?: string) {
  if (value && isValidScheduleDateKey(value)) {
    return getScheduleWeekStartKey(value);
  }
  return getScheduleWeekStartKey();
}

function isValidSlot(value: string) {
  return DEFAULT_SCHEDULE_SLOTS.includes(value as (typeof DEFAULT_SCHEDULE_SLOTS)[number]);
}

function normalizeLocationPreference(
  role: EmployeeRole,
  value: unknown
): AvailabilityLocationPreference | undefined {
  if (role !== "host") return undefined;
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "home" || normalized === "studio" || normalized === "both") {
    return normalized;
  }
  return DEFAULT_HOST_LOCATION_PREFERENCE;
}

function compareWeekSlots(left: AvailabilitySlot, right: AvailabilitySlot) {
  if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey);
  const leftIndex = DEFAULT_SCHEDULE_SLOTS.indexOf(left.slot as (typeof DEFAULT_SCHEDULE_SLOTS)[number]);
  const rightIndex = DEFAULT_SCHEDULE_SLOTS.indexOf(right.slot as (typeof DEFAULT_SCHEDULE_SLOTS)[number]);
  return leftIndex - rightIndex;
}

function buildAvailabilitySummary(slots: AvailabilitySlot[]): AvailabilitySummary {
  return slots.reduce<AvailabilitySummary>(
    (summary, slot) => {
      if (!slot.available) return summary;
      summary.availableSlots += 1;
      if (slot.locationPreference === "home") summary.availableHome += 1;
      if (slot.locationPreference === "studio") summary.availableStudio += 1;
      if (slot.locationPreference === "both" || !slot.locationPreference) summary.availableBoth += 1;
      return summary;
    },
    {
      totalSlots: DEFAULT_SCHEDULE_SLOTS.length * 7,
      availableSlots: 0,
      availableHome: 0,
      availableStudio: 0,
      availableBoth: 0
    }
  );
}

async function getCollections(): Promise<{
  weeks: Collection<AvailabilityWeekDocument>;
  slots: Collection<AvailabilitySlotDocument>;
}> {
  const database = await getMongoDatabase();
  const weeks = database.collection<AvailabilityWeekDocument>(AVAILABILITY_WEEK_COLLECTION);
  const slots = database.collection<AvailabilitySlotDocument>(AVAILABILITY_SLOT_COLLECTION);

  if (!availabilityIndexesPromise) {
    availabilityIndexesPromise = (async () => {
      await Promise.all([
        weeks.createIndex({ personKey: 1, weekStartKey: 1 }, { unique: true }),
        weeks.createIndex({ weekStartKey: 1, status: 1, role: 1 }),
        slots.createIndex({ personKey: 1, dateKey: 1, slot: 1 }, { unique: true }),
        slots.createIndex({ weekStartKey: 1, role: 1, dateKey: 1, slot: 1 }),
        slots.createIndex({ weekStartKey: 1, employeeId: 1, role: 1 })
      ]);
    })().catch((error) => {
      availabilityIndexesPromise = null;
      throw error;
    });
  }

  await availabilityIndexesPromise;
  return { weeks, slots };
}

function normalizeIncomingSlots(
  role: EmployeeRole,
  weekStartKey: string,
  slots: AvailabilitySlot[]
): AvailabilitySlot[] {
  const weekDateKeys = new Set(getScheduleWeekDateKeys(weekStartKey));
  const normalizedByKey = new Map<string, AvailabilitySlot>();

  (slots || []).forEach((slot) => {
    if (!slot || slot.available !== true) return;
    const dateKey = normalizeText(slot.dateKey);
    const slotLabel = normalizeText(slot.slot);
    if (!weekDateKeys.has(dateKey) || !isValidSlot(slotLabel)) return;

    const normalizedSlot: AvailabilitySlot = {
      dateKey,
      slot: slotLabel,
      available: true,
      locationPreference: normalizeLocationPreference(role, slot.locationPreference),
      note: normalizeText(slot.note) || undefined
    };
    normalizedByKey.set(`${dateKey}__${slotLabel}`, normalizedSlot);
  });

  return Array.from(normalizedByKey.values()).sort(compareWeekSlots);
}

async function buildAvailabilityWeek(
  role: EmployeeRole,
  employeeId: string,
  weekStartKey: string,
  weekDocument?: AvailabilityWeekDocument | null,
  slotDocuments?: AvailabilitySlotDocument[]
): Promise<AvailabilityWeek> {
  const person = await findActiveSchedulePerson(role, employeeId);
  if (!person) {
    throw new Error("Không tìm thấy nhân sự hoạt động cho lịch rảnh.");
  }

  const slots = (slotDocuments || [])
    .map<AvailabilitySlot>((document) => ({
      dateKey: document.dateKey,
      slot: document.slot,
      available: true,
      locationPreference: document.locationPreference,
      note: document.note,
      updatedAt: document.updatedAt.toISOString()
    }))
    .sort(compareWeekSlots);

  return {
    weekStartKey,
    role,
    employeeId: person.id,
    employeeName: person.name,
    status: weekDocument?.status || "draft",
    submittedAt: weekDocument?.submittedAt ? weekDocument.submittedAt.toISOString() : undefined,
    lockedAt: weekDocument?.lockedAt ? weekDocument.lockedAt.toISOString() : undefined,
    lockedReason: weekDocument?.lockedReason || undefined,
    slots
  };
}

export async function getAvailabilityWeekForPerson(
  role: EmployeeRole,
  employeeId: string,
  requestedWeekStartKey?: string
): Promise<AvailabilityPayload> {
  const weekStartKey = normalizeWeekStartKey(requestedWeekStartKey);
  const { weeks, slots } = await getCollections();
  const personKey = buildPersonKey(role, employeeId);

  const [weekDocument, slotDocuments] = await Promise.all([
    weeks.findOne({ personKey, weekStartKey }),
    slots.find({ personKey, weekStartKey }).toArray()
  ]);

  const week = await buildAvailabilityWeek(role, employeeId, weekStartKey, weekDocument, slotDocuments);

  return {
    success: true,
    target: {
      role: week.role,
      employeeId: week.employeeId,
      employeeName: week.employeeName
    },
    week,
    summary: buildAvailabilitySummary(week.slots)
  };
}

export async function saveAvailabilityWeek(
  input: SaveAvailabilityWeekInput
): Promise<AvailabilityPayload> {
  const weekStartKey = normalizeWeekStartKey(input.weekStartKey);
  const role = input.role;
  const employeeId = normalizeText(input.employeeId);
  const actorAccountKey = normalizeText(input.actorAccountKey) || "system";
  const personKey = buildPersonKey(role, employeeId);
  const normalizedSlots = normalizeIncomingSlots(role, weekStartKey, input.slots);
  const { weeks, slots } = await getCollections();
  const client = await getMongoClient();
  const now = new Date();

  await client.withSession(async (mongoSession) => {
    await mongoSession.withTransaction(async () => {
      const existingWeek = await weeks.findOne({ personKey, weekStartKey }, { session: mongoSession });
      if (existingWeek?.status === "locked" && !input.allowLockedOverwrite) {
        throw new Error("Tuần này đã bị khóa nên bạn không thể chỉnh lịch rảnh.");
      }

      await slots.deleteMany({ personKey, weekStartKey }, { session: mongoSession });

      if (normalizedSlots.length > 0) {
        await slots.insertMany(
          normalizedSlots.map((slot) => ({
            personKey,
            role,
            employeeId,
            normalizedEmployeeId: normalizeEmployeeId(employeeId),
            weekStartKey,
            dateKey: slot.dateKey,
            slot: slot.slot,
            available: true,
            locationPreference: slot.locationPreference,
            note: slot.note,
            updatedAt: now,
            updatedBy: actorAccountKey
          })),
          { session: mongoSession }
        );
      }

      await weeks.updateOne(
        { personKey, weekStartKey },
        {
          $set: {
            role,
            employeeId,
            normalizedEmployeeId: normalizeEmployeeId(employeeId),
            weekStartKey,
            status: existingWeek?.status || "draft",
            submittedAt: existingWeek?.submittedAt || null,
            lockedAt: existingWeek?.lockedAt || null,
            lockedReason: existingWeek?.lockedReason || "",
            updatedAt: now,
            updatedBy: actorAccountKey
          },
          $setOnInsert: {
            personKey
          }
        },
        { upsert: true, session: mongoSession }
      );
    });
  });

  return getAvailabilityWeekForPerson(role, employeeId, weekStartKey);
}

export async function submitAvailabilityWeek(
  input: SubmitAvailabilityWeekInput
): Promise<AvailabilityPayload> {
  const weekStartKey = normalizeWeekStartKey(input.weekStartKey);
  const role = input.role;
  const employeeId = normalizeText(input.employeeId);
  const actorAccountKey = normalizeText(input.actorAccountKey) || "system";
  const personKey = buildPersonKey(role, employeeId);
  const { weeks } = await getCollections();
  const now = new Date();

  const existingWeek = await weeks.findOne({ personKey, weekStartKey });
  if (existingWeek?.status === "locked" && !input.allowLockedOverwrite) {
    throw new Error("Tuần này đã bị khóa nên bạn không thể gửi lịch rảnh.");
  }

  await weeks.updateOne(
    { personKey, weekStartKey },
    {
      $set: {
        role,
        employeeId,
        normalizedEmployeeId: normalizeEmployeeId(employeeId),
        weekStartKey,
        status: existingWeek?.status === "locked" ? "locked" : "submitted",
        submittedAt: now,
        lockedAt: existingWeek?.lockedAt || null,
        lockedReason: existingWeek?.lockedReason || "",
        updatedAt: now,
        updatedBy: actorAccountKey
      },
      $setOnInsert: {
        personKey
      }
    },
    { upsert: true }
  );

  return getAvailabilityWeekForPerson(role, employeeId, weekStartKey);
}

export async function getAvailabilityWeekDates(weekStartKey?: string) {
  const normalizedWeekStartKey = normalizeWeekStartKey(weekStartKey);
  return getScheduleWeekDateKeys(normalizedWeekStartKey);
}

export function getNextAvailabilityWeekStartKey(weekStartKey: string, offsetWeeks: number) {
  return addDaysToScheduleDateKey(normalizeWeekStartKey(weekStartKey), offsetWeeks * 7);
}
