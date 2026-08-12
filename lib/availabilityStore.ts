import type { Collection } from "mongodb";
import { getMongoClient, getMongoDatabase } from "@/lib/mongodb";
import { findActiveSchedulePerson, getSchedulePeopleFromMongo } from "@/lib/employeeRoster";
import { findActiveScheduleLocation } from "@/lib/locationStore";
import { normalizeLocationCode, resolveAvailabilityLocation } from "@/lib/locationUtils";
import { DEFAULT_SCHEDULE_SLOTS } from "@/lib/scheduleConfig";
import {
  addDaysToScheduleDateKey,
  getScheduleWeekDateKeys,
  getScheduleWeekStartKey,
  isScheduleSlotInPast,
  isValidScheduleDateKey
} from "@/lib/scheduleDate";
import type {
  AvailabilityAdminDashboardPayload,
  AvailabilityAdminPerson,
  AvailabilityAdminRoleFilter,
  AvailabilityAdminSlotSummary,
  AvailabilityAdminStatusFilter,
  AvailabilityPayload,
  AvailabilitySlot,
  AvailabilitySummary,
  AvailabilityWeek,
  AvailabilityWeekStatus,
  EmployeeRole,
  HostWorkLocation
} from "@/lib/types";
import type { SubmittedScheduleSlot } from "@/lib/scheduleEngine";

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
  locationPreference?: string;
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
  allowLocationOverride?: boolean;
};

type SubmitAvailabilityWeekInput = {
  role: EmployeeRole;
  employeeId: string;
  weekStartKey: string;
  actorAccountKey: string;
  allowLockedOverwrite?: boolean;
};

