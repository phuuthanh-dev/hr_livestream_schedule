import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import {
  buildEmployeeContractCode,
  isEmployeeContractComplete,
  normalizeEmployeeContractInput,
  type EmployeeContractInput,
  type NormalizedEmployeeContractInput
} from "@/lib/employeeContractValidation";
import type { EmployeeRole, SchedulePerson } from "@/lib/types";

const CONTRACT_COLLECTION = "employee_contract_profiles";

export type EmployeeContractDocumentSide = "front" | "back";

export type EmployeeContractFile = {
  publicId: string;
  format: string;
  version: number;
  bytes: number;
  originalFilename: string;
  uploadedAt: string;
};

type StoredEmployeeContractFile = Omit<EmployeeContractFile, "uploadedAt"> & { uploadedAt: Date };

type StoredEmployeeContractDriveSyncStatus = {
  status: "success" | "error";
  syncedAt: Date;
  folderId?: string;
  error?: string;
};

type EmployeeContractDocument = NormalizedEmployeeContractInput & {
  personKey: string;
  role: EmployeeRole;
  employeeId: string;
  contractCode: string;
  normalizedEmployeeId: string;
  employeeName: string;
  citizenIdFront?: StoredEmployeeContractFile;
  citizenIdBack?: StoredEmployeeContractFile;
  completed: boolean;
  submittedAt?: Date;
  driveSync?: StoredEmployeeContractDriveSyncStatus;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
};

export type EmployeeContractProfile = NormalizedEmployeeContractInput & {
  role: EmployeeRole;
  employeeId: string;
  contractCode: string;
  employeeName: string;
  citizenIdFront?: EmployeeContractFile;
  citizenIdBack?: EmployeeContractFile;
  completed: boolean;
  submittedAt?: string;
  updatedAt: string;
};

export type EmployeeContractDriveSyncStatus = {
  status: "success" | "error";
  syncedAt: string;
  folderId?: string;
  error?: string;
};

export type EmployeeContractSummary = {
  completed: boolean;
  hasFront: boolean;
  hasBack: boolean;
  updatedAt?: string;
  driveSync?: EmployeeContractDriveSyncStatus;
};

export type EmployeeContractProfileRecord = EmployeeContractProfile & {
  personKey: string;
};

let contractIndexesPromise: Promise<unknown> | null = null;

function normalizeEmployeeId(employeeId: string) {
  return employeeId.trim().toLowerCase();
}

