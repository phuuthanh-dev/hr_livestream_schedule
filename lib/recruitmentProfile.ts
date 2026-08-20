import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import type { EmployeeRole } from "@/lib/types";
import type { PeopleApplication } from "@/lib/peopleApplication";

const RECRUITMENT_COLLECTION = "recruitment_profiles";

export type RecruitmentProfile = {
  role: EmployeeRole;
  employeeId: string;
  applicationId?: string;
  sheetContractCode?: string;
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
  followerCount?: string;
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
  cashOfferRealityRoundTwo?: string;
  dealStatusRoundTwo?: string;
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

function resolveTextUpdate(value: unknown, existingValue: string, maxLength = 2000) {
  return value === undefined ? existingValue : cleanText(value, maxLength);
}

function resolveBooleanUpdate(value: unknown, existingValue: boolean) {
  return value === undefined ? existingValue : Boolean(value);
}

function personKey(role: EmployeeRole, employeeId: string) {
  return `${role}:${employeeId.trim().toLowerCase()}`;
}

function toProfile(document: RecruitmentProfileDocument): RecruitmentProfile {
  return {
    role: document.role,
    employeeId: document.employeeId,
    applicationId: document.applicationId || undefined,
    sheetContractCode: document.sheetContractCode || undefined,
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
    followerCount: document.followerCount || undefined,
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
    cashOfferRealityRoundTwo: document.cashOfferRealityRoundTwo || undefined,
    dealStatusRoundTwo: document.dealStatusRoundTwo || undefined,
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
  const existing = await collection.findOne({ personKey: personKey(input.application.role, input.employeeId) });
  const defaultLevel = input.application.role === "host" ? "Thử việc" : "Cấp 1";
  const defaultRating = input.application.role === "host" ? "Thử việc" : "D";
  const document = await collection.findOneAndUpdate(
    { personKey: personKey(input.application.role, input.employeeId) },
    {
      $set: {
        role: input.application.role,
        employeeId: input.employeeId,
        applicationId: input.application.applicationId,
        sheetContractCode: "",
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
        followerCount: existing?.followerCount || "",
        zaloJoined: existing?.zaloJoined || false,
        level: existing?.level || defaultLevel,
        rating: existing?.rating || defaultRating,
        trainingJoined: existing?.trainingJoined || false,
        liveChannelId: existing?.liveChannelId || "",
        canLiveHome: input.application.canLiveHome,
        canLiveStudio: input.application.canLiveStudio,
        canUsePersonalAccount: input.application.canUsePersonalAccount,
        canUseCompanyAccount: input.application.canUseCompanyAccount,
        liveLocationPreference: input.application.liveLocationPreference,
        liveAccountPreference: input.application.liveAccountPreference,
        salaryOffered: existing?.salaryOffered || "",
        salaryOfferFeedback: existing?.salaryOfferFeedback || "",
        evaluationSummary: existing?.evaluationSummary || "",
        supportGemOffer: existing?.supportGemOffer || "",
        cashOfferReality: existing?.cashOfferReality || "",
        dealStatus: existing?.dealStatus || "",
        cashOfferRealityRoundTwo: existing?.cashOfferRealityRoundTwo || "",
        dealStatusRoundTwo: existing?.dealStatusRoundTwo || "",
        supportMainOfferNote: existing?.supportMainOfferNote || "",
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

export async function deleteRecruitmentProfile(role: EmployeeRole, employeeId: string) {
  const collection = await getCollection();
  await collection.deleteOne({ personKey: personKey(role, employeeId) });
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
        sheetContractCode: cleanText(input.values.sheetContractCode, 120),
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
        followerCount: cleanText(input.values.followerCount, 120),
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
        cashOfferRealityRoundTwo: cleanText(input.values.cashOfferRealityRoundTwo, 200),
        dealStatusRoundTwo: cleanText(input.values.dealStatusRoundTwo, 200),
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

export async function getRecruitmentProfile(role: EmployeeRole, employeeId: string) {
  const collection = await getCollection();
  const document = await collection.findOne({ personKey: personKey(role, employeeId) });
  return document ? toProfile(document) : null;
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
        fullName: resolveTextUpdate(values.fullName, existing.fullName, 120) || existing.fullName,
        aliasName: resolveTextUpdate(values.aliasName, existing.aliasName, 120),
        phone: resolveTextUpdate(values.phone, existing.phone, 30) || existing.phone,
        email: resolveTextUpdate(values.email, existing.email, 180).toLowerCase(),
        sheetContractCode: resolveTextUpdate(values.sheetContractCode, existing.sheetContractCode || "", 120),
        cvUrl: resolveTextUpdate(values.cvUrl, existing.cvUrl, 1000),
        experience: resolveTextUpdate(values.experience, existing.experience, 3000),
        achievements: resolveTextUpdate(values.achievements, existing.achievements, 2000),
        expectedSalary: resolveTextUpdate(values.expectedSalary, existing.expectedSalary, 120),
        introVideoUrl: resolveTextUpdate(values.introVideoUrl, existing.introVideoUrl, 1000),
        tiktokUrl: resolveTextUpdate(values.tiktokUrl, existing.tiktokUrl, 1000),
        followerCount: resolveTextUpdate(values.followerCount, existing.followerCount || "", 120),
        zaloJoined: resolveBooleanUpdate(values.zaloJoined, existing.zaloJoined),
        level: resolveTextUpdate(values.level, existing.level, 120),
        rating: resolveTextUpdate(values.rating, existing.rating, 120),
        trainingJoined: resolveBooleanUpdate(values.trainingJoined, existing.trainingJoined),
        liveChannelId: resolveTextUpdate(values.liveChannelId, existing.liveChannelId, 200),
        canLiveHome: resolveBooleanUpdate(values.canLiveHome, existing.canLiveHome),
        canLiveStudio: resolveBooleanUpdate(values.canLiveStudio, existing.canLiveStudio),
        canUsePersonalAccount: resolveBooleanUpdate(values.canUsePersonalAccount, existing.canUsePersonalAccount),
        canUseCompanyAccount: resolveBooleanUpdate(values.canUseCompanyAccount, existing.canUseCompanyAccount),
        liveLocationPreference: values.liveLocationPreference === undefined
          ? existing.liveLocationPreference
          : values.liveLocationPreference === "studio"
            ? "studio"
            : values.liveLocationPreference === "home"
              ? "home"
              : "",
        liveAccountPreference: values.liveAccountPreference === undefined
          ? existing.liveAccountPreference
          : values.liveAccountPreference === "personal"
            ? "personal"
            : values.liveAccountPreference === "company"
              ? "company"
              : "",
        salaryOffered: resolveTextUpdate(values.salaryOffered, existing.salaryOffered || "", 200),
        salaryOfferFeedback: resolveTextUpdate(values.salaryOfferFeedback, existing.salaryOfferFeedback || "", 500),
        evaluationSummary: resolveTextUpdate(values.evaluationSummary, existing.evaluationSummary || "", 3000),
        supportGemOffer: resolveTextUpdate(values.supportGemOffer, existing.supportGemOffer || "", 200),
        cashOfferReality: resolveTextUpdate(values.cashOfferReality, existing.cashOfferReality || "", 200),
        dealStatus: resolveTextUpdate(values.dealStatus, existing.dealStatus || "", 200),
        cashOfferRealityRoundTwo: resolveTextUpdate(values.cashOfferRealityRoundTwo, existing.cashOfferRealityRoundTwo || "", 200),
        dealStatusRoundTwo: resolveTextUpdate(values.dealStatusRoundTwo, existing.dealStatusRoundTwo || "", 200),
        supportMainOfferNote: resolveTextUpdate(values.supportMainOfferNote, existing.supportMainOfferNote || "", 1000),
        notes: resolveTextUpdate(values.notes, existing.notes, 3000),
        updatedAt: now,
        updatedBy: input.actorAccountKey
      }
    },
    { returnDocument: "after" }
  );
  if (!next) throw new Error("Không lưu được hồ sơ tuyển dụng.");
  return toProfile(next);
}
