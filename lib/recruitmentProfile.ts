import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import type { EmployeeRole } from "@/lib/types";
import type { PeopleApplication } from "@/lib/peopleApplication";

const RECRUITMENT_COLLECTION = "recruitment_profiles";

export type RecruitmentProfile = {
  role: EmployeeRole;
  employeeId: string;
  applicationId?: string;
  fullName: string;
  aliasName: string;
  phone: string;
  email: string;
  cvUrl: string;
  experience: string;
  achievements: string;
  expectedSalary: string;
  introVideoUrl: string;
  tiktokUrl: string;
  zaloJoined: boolean;
  level: string;
  rating: string;
  trainingJoined: boolean;
  liveChannelId: string;
  canLiveHome: boolean;
  canLiveStudio: boolean;
  canUsePersonalAccount: boolean;
  canUseCompanyAccount: boolean;
  liveLocationPreference: "home" | "studio" | "";
  liveAccountPreference: "personal" | "company" | "";
  salaryOffered?: string;
  salaryOfferFeedback?: string;
  evaluationSummary?: string;
  supportGemOffer?: string;
  cashOfferReality?: string;
  dealStatus?: string;
  supportMainOfferNote?: string;
  notes: string;
  sourceTab: string;
  updatedAt: string;
  createdAt: string;
};

type RecruitmentProfileDocument = Omit<RecruitmentProfile, "updatedAt" | "createdAt"> & {
  personKey: string;
  updatedAt: Date;
  createdAt: Date;
  updatedBy: string;
  createdBy: string;
};

let indexesPromise: Promise<unknown> | null = null;

function cleanText(value: unknown, maxLength = 2000) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function personKey(role: EmployeeRole, employeeId: string) {
  return `${role}:${employeeId.trim().toLowerCase()}`;
}

function toProfile(document: RecruitmentProfileDocument): RecruitmentProfile {
  return {
    role: document.role,
    employeeId: document.employeeId,
    applicationId: document.applicationId || undefined,
    fullName: document.fullName,
    aliasName: document.aliasName,
    phone: document.phone,
    email: document.email,
    cvUrl: document.cvUrl,
    experience: document.experience,
    achievements: document.achievements,
    expectedSalary: document.expectedSalary,
    introVideoUrl: document.introVideoUrl,
    tiktokUrl: document.tiktokUrl,
    zaloJoined: Boolean(document.zaloJoined),
    level: document.level || "",
    rating: document.rating || "",
    trainingJoined: Boolean(document.trainingJoined),
    liveChannelId: document.liveChannelId || "",
    canLiveHome: document.canLiveHome,
    canLiveStudio: document.canLiveStudio,
    canUsePersonalAccount: document.canUsePersonalAccount,
    canUseCompanyAccount: document.canUseCompanyAccount,
    liveLocationPreference: document.liveLocationPreference,
    liveAccountPreference: document.liveAccountPreference,
    salaryOffered: document.salaryOffered || undefined,
    salaryOfferFeedback: document.salaryOfferFeedback || undefined,
    evaluationSummary: document.evaluationSummary || undefined,
    supportGemOffer: document.supportGemOffer || undefined,
    cashOfferReality: document.cashOfferReality || undefined,
    dealStatus: document.dealStatus || undefined,
    supportMainOfferNote: document.supportMainOfferNote || undefined,
    notes: document.notes,
    sourceTab: document.sourceTab,
    updatedAt: document.updatedAt.toISOString(),
    createdAt: document.createdAt.toISOString()
  };
}

async function getCollection(): Promise<Collection<RecruitmentProfileDocument>> {
  const database = await getMongoDatabase();
  const collection = database.collection<RecruitmentProfileDocument>(RECRUITMENT_COLLECTION);
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      collection.createIndex({ personKey: 1 }, { unique: true }),
      collection.createIndex({ applicationId: 1 }),
      collection.createIndex({ role: 1, updatedAt: -1 })
    ]).catch((error) => {
      indexesPromise = null;
      throw error;
    });
  }
  await indexesPromise;
  return collection;
}