function personKey(role: EmployeeRole, employeeId: string) {
  return `${role}:${normalizeEmployeeId(employeeId)}`;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeDateInput(value: unknown) {
  const raw = cleanText(value, 40);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, "0");
    const month = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${month}-${day}`;
  }
  return raw;
}

function isValidPastOrTodayDate(value: string) {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return false;
  }
  const today = new Date();
  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(today);
  const todayPart = (type: Intl.DateTimeFormatPartTypes) => todayParts.find((part) => part.type === type)?.value || "";
  const todayKey = `${todayPart("year")}-${todayPart("month")}-${todayPart("day")}`;
  return value <= todayKey;
}

async function getContractCollection(): Promise<Collection<EmployeeContractDocument>> {
  const database = await getMongoDatabase();
  const collection = database.collection<EmployeeContractDocument>(CONTRACT_COLLECTION);
  if (!contractIndexesPromise) {
    contractIndexesPromise = Promise.all([
      collection.createIndex({ personKey: 1 }, { unique: true }),
      collection.createIndex({ completed: 1, role: 1, employeeName: 1 })
    ]).catch((error) => {
      contractIndexesPromise = null;
      throw error;
    });
  }
  await contractIndexesPromise;
  return collection;
}

function toFile(file?: StoredEmployeeContractFile): EmployeeContractFile | undefined {
  return file ? { ...file, uploadedAt: file.uploadedAt.toISOString() } : undefined;
}

function toProfile(document: EmployeeContractDocument): EmployeeContractProfile {
  return {
    role: document.role,
    employeeId: document.employeeId,
    contractCode: document.contractCode,
    employeeName: document.employeeName,
    gmail: document.gmail,
    dateOfBirth: document.dateOfBirth,
    citizenId: document.citizenId,
    citizenIdIssuedDate: document.citizenIdIssuedDate,
    citizenIdIssuedPlace: document.citizenIdIssuedPlace,
    permanentAddress: document.permanentAddress,
    temporaryAddress: document.temporaryAddress,
    bankAccountNumber: document.bankAccountNumber,
    bankName: document.bankName,
    citizenIdFront: toFile(document.citizenIdFront),
    citizenIdBack: toFile(document.citizenIdBack),
    completed: document.completed,
    submittedAt: document.submittedAt?.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

export async function getEmployeeContractProfile(role: EmployeeRole, employeeId: string) {
  const collection = await getContractCollection();
  const document = await collection.findOne({ personKey: personKey(role, employeeId) });
  return document ? toProfile(document) : null;
}

export async function saveEmployeeContractProfile(input: {
  person: SchedulePerson;
  values: EmployeeContractInput;
  actorAccountKey: string;
}) {
  const values = normalizeEmployeeContractInput(input.values);
  const collection = await getContractCollection();
  const key = personKey(input.person.role, input.person.id);
  const now = new Date();
  const document = await collection.findOneAndUpdate(
    { personKey: key },
    {
      $set: {
        ...values,
        employeeId: input.person.id,
        contractCode: buildEmployeeContractCode(input.person.id),
        normalizedEmployeeId: normalizeEmployeeId(input.person.id),
        employeeName: input.person.name,
        updatedAt: now,
        updatedBy: input.actorAccountKey
      },
      $setOnInsert: {
        personKey: key,
        role: input.person.role,
        completed: false,
        createdAt: now,
        createdBy: input.actorAccountKey
      }
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!document) throw new Error("Không lưu được thông tin hợp đồng.");
  return toProfile(document);
}

export async function upsertEmployeeContractProfileFields(input: {
  person: SchedulePerson;
  actorAccountKey: string;
  gmail?: string;
  dateOfBirth?: string;
  citizenId?: string;
  citizenIdIssuedDate?: string;
  citizenIdIssuedPlace?: string;
  permanentAddress?: string;
  temporaryAddress?: string;
  bankAccountNumber?: string;
  bankName?: string;
}) {
  const collection = await getContractCollection();
  const key = personKey(input.person.role, input.person.id);
  const now = new Date();
  const gmail = cleanText(input.gmail, 180).toLowerCase();
  const dateOfBirth = normalizeDateInput(input.dateOfBirth);
  const citizenId = cleanText(input.citizenId, 20).replace(/\D/g, "");
  const citizenIdIssuedDate = normalizeDateInput(input.citizenIdIssuedDate);
  const citizenIdIssuedPlace = cleanText(input.citizenIdIssuedPlace, 240);
  const permanentAddress = cleanText(input.permanentAddress, 1000);
  const temporaryAddress = cleanText(input.temporaryAddress, 1000);
  const bankAccountNumber = cleanText(input.bankAccountNumber, 30).replace(/\s+/g, "");
  const bankName = cleanText(input.bankName, 120);
  if (gmail && !/^[^\s@]+@gmail\.com$/i.test(gmail)) {
    throw new Error("Gmail phải là địa chỉ @gmail.com hợp lệ.");
  }
  if (dateOfBirth && !isValidPastOrTodayDate(dateOfBirth)) {
    throw new Error("Ngày sinh từ sheet không hợp lệ.");
  }
  if (citizenId && !/^\d{12}$/.test(citizenId)) {
    throw new Error("CCCD từ sheet phải gồm đúng 12 chữ số.");
  }
  if (citizenIdIssuedDate && !isValidPastOrTodayDate(citizenIdIssuedDate)) {
    throw new Error("Ngày cấp CCCD từ sheet không hợp lệ.");
  }
  if (bankAccountNumber && !/^\d{6,30}$/.test(bankAccountNumber)) {
    throw new Error("Số tài khoản ngân hàng không hợp lệ.");
  }

  const existing = await collection.findOne({ personKey: key });
  const next = await collection.findOneAndUpdate(
    { personKey: key },
    {
      $set: {
        role: input.person.role,
        employeeId: input.person.id,
        contractCode: buildEmployeeContractCode(input.person.id),
        normalizedEmployeeId: normalizeEmployeeId(input.person.id),
        employeeName: input.person.name,
        ...(gmail ? { gmail } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(citizenId ? { citizenId } : {}),
        ...(citizenIdIssuedDate ? { citizenIdIssuedDate } : {}),
        ...(citizenIdIssuedPlace ? { citizenIdIssuedPlace } : {}),
        ...(permanentAddress ? { permanentAddress } : {}),
        ...(temporaryAddress ? { temporaryAddress } : {}),
        ...(bankAccountNumber ? { bankAccountNumber } : {}),
        ...(bankName ? { bankName } : {}),
        updatedAt: now,
        updatedBy: input.actorAccountKey
      },
      $setOnInsert: {
        personKey: key,
        completed: false,
        createdAt: now,
        createdBy: input.actorAccountKey
      }
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!next) throw new Error("Không cập nhật được dữ liệu hợp đồng từ sheet.");
  const completed = isEmployeeContractComplete(next);
  if (next.completed !== completed) {
    const adjusted = await collection.findOneAndUpdate(
      { personKey: key },
      { $set: { completed } },
      { returnDocument: "after" }
    );
    if (!adjusted) throw new Error("Không cập nhật được trạng thái hồ sơ hợp đồng.");
    return { profile: toProfile(adjusted), existed: Boolean(existing) };
  }
  return { profile: toProfile(next), existed: Boolean(existing) };
}

export async function saveEmployeeContractFile(input: {
  role: EmployeeRole;
  employeeId: string;
  side: EmployeeContractDocumentSide;
  file: Omit<EmployeeContractFile, "uploadedAt">;
  actorAccountKey: string;
}) {
  const collection = await getContractCollection();
  const key = personKey(input.role, input.employeeId);
  const existing = await collection.findOne({ personKey: key });
  if (!existing) throw new Error("Hãy lưu thông tin hợp đồng trước khi tải CCCD.");

  const now = new Date();
  const file: StoredEmployeeContractFile = { ...input.file, uploadedAt: now };
  const fileUpdate = input.side === "front" ? { citizenIdFront: file } : { citizenIdBack: file };
  let document = await collection.findOneAndUpdate(
    { personKey: key },
    {
      $set: {
        ...fileUpdate,
        updatedAt: now,
        updatedBy: input.actorAccountKey
      }
    },
    { returnDocument: "after" }
  );
  if (!document) throw new Error("Không cập nhật được tài liệu CCCD.");
  const completed = isEmployeeContractComplete(document);
  if (document.completed !== completed || (completed && !document.submittedAt)) {
    document = await collection.findOneAndUpdate(
      { personKey: key },
      {
        $set: {
          completed,
          ...(completed && !document.submittedAt ? { submittedAt: now } : {})
        }
      },
      { returnDocument: "after" }
    );
  }
  if (!document) throw new Error("Không cập nhật được trạng thái hồ sơ hợp đồng.");
  return { profile: toProfile(document), replacedFile: input.side === "front" ? existing.citizenIdFront : existing.citizenIdBack };
}

export async function listEmployeeContractSummaries() {
  const collection = await getContractCollection();
  const documents = await collection.find({}, {
    projection: { personKey: 1, completed: 1, citizenIdFront: 1, citizenIdBack: 1, updatedAt: 1, driveSync: 1 }
  }).toArray();
  return new Map(documents.map((document) => [document.personKey, {
    completed: document.completed,
    hasFront: Boolean(document.citizenIdFront?.publicId),
    hasBack: Boolean(document.citizenIdBack?.publicId),
    updatedAt: document.updatedAt?.toISOString(),
    driveSync: document.driveSync
      ? {
          status: document.driveSync.status,
          syncedAt: document.driveSync.syncedAt?.toISOString(),
          folderId: document.driveSync.folderId || undefined,
          error: document.driveSync.error || undefined
        }
      : undefined
  } satisfies EmployeeContractSummary]));
}

export async function listEmployeeContractProfiles() {
  const collection = await getContractCollection();
  const documents = await collection.find({}).toArray();
  return documents.map((document) => ({
    personKey: document.personKey,
    ...toProfile(document)
  } satisfies EmployeeContractProfileRecord));
}

export function employeeContractPersonKey(role: EmployeeRole, employeeId: string) {
  return personKey(role, employeeId);
}

export async function setEmployeeContractDriveSyncStatus(input: {
  role: EmployeeRole;
  employeeId: string;
  employeeName?: string;
  status: "success" | "error";
  syncedAt?: Date;
  folderId?: string;
  error?: string;
}) {
  const collection = await getContractCollection();
  const syncedAt = input.syncedAt || new Date();
  await collection.updateOne(
    { personKey: personKey(input.role, input.employeeId) },
    {
      $setOnInsert: {
        personKey: personKey(input.role, input.employeeId),
        role: input.role,
        employeeId: input.employeeId,
        employeeName: input.employeeName || ""
      },
      $set: {
        driveSync: {
          status: input.status,
          syncedAt,
          folderId: input.folderId || "",
          error: input.error || ""
        }
      }
    },
    { upsert: true }
  );
}
