import type { Collection } from "mongodb";
import { nextEmployeeIdForRole } from "@/lib/applicationAutomation";
import { deleteContractImage } from "@/lib/contractCloudinary";
import { resolveEmployeeCompensation } from "@/lib/employeeCompensation";
import { findActiveScheduleLocation } from "@/lib/locationStore";
import { normalizeLocationCode } from "@/lib/locationUtils";
import { getMongoDatabase } from "@/lib/mongodb";
import type { EmployeeRole, HostWorkLocation, PeoplePayload, SchedulePerson } from "@/lib/types";
import { syncEmployeeAccountProfile } from "@/lib/userAccounts";

type SchedulePersonDocument = {
  personKey: string;
  employeeId: string;
  normalizedEmployeeId: string;
  name: string;
  role: EmployeeRole;
  rating?: string;
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
  rating?: string;
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
  source?: string;
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
  const compensation = resolveEmployeeCompensation(document.role, {
    rating: document.rating,
    level: document.level,
    cashOffer: document.cashOffer
  });
  return {
    id: document.employeeId,
    name: document.name || document.employeeId,
    role: document.role,
    level: compensation.level || undefined,
    rating: compensation.rating || undefined,
    workLocation: document.role === "host" ? normalizeHostWorkLocation(document.workLocation) : undefined,
    phone: document.phone || undefined,
    cvReference: document.cvReference || undefined,
    cashOffer: compensation.cashOffer || undefined,
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
  const compensation = resolveEmployeeCompensation(input.role, {
    rating: input.rating,
    level: input.level,
    cashOffer: input.cashOffer
  });
  return {
    name: normalizeText(input.name),
    rating: normalizeText(compensation.rating),
    level: normalizeText(compensation.level),
    workLocation: input.role === "host" ? normalizeLocationCode(input.workLocation) : "",
    phone: normalizePhone(input.phone),
    cvReference: normalizeText(input.cvReference),
    cashOffer: normalizeText(compensation.cashOffer),
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
    message: people.length === 0
      ? "Danh sách nhân viên chưa có dữ liệu. Hãy tạo từ mục Ứng tuyển hoặc sync từ sheet tuyển dụng."
      : undefined
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

  const database = await getMongoDatabase();
  const personKey = buildPersonKey(role, employeeId);
  const contractCollection = database.collection("employee_contract_profiles");
  const availabilityWeeks = database.collection("schedule_availability_weeks");
  const availabilitySlots = database.collection("schedule_availability_slots");
  const userAccounts = database.collection("schedule_users");
  const applications = database.collection("people_applications");
  const recruitmentProfiles = database.collection("recruitment_profiles");
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

  const [rosterResult, accountResult, contractResult, availabilityWeekResult, availabilitySlotResult, applicationResult, recruitmentResult] = await Promise.all([
    collection.deleteOne({ personKey }),
    userAccounts.deleteOne({ accountKey: `employee:${role}:${normalizeEmployeeId(employeeId)}` }),
    contractCollection.deleteOne({ personKey }),
    availabilityWeeks.deleteMany({ personKey }),
    availabilitySlots.deleteMany({ personKey }),
    applications.deleteMany({ $or: applicationFilters }),
    recruitmentProfiles.deleteOne({ personKey })
  ]);

  if (rosterResult.deletedCount !== 1) {
    throw new Error("Không xoá được hồ sơ nhân viên.");
  }

  const contractImageIds = [contractDocument?.citizenIdFront?.publicId, contractDocument?.citizenIdBack?.publicId]
    .filter((value): value is string => Boolean(value));
  await Promise.all(contractImageIds.map((publicId) => deleteContractImage(publicId).catch(() => undefined)));

  return {
    employee: toSchedulePerson(existing),
    deleted: {
      accounts: accountResult.deletedCount,
      contracts: contractResult.deletedCount,
      availabilityWeeks: availabilityWeekResult.deletedCount,
      availabilitySlots: availabilitySlotResult.deletedCount,
      applications: applicationResult.deletedCount,
      recruitmentProfiles: recruitmentResult.deletedCount
    }
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
    source: normalizeText(input.source) || "Admin API",
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
        source: normalizeText(input.source) || existing.source || "Admin API",
        lastSeenAt: now,
        updatedAt: now,
        updatedBy: actorAccountKey,
        deactivatedAt: active ? null : now
      },
      $unset: {
        castStatus: "" as const
      }
    },
    { returnDocument: "after" }
  );
  if (!updated) throw new Error("Không tìm thấy nhân viên.");
  const person = toSchedulePerson(updated);
  await syncEmployeeAccountProfile({ person, actorAccountKey });
  return person;
}