export async function upsertRecruitmentProfileFromApplication(input: {
  application: PeopleApplication;
  employeeId: string;
  actorAccountKey: string;
}) {
  const collection = await getCollection();
  const now = new Date();
  const document = await collection.findOneAndUpdate(
    { personKey: personKey(input.application.role, input.employeeId) },
    {
      $set: {
        role: input.application.role,
        employeeId: input.employeeId,
        applicationId: input.application.applicationId,
        fullName: input.application.fullName,
        aliasName: input.application.aliasName,
        phone: input.application.phone,
        email: input.application.email,
        cvUrl: input.application.cvUrl,
        experience: input.application.experience,
        achievements: input.application.achievements,
        expectedSalary: input.application.expectedSalary,
        introVideoUrl: input.application.introVideoUrl,
        tiktokUrl: input.application.tiktokUrl,
        zaloJoined: false,
        level: "",
        rating: "",
        trainingJoined: false,
        liveChannelId: "",
        canLiveHome: input.application.canLiveHome,
        canLiveStudio: input.application.canLiveStudio,
        canUsePersonalAccount: input.application.canUsePersonalAccount,
        canUseCompanyAccount: input.application.canUseCompanyAccount,
        liveLocationPreference: input.application.liveLocationPreference,
        liveAccountPreference: input.application.liveAccountPreference,
        salaryOffered: "",
        salaryOfferFeedback: "",
        evaluationSummary: "",
        supportGemOffer: "",
        cashOfferReality: "",
        dealStatus: "",
        supportMainOfferNote: "",
        notes: input.application.notes,
        sourceTab: input.application.role === "host" ? "Thông tin Mẫu Live" : "Thông tin Support Live",
        updatedAt: now,
        updatedBy: input.actorAccountKey
      },
      $setOnInsert: {
        personKey: personKey(input.application.role, input.employeeId),
        createdAt: now,
        createdBy: input.actorAccountKey
      }
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!document) throw new Error("Không lưu được hồ sơ tuyển dụng.");
  return toProfile(document);
}

export async function upsertRecruitmentProfile(input: {
  role: EmployeeRole;
  employeeId: string;
  actorAccountKey: string;
  values: Partial<RecruitmentProfile> & Pick<RecruitmentProfile, "fullName" | "phone" | "sourceTab">;
}) {
  const collection = await getCollection();
  const now = new Date();
  const existing = await collection.findOne({ personKey: personKey(input.role, input.employeeId) });
  const next = await collection.findOneAndUpdate(
    { personKey: personKey(input.role, input.employeeId) },
    {
      $set: {
        role: input.role,
        employeeId: input.employeeId,
        applicationId: cleanText(input.values.applicationId, 80),
        fullName: cleanText(input.values.fullName, 120) || existing?.fullName || "",
        aliasName: cleanText(input.values.aliasName, 120),
        phone: cleanText(input.values.phone, 30) || existing?.phone || "",
        email: cleanText(input.values.email, 180).toLowerCase(),
        cvUrl: cleanText(input.values.cvUrl, 1000),
        experience: cleanText(input.values.experience, 3000),
        achievements: cleanText(input.values.achievements, 2000),
        expectedSalary: cleanText(input.values.expectedSalary, 120),
        introVideoUrl: cleanText(input.values.introVideoUrl, 1000),
        tiktokUrl: cleanText(input.values.tiktokUrl, 1000),
        zaloJoined: Boolean(input.values.zaloJoined),
        level: cleanText(input.values.level, 120),
        rating: cleanText(input.values.rating, 120),
        trainingJoined: Boolean(input.values.trainingJoined),
        liveChannelId: cleanText(input.values.liveChannelId, 200),
        canLiveHome: Boolean(input.values.canLiveHome),
        canLiveStudio: Boolean(input.values.canLiveStudio),
        canUsePersonalAccount: Boolean(input.values.canUsePersonalAccount),
        canUseCompanyAccount: Boolean(input.values.canUseCompanyAccount),
        liveLocationPreference: input.values.liveLocationPreference === "studio" ? "studio" : input.values.liveLocationPreference === "home" ? "home" : "",
        liveAccountPreference: input.values.liveAccountPreference === "personal" ? "personal" : input.values.liveAccountPreference === "company" ? "company" : "",
        salaryOffered: cleanText(input.values.salaryOffered, 200),
        salaryOfferFeedback: cleanText(input.values.salaryOfferFeedback, 500),
        evaluationSummary: cleanText(input.values.evaluationSummary, 3000),
        supportGemOffer: cleanText(input.values.supportGemOffer, 200),
        cashOfferReality: cleanText(input.values.cashOfferReality, 200),
        dealStatus: cleanText(input.values.dealStatus, 200),
        supportMainOfferNote: cleanText(input.values.supportMainOfferNote, 1000),
        notes: cleanText(input.values.notes, 3000),
        sourceTab: cleanText(input.values.sourceTab, 120) || existing?.sourceTab || "",
        updatedAt: now,
        updatedBy: input.actorAccountKey
      },
      $setOnInsert: {
        personKey: personKey(input.role, input.employeeId),
        createdAt: now,
        createdBy: input.actorAccountKey
      }
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!next) throw new Error("Không lưu được hồ sơ tuyển dụng.");
  return toProfile(next);
}

export async function listRecruitmentProfiles() {
  const collection = await getCollection();
  const documents = await collection.find({}).sort({ updatedAt: -1 }).limit(1000).toArray();
  return documents.map(toProfile);
}

export async function saveRecruitmentProfile(input: {
  role: EmployeeRole;
  employeeId: string;
  actorAccountKey: string;
  values: Partial<RecruitmentProfile>;
}) {
  const collection = await getCollection();
  const key = personKey(input.role, input.employeeId);
  const existing = await collection.findOne({ personKey: key });
  if (!existing) throw new Error("Không tìm thấy hồ sơ tuyển dụng.");
  const now = new Date();
  const values = input.values;
  const next = await collection.findOneAndUpdate(
    { personKey: key },
    {
      $set: {
        fullName: cleanText(values.fullName, 120) || existing.fullName,
        aliasName: cleanText(values.aliasName, 120),
        phone: cleanText(values.phone, 30) || existing.phone,
        email: cleanText(values.email, 180).toLowerCase(),
        cvUrl: cleanText(values.cvUrl, 1000),
        experience: cleanText(values.experience, 3000),
        achievements: cleanText(values.achievements, 2000),
        expectedSalary: cleanText(values.expectedSalary, 120),
        introVideoUrl: cleanText(values.introVideoUrl, 1000),
        tiktokUrl: cleanText(values.tiktokUrl, 1000),
        zaloJoined: Boolean(values.zaloJoined),
        level: cleanText(values.level, 120),
        rating: cleanText(values.rating, 120),
        trainingJoined: Boolean(values.trainingJoined),
        liveChannelId: cleanText(values.liveChannelId, 200),
        canLiveHome: Boolean(values.canLiveHome),
        canLiveStudio: Boolean(values.canLiveStudio),
        canUsePersonalAccount: Boolean(values.canUsePersonalAccount),
        canUseCompanyAccount: Boolean(values.canUseCompanyAccount),
        liveLocationPreference: values.liveLocationPreference === "studio" ? "studio" : values.liveLocationPreference === "home" ? "home" : "",
        liveAccountPreference: values.liveAccountPreference === "personal" ? "personal" : values.liveAccountPreference === "company" ? "company" : "",
        salaryOffered: cleanText(values.salaryOffered, 200),
        salaryOfferFeedback: cleanText(values.salaryOfferFeedback, 500),
        evaluationSummary: cleanText(values.evaluationSummary, 3000),
        supportGemOffer: cleanText(values.supportGemOffer, 200),
        cashOfferReality: cleanText(values.cashOfferReality, 200),
        dealStatus: cleanText(values.dealStatus, 200),
        supportMainOfferNote: cleanText(values.supportMainOfferNote, 1000),
        notes: cleanText(values.notes, 3000),
        updatedAt: now,
        updatedBy: input.actorAccountKey
      }
    },
    { returnDocument: "after" }
  );
  if (!next) throw new Error("Không lưu được hồ sơ tuyển dụng.");
  return toProfile(next);
}
