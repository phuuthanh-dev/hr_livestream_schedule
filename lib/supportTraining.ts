import type { Collection } from "mongodb";
import type { DashboardSession } from "@/lib/auth";
import { employeeContractPersonKey } from "@/lib/employeeContract";
import { findSchedulePerson, updateSchedulePerson } from "@/lib/employeeRoster";
import { getMongoDatabase } from "@/lib/mongodb";
import {
  emptySupportTrainingEntries,
  emptySupportTrainingFeedback,
  emptySupportTrainingMeta,
  evaluateSupportTraining,
  normalizeSupportTrainingEntries,
  normalizeSupportTrainingFeedback,
  normalizeSupportTrainingMeta,
  SUPPORT_TRAINING_CHECKLIST,
  type SupportTrainingChecklistEntries,
  type SupportTrainingEvaluation,
  type SupportTrainingFeedback,
  type SupportTrainingMeta
} from "@/lib/supportTrainingConfig";

type SupportTrainingDocument = {
  personKey: string;
  role: "support";
  employeeId: string;
  employeeName: string;
  entries: SupportTrainingChecklistEntries;
  meta: SupportTrainingMeta;
  feedback: SupportTrainingFeedback;
  totalItems: number;
  applicableItems: number;
  excludedItems: number;
  maxScore: number;
  achievedScore: number;
  scorePercent: number;
  rating: "A" | "B" | "C" | "D";
  classification: "Xuất sắc" | "Tốt" | "Đạt" | "Cần đào tạo lại";
  level: "Cấp 1" | "Cấp 2" | "Cấp 3" | "Cấp 4";
  cashOffer: string;
  passed: boolean;
  completedAt?: Date;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
};

export type SupportTrainingProfile = {
  employeeId: string;
  employeeName: string;
  entries: SupportTrainingChecklistEntries;
  meta: SupportTrainingMeta;
  feedback: SupportTrainingFeedback;
  evaluation: SupportTrainingEvaluation;
  completedAt?: string;
  updatedAt: string;
};

export type SupportTrainingSummary = {
  rating: "A" | "B" | "C" | "D";
  scorePercent: number;
  cashOffer: string;
  passed: boolean;
  updatedAt?: string;
};

let supportTrainingIndexesPromise: Promise<unknown> | null = null;

async function getSupportTrainingCollection(): Promise<Collection<SupportTrainingDocument>> {
  const database = await getMongoDatabase();
  const collection = database.collection<SupportTrainingDocument>("support_training_profiles");
  if (!supportTrainingIndexesPromise) {
    supportTrainingIndexesPromise = Promise.all([
      collection.createIndex({ personKey: 1 }, { unique: true }),
      collection.createIndex({ rating: 1, updatedAt: -1 })
    ]).catch((error) => {
      supportTrainingIndexesPromise = null;
      throw error;
    });
  }
  await supportTrainingIndexesPromise;
  return collection;
}

