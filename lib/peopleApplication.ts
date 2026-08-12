import { randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import type { EmployeeRole } from "@/lib/types";

const APPLICATIONS_COLLECTION = "people_applications";

export type PeopleApplicationStatus = "new" | "reviewing" | "accepted" | "rejected";

export type PeopleApplicationInput = {
  role?: EmployeeRole;
  fullName?: string;
  phone?: string;
  email?: string;
  cvUrl?: string;
  experience?: string;
  achievements?: string;
  expectedSalary?: string;
  introVideoUrl?: string;
  tiktokUrl?: string;
  notes?: string;
  consent?: boolean;
};

export type PeopleApplication = {
  applicationId: string;
  role: EmployeeRole;
  fullName: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  introVideoUrl: string;
  tiktokUrl: string;
  notes: string;
  status: PeopleApplicationStatus;
  submittedAt: string;
  updatedAt: string;
};

type PeopleApplicationDocument = Omit<PeopleApplication, "submittedAt" | "updatedAt"> & {
  normalizedPhone: string;
  submittedAt: Date;
  updatedAt: Date;
  consentedAt: Date;
  resubmittedAt?: Date;
};

let indexesPromise: Promise<unknown> | null = null;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanMultilineText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, maxLength) : "";
}

function normalizePhone(value: unknown) {
  const raw = cleanText(value, 30);
  const digits = raw.replace(/\D/g, "");
  return raw.startsWith("+") ? `+${digits}` : digits;
}

function assertWebUrl(value: string, label: string, required = false) {
  if (!value) {
    if (required) throw new Error(`${label} không được để trống.`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`${label} phải là đường link http hoặc https hợp lệ.`);
  }
}

function normalizeInput(input: PeopleApplicationInput) {
  const role = input.role;
  const fullName = cleanText(input.fullName, 120);
  const phone = normalizePhone(input.phone);
  const email = cleanText(input.email, 180).toLowerCase();
  const cvUrl = cleanText(input.cvUrl, 1000);
  const experience = cleanMultilineText(input.experience, 3000);
  const achievements = cleanMultilineText(input.achievements, 2000);
  const expectedSalary = cleanText(input.expectedSalary, 120);
  const introVideoUrl = role === "host" ? cleanText(input.introVideoUrl, 1000) : "";
  const tiktokUrl = role === "host" ? cleanText(input.tiktokUrl, 1000) : "";
  const notes = cleanMultilineText(input.notes, 2000);

  if (role !== "host" && role !== "support") throw new Error("Vui lòng chọn Host hoặc Support Live.");
  if (fullName.length < 2) throw new Error("Vui lòng nhập đầy đủ họ tên.");
  if (!/^\+?\d{9,15}$/.test(phone)) throw new Error("Số điện thoại không hợp lệ.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email không hợp lệ.");
  if (experience.length < 10) throw new Error("Vui lòng mô tả kinh nghiệm cụ thể hơn.");
  if (!expectedSalary) throw new Error("Vui lòng nhập mức lương mong muốn.");
  if (input.consent !== true) throw new Error("Bạn cần đồng ý để hệ thống lưu thông tin ứng tuyển.");
  assertWebUrl(cvUrl, "Link CV", true);
  assertWebUrl(introVideoUrl, "Link video");
  assertWebUrl(tiktokUrl, "Link TikTok");

  return {
    role,
    fullName,
    phone,
    normalizedPhone: phone.replace(/\D/g, ""),
    email,
    cvUrl,
    experience,
    achievements,
    expectedSalary,
    introVideoUrl,
    tiktokUrl,
    notes
  };
}

function toApplication(document: PeopleApplicationDocument): PeopleApplication {
  return {
    applicationId: document.applicationId,
    role: document.role,
    fullName: document.fullName,
    phone: document.phone,
    email: document.email,
    cvUrl: document.cvUrl,
    experience: document.experience,
    achievements: document.achievements,
    expectedSalary: document.expectedSalary,
    introVideoUrl: document.introVideoUrl,
    tiktokUrl: document.tiktokUrl,
    notes: document.notes,
    status: document.status,
    submittedAt: document.submittedAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

async function getApplicationsCollection(): Promise<Collection<PeopleApplicationDocument>> {
  const database = await getMongoDatabase();
  const collection = database.collection<PeopleApplicationDocument>(APPLICATIONS_COLLECTION);
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      collection.createIndex({ applicationId: 1 }, { unique: true }),
      collection.createIndex({ status: 1, submittedAt: -1 }),
      collection.createIndex({ normalizedPhone: 1, role: 1, status: 1 })
    ]).catch((error) => {
      indexesPromise = null;
      throw error;
    });
  }
  await indexesPromise;
  return collection;
}

export async function submitPeopleApplication(input: PeopleApplicationInput) {
  const normalized = normalizeInput(input);
  const collection = await getApplicationsCollection();
  const now = new Date();
  const existing = await collection.findOne({
    normalizedPhone: normalized.normalizedPhone,
    role: normalized.role,
    status: { $in: ["new", "reviewing"] }
  });

  if (existing) {
    const result = await collection.findOneAndUpdate(
      { applicationId: existing.applicationId },
      { $set: { ...normalized, updatedAt: now, resubmittedAt: now } },
      { returnDocument: "after" }
    );
    if (!result) throw new Error("Không cập nhật được hồ sơ đã gửi.");
    return { application: toApplication(result), updated: true };
  }

  const document: PeopleApplicationDocument = {
    applicationId: randomUUID(),
    ...normalized,
    status: "new",
    submittedAt: now,
    updatedAt: now,
    consentedAt: now
  };
  await collection.insertOne(document);
  return { application: toApplication(document), updated: false };
}

export async function listPeopleApplications() {
  const collection = await getApplicationsCollection();
  const documents = await collection.find({}).sort({ submittedAt: -1 }).limit(500).toArray();
  return documents.map(toApplication);
}
