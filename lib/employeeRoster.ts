import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { EMPLOYEE_MIGRATION_SEED, EMPLOYEE_MIGRATION_SOURCE } from "@/lib/employeeSeed";
import { nextEmployeeIdForRole } from "@/lib/applicationAutomation";
import { deleteContractImage } from "@/lib/contractCloudinary";
import { findActiveScheduleLocation } from "@/lib/locationStore";
import { normalizeLocationCode } from "@/lib/locationUtils";
import { getMongoClient, getMongoDatabase } from "@/lib/mongodb";
import type { EmployeeRole, HostWorkLocation, PeoplePayload, PeopleSyncPayload, SchedulePerson } from "@/lib/types";
import { syncEmployeeAccountProfile } from "@/lib/userAccounts";

type SchedulePersonDocument = {
  personKey: string;
  employeeId: string;
  normalizedEmployeeId: string;
  name: string;
  role: EmployeeRole;
  level: string;
  workLocation?: HostWorkLocation | "";
  phone?: string;
  cvReference?: string;
  cashOffer?: string;
  castStatus?: string;
  experience?: string;
  trainingStatus?: string;
  notes?: string;
  achievements?: string;
  zaloStatus?: string;
  liveAccountType?: string;
  liveChannelId?: string;
  active: boolean;
  source: string;
  syncBatchId?: string;
  firstSyncedAt: Date;
  lastSeenAt: Date;
  createdAt?: Date;
  createdBy?: string;
  updatedAt: Date;
  updatedBy?: string;
  deactivatedAt?: Date | null;
};

export type SchedulePersonMutation = {
  id: string;
  role: EmployeeRole;
  name?: string;
  level?: string;
  workLocation?: string;
  phone?: string;
  cvReference?: string;
  cashOffer?: string;
  castStatus?: string;
  experience?: string;
  trainingStatus?: string;
  notes?: string;
  achievements?: string;
  zaloStatus?: string;
  liveAccountType?: string;
  liveChannelId?: string;
  active?: boolean;
};

let rosterIndexesPromise: Promise<unknown> | null = null;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value == null ? "" : String(value).trim();
}

function normalizeEmployeeId(employeeId: string) {
  return normalizeText(employeeId).toLowerCase();
}

function buildPersonKey(role: EmployeeRole, employeeId: string) {
  return `${role}:${normalizeEmployeeId(employeeId)}`;
}

function normalizeHostWorkLocation(value: unknown): HostWorkLocation | undefined {
  return normalizeLocationCode(value) || undefined;
}