function toProfile(document: SupportTrainingDocument): SupportTrainingProfile {
  return {
    employeeId: document.employeeId,
    employeeName: document.employeeName,
    entries: normalizeSupportTrainingEntries(document.entries, document.meta || emptySupportTrainingMeta()),
    meta: normalizeSupportTrainingMeta(document.meta),
    feedback: normalizeSupportTrainingFeedback(document.feedback),
    evaluation: {
      totalItems: document.totalItems,
      applicableItems: document.applicableItems,
      excludedItems: document.excludedItems,
      maxScore: document.maxScore,
      achievedScore: document.achievedScore,
      scorePercent: document.scorePercent,
      classification: document.classification,
      rating: document.rating,
      level: document.level,
      cashOffer: document.cashOffer,
      passed: document.passed,
      trainingStatus: document.passed ? "Đã Training" : "Chưa Training"
    },
    completedAt: document.completedAt?.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

export async function getSupportTrainingProfile(employeeId: string) {
  const collection = await getSupportTrainingCollection();
  const document = await collection.findOne({ personKey: employeeContractPersonKey("support", employeeId) });
  return document ? toProfile(document) : null;
}

export async function saveSupportTrainingProfile(input: {
  employeeId: string;
  entries?: unknown;
  answers?: unknown;
  meta?: unknown;
  feedback?: unknown;
  notes?: unknown;
  actorAccountKey: string;
}) {
  const person = await findSchedulePerson("support", input.employeeId);
  if (!person) throw new Error("Không tìm thấy support live.");

  const meta = normalizeSupportTrainingMeta(input.meta);
  const feedback = normalizeSupportTrainingFeedback(
    input.feedback ?? (typeof input.notes === "string" ? { generalNotes: input.notes } : input.notes)
  );
  const entries = normalizeSupportTrainingEntries(input.entries ?? input.answers, meta);
  const evaluation = evaluateSupportTraining(entries);
  const now = new Date();
  const personKey = employeeContractPersonKey("support", person.id);
  const collection = await getSupportTrainingCollection();
  const setFields: Omit<SupportTrainingDocument, "createdAt" | "createdBy" | "completedAt"> & { completedAt?: Date } = {
    personKey,
    role: "support",
    employeeId: person.id,
    employeeName: person.name,
    entries,
    meta,
    feedback,
    totalItems: evaluation.totalItems,
    applicableItems: evaluation.applicableItems,
    excludedItems: evaluation.excludedItems,
    maxScore: evaluation.maxScore,
    achievedScore: evaluation.achievedScore,
    scorePercent: evaluation.scorePercent,
    rating: evaluation.rating,
    classification: evaluation.classification,
    level: evaluation.level,
    cashOffer: evaluation.cashOffer,
    passed: evaluation.passed,
    updatedAt: now,
    updatedBy: input.actorAccountKey
  };
  if (evaluation.passed) {
    setFields.completedAt = now;
  }
  const document = await collection.findOneAndUpdate(
    { personKey },
    {
      $set: setFields,
      ...(evaluation.passed ? {} : { $unset: { completedAt: "" } }),
      $setOnInsert: {
        createdAt: now,
        createdBy: input.actorAccountKey
      }
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!document) throw new Error("Không lưu được checklist training.");

  const trainingNotes = [
    feedback.generalNotes ? `Training note: ${feedback.generalNotes}` : "",
    feedback.improvementAreas ? `Improve: ${feedback.improvementAreas}` : "",
    `Training rating: ${evaluation.rating} (${evaluation.scorePercent}%)`
  ].filter(Boolean).join(" | ");

  await updateSchedulePerson({
    id: person.id,
    role: "support",
    rating: evaluation.rating,
    level: evaluation.level,
    cashOffer: evaluation.cashOffer,
    trainingStatus: evaluation.trainingStatus,
    notes: [person.notes, trainingNotes].filter(Boolean).join(" | ")
  }, input.actorAccountKey);

  return toProfile(document);
}

export async function listSupportTrainingSummaries() {
  const collection = await getSupportTrainingCollection();
  const documents = await collection.find({}, {
    projection: { personKey: 1, rating: 1, scorePercent: 1, cashOffer: 1, passed: 1, updatedAt: 1 }
  }).toArray();
  return new Map(documents.map((document) => [document.personKey, {
    rating: document.rating,
    scorePercent: document.scorePercent,
    cashOffer: document.cashOffer,
    passed: document.passed,
    updatedAt: document.updatedAt?.toISOString()
  } satisfies SupportTrainingSummary]));
}

export function createEmptySupportTrainingProfile(employeeId: string, employeeName: string): SupportTrainingProfile {
  const meta = emptySupportTrainingMeta();
  const entries = emptySupportTrainingEntries(meta);
  return {
    employeeId,
    employeeName,
    entries,
    meta,
    feedback: emptySupportTrainingFeedback(),
    evaluation: evaluateSupportTraining(entries),
    updatedAt: ""
  };
}

export function canAccessSupportTraining(session: DashboardSession, employeeId: string) {
  if (session.accountType === "admin") return true;
  return session.accountType === "employee" && session.role === "support" && session.employeeId === employeeId;
}

export { SUPPORT_TRAINING_CHECKLIST };
