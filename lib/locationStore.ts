import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import { normalizeLocationCode, normalizeLocationName } from "@/lib/locationUtils";
import type { ScheduleLocation } from "@/lib/types";

type ScheduleLocationDocument = {
  _id: string;
  name: string;
  normalizedName: string;
  active: boolean;
  sortOrder: number;
  system: boolean;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
};

type CreateScheduleLocationInput = {
  code?: string;
  name: string;
  sortOrder?: number;
  actorAccountKey: string;
};

type UpdateScheduleLocationInput = {
  code: string;
  name?: string;
  active?: boolean;
  sortOrder?: number;
  actorAccountKey: string;
};

const DEFAULT_LOCATIONS = [
  { code: "studio", name: "Studio", sortOrder: 10 },
  { code: "both", name: "Both", sortOrder: 20 },
  { code: "home", name: "Home", sortOrder: 30 }
] as const;

let locationIndexesPromise: Promise<unknown> | null = null;
let defaultLocationsPromise: Promise<void> | null = null;

function normalizeSortOrder(value: unknown, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(9999, Math.max(0, Math.round(parsed)));
}

function toScheduleLocation(document: ScheduleLocationDocument): ScheduleLocation {
  return {
    id: document._id,
    code: document._id,
    name: document.name,
    active: document.active,
    sortOrder: document.sortOrder,
    system: document.system,
    createdAt: document.createdAt?.toISOString(),
    updatedAt: document.updatedAt?.toISOString()
  };
}

async function getLocationCollection(): Promise<Collection<ScheduleLocationDocument>> {
  const database = await getMongoDatabase();
  const collection = database.collection<ScheduleLocationDocument>("schedule_locations");
  if (!locationIndexesPromise) {
    locationIndexesPromise = Promise.all([
      collection.createIndex({ normalizedName: 1 }, { unique: true }),
      collection.createIndex({ active: 1, sortOrder: 1, name: 1 })
    ]).catch((error) => {
      locationIndexesPromise = null;
      throw error;
    });
  }
  await locationIndexesPromise;
  return collection;
}

async function ensureDefaultLocations() {
  if (!defaultLocationsPromise) {
    defaultLocationsPromise = (async () => {
      const collection = await getLocationCollection();
      const now = new Date();
      await collection.bulkWrite(
        DEFAULT_LOCATIONS.map((location) => ({
          updateOne: {
            filter: { _id: location.code },
            update: {
              $setOnInsert: {
                _id: location.code,
                name: location.name,
                normalizedName: location.name.toLowerCase(),
                active: true,
                sortOrder: location.sortOrder,
                system: true,
                createdAt: now,
                createdBy: "system",
                updatedAt: now,
                updatedBy: "system"
              }
            },
            upsert: true
          }
        })),
        { ordered: false }
      );
    })().catch((error) => {
      defaultLocationsPromise = null;
      throw error;
    });
  }
  await defaultLocationsPromise;
}

export async function listScheduleLocations(includeInactive = false) {
  await ensureDefaultLocations();
  const collection = await getLocationCollection();
  const documents = await collection
    .find(includeInactive ? {} : { active: true })
    .sort({ sortOrder: 1, name: 1 })
    .toArray();
  return documents.map(toScheduleLocation);
}

export async function findActiveScheduleLocation(code: string) {
  await ensureDefaultLocations();
  const collection = await getLocationCollection();
  const locationCode = normalizeLocationCode(code);
  if (!locationCode) return null;
  const document = await collection.findOne({ _id: locationCode, active: true });
  return document ? toScheduleLocation(document) : null;
}

export async function createScheduleLocation(input: CreateScheduleLocationInput) {
  await ensureDefaultLocations();
  const collection = await getLocationCollection();
  const name = normalizeLocationName(input.name);
  const code = normalizeLocationCode(input.code || name);
  if (!name) throw new Error("Tên địa điểm không được để trống.");
  if (!code) throw new Error("Mã địa điểm không hợp lệ.");
  const now = new Date();

  try {
    const document: ScheduleLocationDocument = {
      _id: code,
      name,
      normalizedName: name.toLocaleLowerCase("vi"),
      active: true,
      sortOrder: normalizeSortOrder(input.sortOrder),
      system: false,
      createdAt: now,
      createdBy: input.actorAccountKey,
      updatedAt: now,
      updatedBy: input.actorAccountKey
    };
    await collection.insertOne(document);
    return toScheduleLocation(document);
  } catch (error) {
    if (error instanceof Error && /duplicate key/i.test(error.message)) {
      throw new Error("Mã hoặc tên địa điểm đã tồn tại.");
    }
    throw error;
  }
}

export async function updateScheduleLocation(input: UpdateScheduleLocationInput) {
  await ensureDefaultLocations();
  const collection = await getLocationCollection();
  const code = normalizeLocationCode(input.code);
  if (!code) throw new Error("Mã địa điểm không hợp lệ.");
  const existing = await collection.findOne({ _id: code });
  if (!existing) throw new Error("Không tìm thấy địa điểm.");
  const name = input.name === undefined ? existing.name : normalizeLocationName(input.name);
  if (!name) throw new Error("Tên địa điểm không được để trống.");

  try {
    const result = await collection.findOneAndUpdate(
      { _id: code },
      {
        $set: {
          name,
          normalizedName: name.toLocaleLowerCase("vi"),
          active: input.active === undefined ? existing.active : input.active,
          sortOrder: input.sortOrder === undefined ? existing.sortOrder : normalizeSortOrder(input.sortOrder),
          updatedAt: new Date(),
          updatedBy: input.actorAccountKey
        }
      },
      { returnDocument: "after" }
    );
    if (!result) throw new Error("Không tìm thấy địa điểm.");
    return toScheduleLocation(result);
  } catch (error) {
    if (error instanceof Error && /duplicate key/i.test(error.message)) {
      throw new Error("Tên địa điểm đã tồn tại.");
    }
    throw error;
  }
}
