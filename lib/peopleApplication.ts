import { randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import {
  allocateNextScheduleEmployeeId,
  createSchedulePerson,
  findSchedulePerson,
  findSchedulePersonByPhone,
  updateSchedulePerson,
  type SchedulePersonMutation
} from "@/lib/employeeRoster";
import { buildAppsScriptApplicationPayload, buildEmployeeMutationFromApplication } from "@/lib/applicationAutomation";
import { postToAppScript } from "@/lib/appScriptSync";
import { getMongoDatabase } from "@/lib/mongodb";
import { upsertRecruitmentProfileFromApplication } from "@/lib/recruitmentProfile";
import type { EmployeeRole } from "@/lib/types";

const APPLICATIONS_COLLECTION = "people_applications";

export type PeopleApplicationStatus = "new" | "reviewing" | "accepted" | "rejected";
export type PeopleApplicationLiveLocationPreference = "home" | "studio";
export type PeopleApplicationLiveAccountPreference = "personal" | "company";

export type PeopleApplicationInput = {
  role?: EmployeeRole;
  fullName?: string;
  aliasName?: string;
  phone?: string;
  email?: string;
  cvUrl?: string;
  experience?: string;
  achievements?: string;
  expectedSalary?: string;
  canLiveHome?: boolean;
  canLiveStudio?: boolean;
  canUsePersonalAccount?: boolean;
  canUseCompanyAccount?: boolean;
  liveLocationPreference?: PeopleApplicationLiveLocationPreference;
  liveAccountPreference?: PeopleApplicationLiveAccountPreference;
  introVideoUrl?: string;
  tiktokUrl?: string;
  notes?: string;
  consent?: boolean;
};

export type PeopleApplication = {
  applicationId: string;
  employeeId?: string;
  role: EmployeeRole;
  fullName: string;
  aliasName: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  canLiveHome: boolean;
  canLiveStudio: boolean;
  canUsePersonalAccount: boolean;
  canUseCompanyAccount: boolean;
  liveLocationPreference: PeopleApplicationLiveLocationPreference | "";
  liveAccountPreference: PeopleApplicationLiveAccountPreference | "";
  introVideoUrl: string;
  tiktokUrl: string;
  notes: string;
  status: PeopleApplicationStatus;
  sheetSyncStatus?: "synced" | "failed";
  sheetSyncedAt?: string;
  sheetSyncError?: string;
  submittedAt: string;
  updatedAt: string;
};

type PeopleApplicationDocument = Omit<PeopleApplication, "submittedAt" | "updatedAt" | "sheetSyncedAt"> & {
  normalizedPhone: string;
  submittedAt: Date;
  updatedAt: Date;
  consentedAt: Date;
  resubmittedAt?: Date;
  sheetSyncedAt?: Date;
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

function normalizeLiveLocationPreference(value: unknown, role?: EmployeeRole): PeopleApplicationLiveLocationPreference | "" {
  if (role !== "host") return "";
  if (value === "home" || value === "studio") return value;
  throw new Error("Vui lòng chọn nơi live mong muốn.");
}

function normalizeLiveAccountPreference(value: unknown, role?: EmployeeRole): PeopleApplicationLiveAccountPreference | "" {
  if (role !== "host") return "";
  if (value === "personal" || value === "company") return value;
  throw new Error("Vui lòng chọn loại tài khoản live.");
}

function normalizeInput(input: PeopleApplicationInput) {
  const role = input.role;
  const fullName = cleanText(input.fullName, 120);
  const aliasName = cleanText(input.aliasName, 120);
  const phone = normalizePhone(input.phone);
  const email = cleanText(input.email, 180).toLowerCase();
  const cvUrl = cleanText(input.cvUrl, 1000);
  const experience = cleanMultilineText(input.experience, 3000);
  const achievements = cleanMultilineText(input.achievements, 2000);
  const expectedSalary = cleanText(input.expectedSalary, 120);
  const canLiveHome = role === "host"
    ? (typeof input.canLiveHome === "boolean" ? input.canLiveHome : input.liveLocationPreference === "home")
    : false;
  const canLiveStudio = role === "host"
    ? (typeof input.canLiveStudio === "boolean" ? input.canLiveStudio : input.liveLocationPreference === "studio")
    : false;
  const canUsePersonalAccount = role === "host"
    ? (typeof input.canUsePersonalAccount === "boolean" ? input.canUsePersonalAccount : input.liveAccountPreference === "personal")
    : false;
  const canUseCompanyAccount = role === "host"
    ? (typeof input.canUseCompanyAccount === "boolean" ? input.canUseCompanyAccount : input.liveAccountPreference === "company")
    : false;
  const liveLocationPreference = role === "host"
    ? normalizeLiveLocationPreference(
      canLiveHome ? "home" : canLiveStudio ? "studio" : input.liveLocationPreference,
      role
    )
    : "";
  const liveAccountPreference = role === "host"
    ? normalizeLiveAccountPreference(
      canUseCompanyAccount ? "company" : canUsePersonalAccount ? "personal" : input.liveAccountPreference,
      role
    )
    : "";
  const introVideoUrl = role === "host" ? cleanText(input.introVideoUrl, 1000) : "";
  const tiktokUrl = role === "host" ? cleanText(input.tiktokUrl, 1000) : "";
  const notes = cleanMultilineText(input.notes, 2000);

  if (role !== "host" && role !== "support") throw new Error("Vui lòng chọn Host hoặc Support Live.");
  if (fullName.length < 2) throw new Error("Vui lòng nhập đầy đủ họ tên.");
  if (!/^\+?\d{9,15}$/.test(phone)) throw new Error("Số điện thoại không hợp lệ.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email không hợp lệ.");
  if (role === "host" && !canLiveHome && !canLiveStudio) throw new Error("Vui lòng chọn ít nhất một nơi có thể live.");
  if (role === "host" && !canUsePersonalAccount && !canUseCompanyAccount) throw new Error("Vui lòng chọn ít nhất một loại tài khoản live.");
  if (experience.length < 10) throw new Error("Vui lòng mô tả kinh nghiệm cụ thể hơn.");
  if (!expectedSalary) throw new Error("Vui lòng nhập mức lương mong muốn.");
  if (input.consent !== true) throw new Error("Bạn cần đồng ý để hệ thống lưu thông tin ứng tuyển.");
  assertWebUrl(cvUrl, "Link CV", true);
  assertWebUrl(introVideoUrl, "Link video");
  assertWebUrl(tiktokUrl, "Link TikTok");

  return {
    role,
    fullName,
    aliasName,
    phone,
    normalizedPhone: phone.replace(/\D/g, ""),
    email,
    cvUrl,
    experience,
    achievements,
    expectedSalary,
    canLiveHome,
    canLiveStudio,
    canUsePersonalAccount,
    canUseCompanyAccount,
    liveLocationPreference,
    liveAccountPreference,
    introVideoUrl,
    tiktokUrl,
    notes
  };
}

function toApplication(document: PeopleApplicationDocument): PeopleApplication {
  const submittedAt = document.submittedAt instanceof Date
    ? document.submittedAt
    : document.updatedAt instanceof Date
      ? document.updatedAt
      : new Date();
  const updatedAt = document.updatedAt instanceof Date
    ? document.updatedAt
    : submittedAt;
  return {
    applicationId: document.applicationId,
    employeeId: document.employeeId || undefined,
    role: document.role,
    fullName: document.fullName,
    aliasName: document.aliasName,
    phone: document.phone,
    email: document.email,
    cvUrl: document.cvUrl,
    experience: document.experience,
    achievements: document.achievements,
    expectedSalary: document.expectedSalary,
    canLiveHome: Boolean(document.canLiveHome),
    canLiveStudio: Boolean(document.canLiveStudio),
    canUsePersonalAccount: Boolean(document.canUsePersonalAccount),
    canUseCompanyAccount: Boolean(document.canUseCompanyAccount),
    liveLocationPreference: document.liveLocationPreference || "",
    liveAccountPreference: document.liveAccountPreference || "",
    introVideoUrl: document.introVideoUrl,
    tiktokUrl: document.tiktokUrl,
    notes: document.notes,
    status: document.status,
    sheetSyncStatus: document.sheetSyncStatus,
    sheetSyncedAt: document.sheetSyncedAt?.toISOString(),
    sheetSyncError: document.sheetSyncError,
    submittedAt: submittedAt.toISOString(),
    updatedAt: updatedAt.toISOString()
  };
}

function buildApplicationEmployeeMutation(application: PeopleApplication, employeeId: string): SchedulePersonMutation {
  return buildEmployeeMutationFromApplication({
    applicationId: application.applicationId,
    submittedAt: application.submittedAt,
    role: application.role,
    fullName: application.fullName,
    aliasName: application.aliasName,
    phone: application.phone,
    email: application.email,
    cvUrl: application.cvUrl,
    experience: application.experience,
    achievements: application.achievements,
    expectedSalary: application.expectedSalary,
    canLiveHome: application.canLiveHome,
    canLiveStudio: application.canLiveStudio,
    canUsePersonalAccount: application.canUsePersonalAccount,
    canUseCompanyAccount: application.canUseCompanyAccount,
    liveLocationPreference: application.liveLocationPreference || "",
    liveAccountPreference: application.liveAccountPreference || "",
    introVideoUrl: application.introVideoUrl,
    tiktokUrl: application.tiktokUrl,
    notes: application.notes
  }, employeeId);
}

async function upsertEmployeeFromApplication(application: PeopleApplication) {
  const actorAccountKey = "application:auto";
  const linkedEmployee = application.employeeId
    ? await findSchedulePerson(application.role, application.employeeId)
    : null;
  const phoneMatchedEmployee = linkedEmployee || await findSchedulePersonByPhone(application.role, application.phone);

  if (phoneMatchedEmployee) {
    const mutation = buildApplicationEmployeeMutation(application, phoneMatchedEmployee.id);
    const employee = await updateSchedulePerson(mutation, actorAccountKey);
    return { employee, created: false };
  }

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const employeeId = await allocateNextScheduleEmployeeId(application.role);
    try {
      const employee = await createSchedulePerson(
        buildApplicationEmployeeMutation(application, employeeId),
        actorAccountKey
      );
      return { employee, created: true };
    } catch (error) {
      if (
        error instanceof Error
        && error.message.includes("Mã nhân viên đã tồn tại")
        && attempt < maxAttempts - 1
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Không cấp được mã nhân sự mới.");
}

async function syncApplicationToGoogleSheet(application: PeopleApplication & { employeeId: string }) {
  return postToAppScript(buildAppsScriptApplicationPayload({
    applicationId: application.applicationId,
    submittedAt: application.submittedAt,
    employeeId: application.employeeId,
    role: application.role,
    fullName: application.fullName,
    aliasName: application.aliasName,
    phone: application.phone,
    email: application.email,
    cvUrl: application.cvUrl,
    experience: application.experience,
    achievements: application.achievements,
    expectedSalary: application.expectedSalary,
    canLiveHome: application.canLiveHome,
    canLiveStudio: application.canLiveStudio,
    canUsePersonalAccount: application.canUsePersonalAccount,
    canUseCompanyAccount: application.canUseCompanyAccount,
    liveLocationPreference: application.liveLocationPreference || "",
    liveAccountPreference: application.liveAccountPreference || "",
    introVideoUrl: application.introVideoUrl,
    tiktokUrl: application.tiktokUrl,
    notes: application.notes
  }));
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
    role: normalized.role
  });
  const baseDocument: PeopleApplicationDocument = existing
    ? {
        ...existing,
        ...normalized,
        updatedAt: now,
        resubmittedAt: now,
        sheetSyncStatus: existing.sheetSyncStatus,
        sheetSyncError: existing.sheetSyncError,
        employeeId: existing.employeeId
      }
    : {
        applicationId: randomUUID(),
        ...normalized,
        status: "new",
        submittedAt: now,
        updatedAt: now,
        consentedAt: now
      };

  const application = toApplication(baseDocument);
  const { employee, created } = await upsertEmployeeFromApplication(application);
  await upsertRecruitmentProfileFromApplication({
    application: { ...application, employeeId: employee.id },
    employeeId: employee.id,
    actorAccountKey: "application:auto"
  });

  try {
    await syncApplicationToGoogleSheet({ ...application, employeeId: employee.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đồng bộ được dữ liệu sang Google Sheet.";
    const failedStatus = existing
      ? await collection.findOneAndUpdate(
          { applicationId: existing.applicationId },
          {
            $set: {
              ...normalized,
              employeeId: employee.id,
              status: "accepted",
              updatedAt: now,
              resubmittedAt: now,
              sheetSyncStatus: "failed",
              sheetSyncError: message
            }
          },
          { upsert: true, returnDocument: "after" }
        )
      : await collection.findOneAndUpdate(
          { applicationId: baseDocument.applicationId },
          {
            $setOnInsert: { submittedAt: now, consentedAt: now },
            $set: {
              ...normalized,
              applicationId: baseDocument.applicationId,
              normalizedPhone: normalized.normalizedPhone,
              employeeId: employee.id,
              status: "accepted",
              updatedAt: now,
              sheetSyncStatus: "failed",
              sheetSyncError: message
            }
          },
          { upsert: true, returnDocument: "after" }
        );
    if (!failedStatus) throw new Error(message);
    throw new Error(`Hồ sơ đã lưu với mã ${employee.id}, nhưng chưa đẩy được sang Google Sheet: ${message}`);
  }

  const persisted = existing
    ? await collection.findOneAndUpdate(
        { applicationId: existing.applicationId },
        {
          $set: {
            ...normalized,
            employeeId: employee.id,
            status: "accepted",
            updatedAt: now,
            resubmittedAt: now,
            sheetSyncStatus: "synced",
            sheetSyncedAt: now,
            sheetSyncError: ""
          }
        },
        { returnDocument: "after" }
      )
    : await collection.findOneAndUpdate(
        { applicationId: baseDocument.applicationId },
        {
          $setOnInsert: { submittedAt: now, consentedAt: now },
          $set: {
            ...normalized,
            applicationId: baseDocument.applicationId,
            normalizedPhone: normalized.normalizedPhone,
            employeeId: employee.id,
            status: "accepted",
            updatedAt: now,
            sheetSyncStatus: "synced",
            sheetSyncedAt: now,
            sheetSyncError: ""
          }
        },
        { upsert: true, returnDocument: "after" }
      );

  if (!persisted) throw new Error("Không lưu được hồ sơ ứng tuyển.");
  return { application: toApplication(persisted), updated: !created };
}

export async function listPeopleApplications() {
  const collection = await getApplicationsCollection();
  const documents = await collection.find({}).sort({ submittedAt: -1 }).limit(500).toArray();
  return documents.map(toApplication);
}

export async function getLatestPeopleApplicationForEmployee(role: EmployeeRole, employeeId: string) {
  const collection = await getApplicationsCollection();
  const document = await collection.findOne(
    { role, employeeId: employeeId.trim() },
    { sort: { updatedAt: -1, submittedAt: -1 } }
  );
  return document ? toApplication(document) : null;
}
