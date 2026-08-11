import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getMongoClient, getMongoDatabase } from "@/lib/mongodb";
import { normalizeLocationCode } from "@/lib/locationUtils";
import type { EmployeeRole, HostWorkLocation, PeoplePayload, PeopleSyncPayload, SchedulePerson } from "@/lib/types";

type SchedulePersonDocument = {
  personKey: string;
  employeeId: string;
  normalizedEmployeeId: string;
  name: string;
  role: EmployeeRole;
  level: string;
  workLocation?: HostWorkLocation | "";
  active: boolean;
  source: string;
  syncBatchId: string;
  firstSyncedAt: Date;
  lastSeenAt: Date;
  updatedAt: Date;
  deactivatedAt?: Date | null;
};

let rosterIndexesPromise: Promise<unknown> | null = null;

function normalizeEmployeeId(employeeId: string) {
  return employeeId.trim().toLowerCase();
}

function buildPersonKey(role: EmployeeRole, employeeId: string) {
  return `${role}:${normalizeEmployeeId(employeeId)}`;
}

function normalizeHostWorkLocation(value: unknown): HostWorkLocation | undefined {
  return normalizeLocationCode(value) || undefined;
}

function toSchedulePerson(document: SchedulePersonDocument): SchedulePerson {
  return {
    id: document.employeeId,
    name: document.name || document.employeeId,
    role: document.role,
    level: document.level || undefined,
    workLocation: document.role === "host" ? normalizeHostWorkLocation(document.workLocation) : undefined
  };
}

async function getRosterCollection(): Promise<Collection<SchedulePersonDocument>> {
  const database = await getMongoDatabase();
  const collection = database.collection<SchedulePersonDocument>("schedule_people");
  if (!rosterIndexesPromise) {
    rosterIndexesPromise = Promise.all([
      collection.createIndex({ personKey: 1 }, { unique: true }),
      collection.createIndex({ active: 1, role: 1, name: 1 })
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
  const byName = (left: SchedulePerson, right: SchedulePerson) =>
    [left.name, left.id].join("__").localeCompare([right.name, right.id].join("__"), "vi");
  const hosts = people.filter((person) => person.role === "host").sort(byName);
  const supports = people.filter((person) => person.role === "support").sort(byName);
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
    message: people.length === 0 ? "Danh sách nhân viên chưa được Admin đồng bộ từ Google Sheet." : undefined
  };
}

export async function findActiveSchedulePerson(role: EmployeeRole, employeeId: string): Promise<SchedulePerson | null> {
  const collection = await getRosterCollection();
  const document = await collection.findOne({
    personKey: buildPersonKey(role, employeeId),
    active: true
  });
  return document ? toSchedulePerson(document) : null;
}

export async function syncSchedulePeopleToMongo(payload: PeoplePayload): Promise<PeopleSyncPayload> {
  if (!Array.isArray(payload.hosts) || !Array.isArray(payload.supports) || payload.fallback) {
    throw new Error("Apps Script chưa trả roster từ Portfolio_Master / Support_Master. Hãy deploy WebApi.gs phiên bản mới.");
  }
  if (payload.hosts.length === 0 || payload.supports.length === 0) {
    throw new Error("Portfolio_Master hoặc Support_Master đang rỗng; MongoDB được giữ nguyên để tránh vô hiệu hóa nhầm nhân viên.");
  }

  const peopleByKey = new Map<string, SchedulePerson>();
  [...payload.hosts, ...payload.supports].forEach((person) => {
    const id = person.id?.trim();
    if (!id || (person.role !== "host" && person.role !== "support")) return;
    peopleByKey.set(buildPersonKey(person.role, id), {
      id,
      name: person.name?.trim() || id,
      role: person.role,
      level: person.level?.trim() || undefined
    });
  });

  const normalizedPeople = Array.from(peopleByKey.values());
  if (
    normalizedPeople.filter((person) => person.role === "host").length === 0 ||
    normalizedPeople.filter((person) => person.role === "support").length === 0
  ) {
    throw new Error("Roster Google Sheet thiếu host hoặc support hợp lệ; MongoDB được giữ nguyên để tránh vô hiệu hóa nhầm nhân viên.");
  }

  const collection = await getRosterCollection();
  const client = await getMongoClient();
  const mongoSession = client.startSession();
  const now = new Date();
  const syncBatchId = randomUUID();
  const source = payload.source || "Portfolio_Master / Support_Master";
  let inserted = 0;
  let updated = 0;
  let deactivated = 0;

  try {
    await mongoSession.withTransaction(async () => {
      const operations = Array.from(peopleByKey.entries()).map(([personKey, person]) => ({
        updateOne: {
          filter: { personKey },
          update: {
            $set: {
              employeeId: person.id,
              normalizedEmployeeId: normalizeEmployeeId(person.id),
              name: person.name,
              role: person.role,
              level: person.level || "",
              active: true,
              source,
              syncBatchId,
              lastSeenAt: now,
              updatedAt: now,
              deactivatedAt: null
            },
            $setOnInsert: {
              personKey,
              firstSyncedAt: now
            }
          },
          upsert: true
        }
      }));

      const bulkResult = await collection.bulkWrite(operations, { ordered: false, session: mongoSession });
      inserted = bulkResult.upsertedCount;
      updated = bulkResult.matchedCount;

      const deactivatedResult = await collection.updateMany(
        { active: true, syncBatchId: { $ne: syncBatchId } },
        { $set: { active: false, deactivatedAt: now, updatedAt: now } },
        { session: mongoSession }
      );
      deactivated = deactivatedResult.modifiedCount;
    });
  } finally {
    await mongoSession.endSession();
  }

  const roster = await getSchedulePeopleFromMongo();
  return {
    ...roster,
    syncedAt: now.toISOString(),
    generatedAt: now.toISOString(),
    inserted,
    updated,
    deactivated,
    total: roster.total || 0,
    message: `Đã đồng bộ ${roster.total || 0} nhân viên vào MongoDB.`
  };
}