function normalizePhone(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/\D/g, "")}`;
  return raw.replace(/\D/g, "");
}

function toSchedulePerson(document: SchedulePersonDocument): SchedulePerson {
  return {
    id: document.employeeId,
    name: document.name || document.employeeId,
    role: document.role,
    level: document.level || undefined,
    workLocation: document.role === "host" ? normalizeHostWorkLocation(document.workLocation) : undefined,
    phone: document.phone || undefined,
    cvReference: document.cvReference || undefined,
    cashOffer: document.cashOffer || undefined,
    castStatus: document.castStatus || undefined,
    experience: document.experience || undefined,
    trainingStatus: document.trainingStatus || undefined,
    notes: document.notes || undefined,
    achievements: document.achievements || undefined,
    zaloStatus: document.zaloStatus || undefined,
    liveAccountType: document.liveAccountType || undefined,
    liveChannelId: document.liveChannelId || undefined,
    active: document.active,
    source: document.source,
    createdAt: (document.createdAt || document.firstSyncedAt)?.toISOString(),
    updatedAt: document.updatedAt?.toISOString()
  };
}

function personFields(input: SchedulePersonMutation) {
  return {
    name: normalizeText(input.name),
    level: normalizeText(input.level),
    workLocation: input.role === "host" ? normalizeLocationCode(input.workLocation) : "",
    phone: normalizePhone(input.phone),
    cvReference: normalizeText(input.cvReference),
    cashOffer: normalizeText(input.cashOffer),
    castStatus: normalizeText(input.castStatus),
    experience: normalizeText(input.experience),
    trainingStatus: normalizeText(input.trainingStatus),
    notes: normalizeText(input.notes),
    achievements: input.role === "host" ? normalizeText(input.achievements) : "",
    zaloStatus: input.role === "host" ? normalizeText(input.zaloStatus) : "",
    liveAccountType: input.role === "host" ? normalizeText(input.liveAccountType) : "",
    liveChannelId: input.role === "host" ? normalizeText(input.liveChannelId) : ""
  };
}

function sortPeople(left: SchedulePerson, right: SchedulePerson) {
  if (left.role !== right.role) return left.role.localeCompare(right.role);
  return [left.name, left.id].join("__").localeCompare([right.name, right.id].join("__"), "vi");
}

async function assertPersonInput(input: SchedulePersonMutation, active: boolean) {
  const employeeId = normalizeText(input.id);
  const name = normalizeText(input.name);
  if (input.role !== "host" && input.role !== "support") throw new Error("Vai trò nhân viên không hợp lệ.");
  if (!employeeId) throw new Error("Mã nhân viên không được để trống.");
  if (!name) throw new Error("Họ tên nhân viên không được để trống.");
  if (active && input.role === "host") {
    const workLocation = normalizeLocationCode(input.workLocation);
    if (!workLocation) throw new Error("Host phải được cấu hình địa điểm.");
    if (!await findActiveScheduleLocation(workLocation)) {
      throw new Error("Địa điểm của Host không tồn tại hoặc đã tạm ngưng.");
    }
  }
}

async function getRosterCollection(): Promise<Collection<SchedulePersonDocument>> {
  const database = await getMongoDatabase();
  const collection = database.collection<SchedulePersonDocument>("schedule_people");
  if (!rosterIndexesPromise) {
    rosterIndexesPromise = Promise.all([
      collection.createIndex({ personKey: 1 }, { unique: true }),
      collection.createIndex({ active: 1, role: 1, name: 1 }),
      collection.createIndex({ normalizedEmployeeId: 1, role: 1 })
    ]).catch((error) => {
      rosterIndexesPromise = null;
      throw error;
    });
  }
  await rosterIndexesPromise;
  return collection;
}

export async function getSchedulePeopleFromMongo(): Promise<PeoplePayload> {
  const collection = await getRosterCollection();
  const documents = await collection.find({ active: true }).toArray();
  const people = documents.map(toSchedulePerson);
  const hosts = people.filter((person) => person.role === "host").sort(sortPeople);
  const supports = people.filter((person) => person.role === "support").sort(sortPeople);
  const latestSync = documents.reduce<Date | null>(
    (latest, document) => !latest || document.lastSeenAt > latest ? document.lastSeenAt : latest,
    null
  );

  return {
    success: true,
    generatedAt: latestSync?.toISOString(),
    syncedAt: latestSync?.toISOString(),
    source: "MongoDB schedule_people",
    total: people.length,
    hosts,
    supports,
    message: people.length === 0 ? "Danh sách nhân viên chưa có dữ liệu. Admin hãy mở mục Nhân viên để khởi tạo." : undefined
  };
}

export async function listSchedulePeopleForAdmin() {
  const collection = await getRosterCollection();
  const documents = await collection.find({}).toArray();
  return documents.map(toSchedulePerson).sort(sortPeople);
}

export async function findActiveSchedulePerson(role: EmployeeRole, employeeId: string): Promise<SchedulePerson | null> {
  const collection = await getRosterCollection();
  const document = await collection.findOne({ personKey: buildPersonKey(role, employeeId), active: true });
  return document ? toSchedulePerson(document) : null;
}

export async function findSchedulePerson(role: EmployeeRole, employeeId: string): Promise<SchedulePerson | null> {
  const collection = await getRosterCollection();
  const document = await collection.findOne({ personKey: buildPersonKey(role, employeeId) });
  return document ? toSchedulePerson(document) : null;
}

export async function findSchedulePersonByPhone(role: EmployeeRole, phone: string): Promise<SchedulePerson | null> {
  const collection = await getRosterCollection();
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  const document = await collection.findOne({ role, phone: normalizedPhone });
  return document ? toSchedulePerson(document) : null;
}

export async function allocateNextScheduleEmployeeId(role: EmployeeRole) {
  const collection = await getRosterCollection();
  const employeeIds = await collection.find({ role }, { projection: { employeeId: 1 } }).toArray();
  return nextEmployeeIdForRole(role, employeeIds.map((item) => item.employeeId));
}

export async function hardDeleteSchedulePerson(role: EmployeeRole, employeeId: string) {
  const collection = await getRosterCollection();
  const existing = await collection.findOne({ personKey: buildPersonKey(role, employeeId) });
  if (!existing) throw new Error("Không tìm thấy nhân viên.");

  const client = await getMongoClient();
  const database = await getMongoDatabase();
  const session = client.startSession();
  const personKey = buildPersonKey(role, employeeId);
  const contractCollection = database.collection("employee_contract_profiles");
  const availabilityWeeks = database.collection("schedule_availability_weeks");
  const availabilitySlots = database.collection("schedule_availability_slots");
  const userAccounts = database.collection("schedule_users");
  const applications = database.collection("people_applications");
  const contractDocument = await contractCollection.findOne(
    { personKey },
    {
      projection: {
        citizenIdFront: 1,
        citizenIdBack: 1
      }
    }
  ) as {
    citizenIdFront?: { publicId?: string };
    citizenIdBack?: { publicId?: string };
  } | null;

  const applicationFilters: Array<Record<string, unknown>> = [{ employeeId }];
  if (existing.phone) applicationFilters.push({ normalizedPhone: existing.phone, role });

  let deleted;
  try {
    deleted = await session.withTransaction(async () => {
      const [rosterResult, accountResult, contractResult, availabilityWeekResult, availabilitySlotResult, applicationResult] = await Promise.all([
        collection.deleteOne({ personKey }, { session }),
        userAccounts.deleteOne({ accountKey: `employee:${role}:${normalizeEmployeeId(employeeId)}` }, { session }),
        contractCollection.deleteOne({ personKey }, { session }),
        availabilityWeeks.deleteMany({ personKey }, { session }),
        availabilitySlots.deleteMany({ personKey }, { session }),
        applications.deleteMany({ $or: applicationFilters }, { session })
      ]);

      if (rosterResult.deletedCount !== 1) {
        throw new Error("Không xoá được hồ sơ nhân viên.");
      }

      return {
        accounts: accountResult.deletedCount,
        contracts: contractResult.deletedCount,
        availabilityWeeks: availabilityWeekResult.deletedCount,
        availabilitySlots: availabilitySlotResult.deletedCount,
        applications: applicationResult.deletedCount
      };
    });
  } finally {
    await session.endSession();
  }

  const contractImageIds = [contractDocument?.citizenIdFront?.publicId, contractDocument?.citizenIdBack?.publicId]
    .filter((value): value is string => Boolean(value));
  await Promise.all(contractImageIds.map((publicId) => deleteContractImage(publicId).catch(() => undefined)));

  return {
    employee: toSchedulePerson(existing),
    deleted
  };
}

export async function createSchedulePerson(input: SchedulePersonMutation, actorAccountKey: string) {
  const active = input.active !== false;
  await assertPersonInput(input, active);
  const collection = await getRosterCollection();
  const now = new Date();
  const employeeId = normalizeText(input.id);
  const document: SchedulePersonDocument = {
    personKey: buildPersonKey(input.role, employeeId),
    employeeId,
    normalizedEmployeeId: normalizeEmployeeId(employeeId),
    role: input.role,
    ...personFields(input),
    active,
    source: "Admin API",
    firstSyncedAt: now,
    lastSeenAt: now,
    createdAt: now,
    createdBy: actorAccountKey,
    updatedAt: now,
    updatedBy: actorAccountKey,
    deactivatedAt: active ? null : now
  };

  try {
    await collection.insertOne(document);
    const person = toSchedulePerson(document);
    await syncEmployeeAccountProfile({ person, actorAccountKey });
    return person;
  } catch (error) {
    if (error instanceof Error && /duplicate key/i.test(error.message)) {
      throw new Error("Mã nhân viên đã tồn tại trong vai trò này.");
    }
    throw error;
  }
}

export async function updateSchedulePerson(input: SchedulePersonMutation, actorAccountKey: string) {
  const collection = await getRosterCollection();
  const personKey = buildPersonKey(input.role, input.id);
  const existing = await collection.findOne({ personKey });
  if (!existing) throw new Error("Không tìm thấy nhân viên.");
  const merged: SchedulePersonMutation = {
    ...toSchedulePerson(existing),
    ...input,
    id: existing.employeeId,
    role: existing.role
  };
  const active = input.active === undefined ? existing.active : input.active;
  await assertPersonInput(merged, active);
  const now = new Date();

  const updated = await collection.findOneAndUpdate(
    { personKey },
    {
      $set: {
        ...personFields(merged),
        active,
        lastSeenAt: now,
        updatedAt: now,
        updatedBy: actorAccountKey,
        deactivatedAt: active ? null : now
      }
    },
    { returnDocument: "after" }
  );
  if (!updated) throw new Error("Không tìm thấy nhân viên.");
  const person = toSchedulePerson(updated);
  await syncEmployeeAccountProfile({ person, actorAccountKey });
  return person;
}

export async function bootstrapSchedulePeople(): Promise<PeopleSyncPayload> {
  const collection = await getRosterCollection();
  const now = new Date();
  const syncBatchId = randomUUID();
  const operations = EMPLOYEE_MIGRATION_SEED.map((person) => {
    const input: SchedulePersonMutation = { ...person, active: true };
    return {
      updateOne: {
        filter: { personKey: buildPersonKey(person.role, person.id) },
        update: {
          $set: {
            employeeId: person.id,
            normalizedEmployeeId: normalizeEmployeeId(person.id),
            role: person.role,
            ...personFields(input),
            active: true,
            source: EMPLOYEE_MIGRATION_SOURCE,
            syncBatchId,
            lastSeenAt: now,
            updatedAt: now,
            updatedBy: "migration",
            deactivatedAt: null
          },
          $setOnInsert: {
            personKey: buildPersonKey(person.role, person.id),
            firstSyncedAt: now,
            createdAt: now,
            createdBy: "migration"
          }
        },
        upsert: true
      }
    };
  });
  const result = await collection.bulkWrite(operations, { ordered: false });
  await Promise.all(EMPLOYEE_MIGRATION_SEED.map((person) => syncEmployeeAccountProfile({
    person: { ...person, active: true },
    actorAccountKey: "migration"
  })));
  const roster = await getSchedulePeopleFromMongo();

  return {
    ...roster,
    syncedAt: now.toISOString(),
    generatedAt: now.toISOString(),
    inserted: result.upsertedCount,
    updated: result.matchedCount,
    deactivated: 0,
    total: roster.total || 0,
    message: `Đã nạp ${EMPLOYEE_MIGRATION_SEED.length} hồ sơ nguồn; giữ nguyên nhân sự khác trong MongoDB.`
  };
}