type GetAvailabilityAdminDashboardInput = {
  weekStartKey?: string;
  roleFilter?: AvailabilityAdminRoleFilter;
  statusFilter?: AvailabilityAdminStatusFilter;
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

function resolveHostWorkLocation(
  role: EmployeeRole,
  workLocation?: HostWorkLocation,
  storedLocation?: unknown
): HostWorkLocation | undefined {
  if (role !== "host") return undefined;
  return normalizeLocationCode(workLocation || storedLocation) || undefined;
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
      if (slot.locationPreference) {
        summary.availableByLocation[slot.locationPreference] =
          (summary.availableByLocation[slot.locationPreference] || 0) + 1;
      }
      return summary;
    },
    {
      totalSlots: DEFAULT_SCHEDULE_SLOTS.length * 7,
      availableSlots: 0,
      availableByLocation: {}
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
  workLocation: HostWorkLocation | undefined,
  weekStartKey: string,
  slots: AvailabilitySlot[],
  allowLocationOverride: boolean
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
      locationPreference: role === "host"
        ? resolveAvailabilityLocation(workLocation, slot.locationPreference, allowLocationOverride)
        : undefined,
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
      locationPreference: role === "host"
        ? resolveAvailabilityLocation(person.workLocation, document.locationPreference, true)
        : undefined,
      note: document.note,
      updatedAt: document.updatedAt.toISOString()
    }))
    .sort(compareWeekSlots);
  const workLocation = role === "host" ? resolveHostWorkLocation(role, person.workLocation) : undefined;
  const workLocationActive = role !== "host" || Boolean(workLocation && await findActiveScheduleLocation(workLocation));

  return {
    weekStartKey,
    role,
    employeeId: person.id,
    employeeName: person.name,
    workLocation,
    workLocationActive,
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
      employeeName: week.employeeName,
      workLocation: week.workLocation,
      workLocationActive: week.workLocationActive
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
  const requestedEmployeeId = normalizeText(input.employeeId);
  const person = await findActiveSchedulePerson(role, requestedEmployeeId);
  if (!person) {
    throw new Error("Không tìm thấy nhân sự hoạt động cho lịch rảnh.");
  }
  if (role === "host" && !person.workLocation) {
    throw new Error("Host chưa được cấu hình địa điểm trong hồ sơ nhân sự.");
  }
  if (role === "host" && person.workLocation && !await findActiveScheduleLocation(person.workLocation)) {
    throw new Error("Địa điểm của Host không tồn tại hoặc đã tạm ngưng.");
  }
  const employeeId = person.id;
  const actorAccountKey = normalizeText(input.actorAccountKey) || "system";
  const personKey = buildPersonKey(role, employeeId);
  const normalizedSlots = normalizeIncomingSlots(
    role,
    person.workLocation,
    weekStartKey,
    input.slots,
    Boolean(input.allowLocationOverride)
  );
  const { weeks, slots } = await getCollections();
  const client = await getMongoClient();
  const now = new Date();

  await client.withSession(async (mongoSession) => {
    await mongoSession.withTransaction(async () => {
      const [existingWeek, existingSlotDocuments] = await Promise.all([
        weeks.findOne({ personKey, weekStartKey }, { session: mongoSession }),
        slots.find({ personKey, weekStartKey }, { session: mongoSession }).toArray()
      ]);
      if (existingWeek?.status === "locked" && !input.allowLockedOverwrite) {
        throw new Error("Tuần này đã bị khóa nên bạn không thể chỉnh lịch rảnh.");
      }

      const existingPastSlots = existingSlotDocuments.filter((slot) =>
        isScheduleSlotInPast(slot.dateKey, slot.slot, now)
      );
      const existingPastKeys = new Set(existingPastSlots.map((slot) => `${slot.dateKey}__${slot.slot}`));
      const newlyAddedPastSlot = normalizedSlots.find((slot) =>
        isScheduleSlotInPast(slot.dateKey, slot.slot, now) &&
        !existingPastKeys.has(`${slot.dateKey}__${slot.slot}`)
      );
      if (newlyAddedPastSlot) {
        throw new Error("Không thể đăng ký khung giờ đã bắt đầu hoặc đã ở trong quá khứ.");
      }

      const existingSlotByKey = new Map(
        existingSlotDocuments.map((slot) => [`${slot.dateKey}__${slot.slot}`, slot] as const)
      );
      const preserveAdminLocation = role === "host" && normalizeLocationCode(person.workLocation) === "both" && !input.allowLocationOverride;
      const futureSlots = normalizedSlots
        .filter((slot) => !isScheduleSlotInPast(slot.dateKey, slot.slot, now))
        .map((slot) => {
          if (!preserveAdminLocation) return slot;
          const existingSlot = existingSlotByKey.get(`${slot.dateKey}__${slot.slot}`);
          return {
            ...slot,
            locationPreference: resolveAvailabilityLocation(person.workLocation, existingSlot?.locationPreference, true)
          };
        });

      await slots.deleteMany({ personKey, weekStartKey }, { session: mongoSession });

      if (existingPastSlots.length > 0 || futureSlots.length > 0) {
        await slots.insertMany(
          [
            ...existingPastSlots.map((slot) => ({
              personKey: slot.personKey,
              role: slot.role,
              employeeId: slot.employeeId,
              normalizedEmployeeId: slot.normalizedEmployeeId,
              weekStartKey: slot.weekStartKey,
              dateKey: slot.dateKey,
              slot: slot.slot,
              available: true as const,
              locationPreference: slot.locationPreference,
              note: slot.note,
              updatedAt: slot.updatedAt,
              updatedBy: slot.updatedBy
            })),
            ...futureSlots.map((slot) => ({
              personKey,
              role,
              employeeId,
              normalizedEmployeeId: normalizeEmployeeId(employeeId),
              weekStartKey,
              dateKey: slot.dateKey,
              slot: slot.slot,
              available: true as const,
              locationPreference: slot.locationPreference,
              note: slot.note,
              updatedAt: now,
              updatedBy: actorAccountKey
            }))
          ],
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
  const requestedEmployeeId = normalizeText(input.employeeId);
  const person = await findActiveSchedulePerson(role, requestedEmployeeId);
  if (!person) {
    throw new Error("Không tìm thấy nhân sự hoạt động cho lịch rảnh.");
  }
  if (role === "host" && !person.workLocation) {
    throw new Error("Host chưa được cấu hình địa điểm trong hồ sơ nhân sự.");
  }
  if (role === "host" && person.workLocation && !await findActiveScheduleLocation(person.workLocation)) {
    throw new Error("Địa điểm của Host không tồn tại hoặc đã tạm ngưng.");
  }
  const employeeId = person.id;
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

export async function getSubmittedScheduleSlotsForWeek(
  requestedWeekStartKey?: string
): Promise<SubmittedScheduleSlot[]> {
  const weekStartKey = normalizeWeekStartKey(requestedWeekStartKey);
  const { weeks, slots } = await getCollections();
  const submittedWeeks = await weeks
    .find({ weekStartKey, status: { $in: ["submitted", "locked"] } })
    .project<{ personKey: string }>({ personKey: 1 })
    .toArray();
  const submittedPersonKeys = submittedWeeks.map((week) => week.personKey);
  if (submittedPersonKeys.length === 0) return [];

  const documents = await slots
    .find({ weekStartKey, personKey: { $in: submittedPersonKeys } })
    .sort({ dateKey: 1, slot: 1, personKey: 1 })
    .toArray();

  return documents.map((document) => {
    const storedLocation = normalizeLocationCode(document.locationPreference);
    return {
      personKey: document.personKey,
      role: document.role,
      employeeId: document.employeeId,
      dateKey: document.dateKey,
      slot: document.slot,
      locationPreference: document.role === "host" && (storedLocation === "home" || storedLocation === "studio")
        ? storedLocation
        : undefined
    };
  });
}

export function hasEditableAvailabilitySlots(weekStartKey: string, now = new Date()) {
  const normalizedWeekStartKey = normalizeWeekStartKey(weekStartKey);
  return getScheduleWeekDateKeys(normalizedWeekStartKey).some((dateKey) =>
    DEFAULT_SCHEDULE_SLOTS.some((slot) => !isScheduleSlotInPast(dateKey, slot, now))
  );
}

export function getNextAvailabilityWeekStartKey(weekStartKey: string, offsetWeeks: number) {
  return addDaysToScheduleDateKey(normalizeWeekStartKey(weekStartKey), offsetWeeks * 7);
}

function matchesAdminStatusFilter(
  person: AvailabilityAdminPerson,
  statusFilter: AvailabilityAdminStatusFilter
) {
  if (statusFilter === "submitted") {
    return person.submissionState === "submitted" || person.submissionState === "locked";
  }
  if (statusFilter === "not_submitted") {
    return person.submissionState === "not_started" || person.submissionState === "draft";
  }
  return true;
}

export async function getAvailabilityAdminDashboard(
  input: GetAvailabilityAdminDashboardInput = {}
): Promise<AvailabilityAdminDashboardPayload> {
  const weekStartKey = normalizeWeekStartKey(input.weekStartKey);
  const roleFilter = input.roleFilter === "host" || input.roleFilter === "support" ? input.roleFilter : "all";
  const statusFilter = input.statusFilter === "submitted" || input.statusFilter === "not_submitted"
    ? input.statusFilter
    : "all";
  const roster = await getSchedulePeopleFromMongo();
  const activePeople = [...(roster.hosts || []), ...(roster.supports || [])]
    .filter((person) => roleFilter === "all" || person.role === roleFilter);
  const { weeks, slots } = await getCollections();
  const roleQuery = roleFilter === "all" ? {} : { role: roleFilter };
  const [weekDocuments, slotDocuments] = await Promise.all([
    weeks.find({ weekStartKey, ...roleQuery }).toArray(),
    slots.find({ weekStartKey, ...roleQuery }).toArray()
  ]);
  const weeksByPerson = new Map(weekDocuments.map((document) => [document.personKey, document]));
  const slotCountByPerson = new Map<string, number>();

  slotDocuments.forEach((document) => {
    slotCountByPerson.set(document.personKey, (slotCountByPerson.get(document.personKey) || 0) + 1);
  });

  const stateOrder = { not_started: 0, draft: 1, submitted: 2, locked: 3 } as const;
  const allPeople = activePeople
    .map<AvailabilityAdminPerson>((person) => {
      const personKey = buildPersonKey(person.role, person.id);
      const weekDocument = weeksByPerson.get(personKey);
      const submissionState = weekDocument?.status || "not_started";
      return {
        employeeId: person.id,
        employeeName: person.name,
        role: person.role,
        level: person.level,
        workLocation: person.workLocation,
        submissionState,
        availableSlots: slotCountByPerson.get(personKey) || 0,
        submittedAt: weekDocument?.submittedAt?.toISOString(),
        updatedAt: weekDocument?.updatedAt?.toISOString()
      };
    })
    .sort((left, right) => {
      const stateDifference = stateOrder[left.submissionState] - stateOrder[right.submissionState];
      if (stateDifference !== 0) return stateDifference;
      if (left.role !== right.role) return left.role.localeCompare(right.role);
      return [left.employeeName, left.employeeId]
        .join("__")
        .localeCompare([right.employeeName, right.employeeId].join("__"), "vi");
    });
  const visiblePeople = allPeople.filter((person) => matchesAdminStatusFilter(person, statusFilter));
  const visiblePersonKeys = new Set(
    visiblePeople.map((person) => buildPersonKey(person.role, person.employeeId))
  );
  const slotSummaries = new Map<string, AvailabilityAdminSlotSummary>();

  getScheduleWeekDateKeys(weekStartKey).forEach((dateKey) => {
    DEFAULT_SCHEDULE_SLOTS.forEach((slot) => {
      slotSummaries.set(`${dateKey}__${slot}`, {
        dateKey,
        slot,
        peopleAvailable: 0,
        hostAvailable: 0,
        supportAvailable: 0,
        hostEmployeeIds: [],
        supportEmployeeIds: []
      });
    });
  });

  slotDocuments.forEach((document) => {
    if (!visiblePersonKeys.has(document.personKey)) return;
    const summary = slotSummaries.get(`${document.dateKey}__${document.slot}`);
    if (!summary) return;
    const employeeIds = document.role === "host" ? summary.hostEmployeeIds : summary.supportEmployeeIds;
    if (!employeeIds.includes(document.employeeId)) employeeIds.push(document.employeeId);
  });

  slotSummaries.forEach((summary) => {
    summary.hostEmployeeIds.sort((left, right) => left.localeCompare(right, "vi"));
    summary.supportEmployeeIds.sort((left, right) => left.localeCompare(right, "vi"));
    summary.hostAvailable = summary.hostEmployeeIds.length;
    summary.supportAvailable = summary.supportEmployeeIds.length;
    summary.peopleAvailable = summary.hostAvailable + summary.supportAvailable;
  });

  const submittedPeople = allPeople.filter(
    (person) => person.submissionState === "submitted" || person.submissionState === "locked"
  ).length;
  const draftPeople = allPeople.filter((person) => person.submissionState === "draft").length;
  const notStartedPeople = allPeople.filter((person) => person.submissionState === "not_started").length;

  return {
    success: true,
    weekStartKey,
    roleFilter,
    statusFilter,
    generatedAt: new Date().toISOString(),
    summary: {
      totalPeople: allPeople.length,
      submittedPeople,
      notSubmittedPeople: draftPeople + notStartedPeople,
      draftPeople,
      notStartedPeople,
      lockedPeople: allPeople.filter((person) => person.submissionState === "locked").length,
      visiblePeople: visiblePeople.length,
      visibleAvailableSlots: visiblePeople.reduce((total, person) => total + person.availableSlots, 0)
    },
    people: visiblePeople,
    slots: Array.from(slotSummaries.values())
  };
}
