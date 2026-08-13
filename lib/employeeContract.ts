import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import {
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

type EmployeeContractDocument = NormalizedEmployeeContractInput & {
  personKey: string;
  role: EmployeeRole;
  employeeId: string;
  normalizedEmployeeId: string;
  employeeName: string;
  citizenIdFront?: StoredEmployeeContractFile;
  citizenIdBack?: StoredEmployeeContractFile;
  completed: boolean;
  submittedAt?: Date;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
};

export type EmployeeContractProfile = NormalizedEmployeeContractInput & {
  role: EmployeeRole;
  employeeId: string;
  employeeName: string;
  citizenIdFront?: EmployeeContractFile;
  citizenIdBack?: EmployeeContractFile;
  completed: boolean;
  submittedAt?: string;
  updatedAt: string;
};

export type EmployeeContractSummary = {
  completed: boolean;
  hasFront: boolean;
  hasBack: boolean;
  updatedAt?: string;
};

let contractIndexesPromise: Promise<unknown> | null = null;

function normalizeEmployeeId(employeeId: string) {
  return employeeId.trim().toLowerCase();
}

function personKey(role: EmployeeRole, employeeId: string) {
  return `${role}:${normalizeEmployeeId(employeeId)}`;
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
    projection: { personKey: 1, completed: 1, citizenIdFront: 1, citizenIdBack: 1, updatedAt: 1 }
  }).toArray();
  return new Map(documents.map((document) => [document.personKey, {
    completed: document.completed,
    hasFront: Boolean(document.citizenIdFront?.publicId),
    hasBack: Boolean(document.citizenIdBack?.publicId),
    updatedAt: document.updatedAt?.toISOString()
  } satisfies EmployeeContractSummary]));
}

export function employeeContractPersonKey(role: EmployeeRole, employeeId: string) {
  return personKey(role, employeeId);
}
