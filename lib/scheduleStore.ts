import { randomUUID } from "node:crypto";
import type { Collection, WithId } from "mongodb";
import { getMongoClient, getMongoDatabase } from "@/lib/mongodb";
import type {
  AccountType,
  ConfirmRole,
  EmployeeRole,
  SchedulePayload,
  ScheduleSession,
  ScheduleSummary
} from "@/lib/types";

const SESSIONS_COLLECTION = "schedule_sessions";
const SYNC_RUNS_COLLECTION = "schedule_sync_runs";
const CONFIRMATION_EVENTS_COLLECTION = "schedule_confirmation_events";
const DEFAULT_TIMEZONE = "Asia/Bangkok";

type ScheduleSessionDocument = ScheduleSession & {
  sessionKey: string;
  hostPersonKey: string;
  supportPersonKey: string;
  backupHostPersonKey: string;
  backupSupportPersonKey: string;
  active: boolean;
  sourceSpreadsheetId: string;
  sourceSheetName: string;
  sourceGeneratedAt: Date | null;
  sourceSnapshotRevision: number;
  syncBatchId: string;
  firstSyncedAt: Date;
  lastSeenAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
  hostConfirmationUpdatedAt?: Date;
  hostConfirmationActorKey?: string;
  hostConfirmationRevision?: number;
  supportConfirmationUpdatedAt?: Date;
  supportConfirmationActorKey?: string;
  supportConfirmationRevision?: number;
};

type ScheduleSyncRunDocument = {
  batchId: string;
  syncType: "schedule";
  status: "success";
  requestedBy: string;
  sourceSpreadsheetId: string;
  sourceSheetName: string;
  sourceGeneratedAt: Date | null;
  timezone: string;
  startedAt: Date;
  completedAt: Date;
  total: number;
  inserted: number;
  updated: number;
  deactivated: number;
};

type ScheduleConfirmationEventDocument = {
  eventId: string;
  sessionId: string;
  role: ConfirmRole;
  confirmed: boolean;
  actorAccountKey: string;
  actorType: AccountType;
  actorRole?: EmployeeRole;
  actorEmployeeId?: string;
  sourceRevision?: number;
  appliedToCache: boolean;
  appliedRoles: EmployeeRole[];
  createdAt: Date;
};

type ScheduleRange = {
  from?: string;
  to?: string;
};

type SyncScheduleOptions = {
  requestedBy: string;
  startedAt?: Date;
};

type ApplyConfirmationInput = {
  sessionId: string;
  role: ConfirmRole;
  confirmed: boolean;
  actorAccountKey: string;
  actorType: AccountType;
  actorRole?: EmployeeRole;
  actorEmployeeId?: string;
  sourceRevision?: number;
};

type SyncScheduleResult = {
  batchId: string;
  inserted: number;
  updated: number;
  deactivated: number;
  total: number;
  syncedAt: string;
};

let indexesPromise: Promise<void> | undefined;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function cleanBoolean(value: unknown): boolean {
  return value === true;
}

function cleanNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildPersonKey(role: EmployeeRole, employeeId: string): string {
  const normalizedId = cleanText(employeeId).toLowerCase();
  return normalizedId ? `${role}:${normalizedId}` : "";
}

function normalizeScheduleSession(input: ScheduleSession): ScheduleSession {
  const warningLevel = ["ok", "info", "danger"].includes(input.warningLevel)
    ? input.warningLevel
    : "info";

  return {
    rowNumber: cleanNumber(input.rowNumber),
    stt: cleanText(input.stt),
    sessionId: cleanText(input.sessionId),
    dateKey: cleanText(input.dateKey),
    dateLabel: cleanText(input.dateLabel),
    weekday: cleanText(input.weekday),
    slot: cleanText(input.slot),
    slotSortKey: cleanText(input.slotSortKey),
    hostId: cleanText(input.hostId),
    hostName: cleanText(input.hostName),
    format: cleanText(input.format),
    supportId: cleanText(input.supportId),
    supportName: cleanText(input.supportName),
    channel: cleanText(input.channel),
    scriptUrl: cleanText(input.scriptUrl),
    hostConfirm: cleanText(input.hostConfirm),
    supportConfirm: cleanText(input.supportConfirm),
    backupHostId: cleanText(input.backupHostId),
    backupHostName: cleanText(input.backupHostName),
    backupSupportId: cleanText(input.backupSupportId),
    backupSupportName: cleanText(input.backupSupportName),
    supportCandidatePool: cleanText(input.supportCandidatePool),
    isHostConfirmed: cleanBoolean(input.isHostConfirmed),
    isSupportConfirmed: cleanBoolean(input.isSupportConfirmed),
    canConfirmHost: cleanBoolean(input.canConfirmHost),
    canConfirmSupport: cleanBoolean(input.canConfirmSupport),
    supportRequired: cleanBoolean(input.supportRequired),
    isSupportOnly: cleanBoolean(input.isSupportOnly),
    missingSupport: cleanBoolean(input.missingSupport),
    warningLevel: warningLevel as ScheduleSession["warningLevel"],
    warnings: Array.isArray(input.warnings) ? input.warnings.map(cleanText).filter(Boolean) : []
  };
}

function toScheduleSession(document: WithId<ScheduleSessionDocument>): ScheduleSession {
  return normalizeScheduleSession(document);
}

function buildSummary(rows: ScheduleSession[]): ScheduleSummary {
  return rows.reduce<ScheduleSummary>(
    (summary, row) => {
      summary.total += 1;
      if (row.isSupportOnly) summary.supportOnly += 1;
      if (row.missingSupport) summary.missingSupport += 1;
      if (row.canConfirmHost && !row.isHostConfirmed) summary.pendingHostConfirm += 1;
      if (row.canConfirmSupport && !row.isSupportConfirmed) summary.pendingSupportConfirm += 1;
      if (row.isHostConfirmed) summary.confirmedHost += 1;
      if (row.isSupportConfirmed) summary.confirmedSupport += 1;
      return summary;
    },
    {
      total: 0,
      supportOnly: 0,
      missingSupport: 0,
      pendingHostConfirm: 0,
      pendingSupportConfirm: 0,
      confirmedHost: 0,
      confirmedSupport: 0
    }
  );
}

async function ensureScheduleIndexes(): Promise<void> {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const database = await getMongoDatabase();
      const sessions = database.collection<ScheduleSessionDocument>(SESSIONS_COLLECTION);
      const syncRuns = database.collection<ScheduleSyncRunDocument>(SYNC_RUNS_COLLECTION);
      const events = database.collection<ScheduleConfirmationEventDocument>(CONFIRMATION_EVENTS_COLLECTION);

      await Promise.all([
        sessions.createIndex({ sessionKey: 1 }, { unique: true }),
        sessions.createIndex({ active: 1, dateKey: 1, slotSortKey: 1 }),
        sessions.createIndex({ active: 1, hostPersonKey: 1, dateKey: 1 }),
        sessions.createIndex({ active: 1, supportPersonKey: 1, dateKey: 1 }),
        syncRuns.createIndex({ batchId: 1 }, { unique: true }),
        syncRuns.createIndex({ syncType: 1, status: 1, completedAt: -1 }),
        events.createIndex({ eventId: 1 }, { unique: true }),
        events.createIndex({ sessionId: 1, createdAt: -1 }),
        events.createIndex({ actorAccountKey: 1, createdAt: -1 })
      ]);
    })().catch((error) => {
      indexesPromise = undefined;
      throw error;
    });
  }

  return indexesPromise;
}

async function getCollections(): Promise<{
  sessions: Collection<ScheduleSessionDocument>;
  syncRuns: Collection<ScheduleSyncRunDocument>;
  events: Collection<ScheduleConfirmationEventDocument>;
}> {
  await ensureScheduleIndexes();
  const database = await getMongoDatabase();
  return {
    sessions: database.collection<ScheduleSessionDocument>(SESSIONS_COLLECTION),
    syncRuns: database.collection<ScheduleSyncRunDocument>(SYNC_RUNS_COLLECTION),
    events: database.collection<ScheduleConfirmationEventDocument>(CONFIRMATION_EVENTS_COLLECTION)
  };
}

export async function syncSchedulePayloadToMongo(
  payload: SchedulePayload,
  options: SyncScheduleOptions
): Promise<SyncScheduleResult> {
  if (payload.sync?.success === false) {
    throw new Error(payload.sync.message || "Google Sheets schedule refresh failed.");
  }

  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    throw new Error("Google Sheets returned no schedule rows; MongoDB was not changed.");
  }

  const rows = payload.rows.map(normalizeScheduleSession);
  const seenSessionIds = new Set<string>();
  for (const row of rows) {
    if (!row.sessionId) {
      throw new Error(`Schedule row ${row.rowNumber || "unknown"} is missing Session_ID.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dateKey)) {
      throw new Error(`Session ${row.sessionId} has an invalid date.`);
    }
    if (seenSessionIds.has(row.sessionId)) {
      throw new Error(`Duplicate Session_ID returned by Google Sheets: ${row.sessionId}.`);
    }
    seenSessionIds.add(row.sessionId);
  }

  const { sessions, syncRuns } = await getCollections();
  const client = await getMongoClient();
  const batchId = randomUUID();
  const completedAt = new Date();
  const startedAt = options.startedAt || completedAt;
  const sourceGeneratedAt = parseDate(payload.generatedAt);
  const sourceSpreadsheetId = cleanText(payload.spreadsheetId);
  const sourceSheetName = cleanText(payload.sheetName) || "Live_Session_Master";
  const timezone = cleanText(payload.timezone) || DEFAULT_TIMEZONE;
  const sourceSnapshotRevision = cleanNumber(payload.confirmationRevision);
  let inserted = 0;
  let updated = 0;
  let deactivated = 0;

  await client.withSession(async (mongoSession) => {
    await mongoSession.withTransaction(async () => {
      const existingDocuments = await sessions
        .find(
          { sessionKey: { $in: rows.map((row) => row.sessionId) } },
          {
            session: mongoSession,
            projection: {
              sessionKey: 1,
              hostConfirm: 1,
              isHostConfirmed: 1,
              hostConfirmationRevision: 1,
              supportConfirm: 1,
              isSupportConfirmed: 1,
              supportConfirmationRevision: 1
            }
          }
        )
        .toArray();
      const existingBySessionId = new Map(
        existingDocuments.map((document) => [document.sessionKey, document])
      );

      const writeResult = await sessions.bulkWrite(
        rows.map((sourceRow) => {
          const row = { ...sourceRow };
          const existing = existingBySessionId.get(row.sessionId);
          const existingHostRevision = cleanNumber(existing?.hostConfirmationRevision);
          const existingSupportRevision = cleanNumber(existing?.supportConfirmationRevision);

          if (existing && existingHostRevision > sourceSnapshotRevision) {
            row.hostConfirm = existing.hostConfirm;
            row.isHostConfirmed = existing.isHostConfirmed;
          }
          if (existing && existingSupportRevision > sourceSnapshotRevision) {
            row.supportConfirm = existing.supportConfirm;
            row.isSupportConfirmed = existing.isSupportConfirmed;
          }

          return {
            updateOne: {
              filter: { sessionKey: row.sessionId },
              update: {
                $set: {
                  ...row,
                  sessionKey: row.sessionId,
                  hostPersonKey: buildPersonKey("host", row.hostId),
                  supportPersonKey: buildPersonKey("support", row.supportId),
                  backupHostPersonKey: buildPersonKey("host", row.backupHostId),
                  backupSupportPersonKey: buildPersonKey("support", row.backupSupportId),
                  active: true,
                  sourceSpreadsheetId,
                  sourceSheetName,
                  sourceGeneratedAt,
                  sourceSnapshotRevision,
                  hostConfirmationRevision: Math.max(sourceSnapshotRevision, existingHostRevision),
                  supportConfirmationRevision: Math.max(sourceSnapshotRevision, existingSupportRevision),
                  syncBatchId: batchId,
                  lastSeenAt: completedAt,
                  updatedAt: completedAt,
                  deactivatedAt: null
                },
                $setOnInsert: { firstSyncedAt: completedAt }
              },
              upsert: true
            }
          };
        }),
        { session: mongoSession }
      );

      const deactivateResult = await sessions.updateMany(
        { active: true, syncBatchId: { $ne: batchId } },
        {
          $set: {
            active: false,
            deactivatedAt: completedAt,
            updatedAt: completedAt
          }
        },
        { session: mongoSession }
      );

      inserted = writeResult.upsertedCount;
      updated = writeResult.matchedCount;
      deactivated = deactivateResult.modifiedCount;

      await syncRuns.insertOne(
        {
          batchId,
          syncType: "schedule",
          status: "success",
          requestedBy: cleanText(options.requestedBy) || "admin:admin",
          sourceSpreadsheetId,
          sourceSheetName,
          sourceGeneratedAt,
          timezone,
          startedAt,
          completedAt,
          total: rows.length,
          inserted,
          updated,
          deactivated
        },
        { session: mongoSession }
      );
    });
  });

  return {
    batchId,
    inserted,
    updated,
    deactivated,
    total: rows.length,
    syncedAt: completedAt.toISOString()
  };
}

export async function getScheduleFromMongo(range: ScheduleRange = {}): Promise<SchedulePayload> {
  const { sessions, syncRuns } = await getCollections();
  const dateFilter: Record<string, string> = {};
  if (range.from) dateFilter.$gte = range.from;
  if (range.to) dateFilter.$lte = range.to;

  const query = {
    active: true,
    ...(Object.keys(dateFilter).length > 0 ? { dateKey: dateFilter } : {})
  };
  const [documents, latestSync] = await Promise.all([
    sessions.find(query).sort({ dateKey: 1, slotSortKey: 1, sessionKey: 1 }).toArray(),
    syncRuns.findOne({ syncType: "schedule", status: "success" }, { sort: { completedAt: -1 } })
  ]);
  const rows = documents.map(toScheduleSession);

  return {
    success: true,
    storage: "mongodb",
    spreadsheetId: latestSync?.sourceSpreadsheetId,
    sheetName: latestSync?.sourceSheetName || "Live_Session_Master",
    generatedAt: latestSync?.sourceGeneratedAt?.toISOString() || latestSync?.completedAt.toISOString(),
    syncedAt: latestSync?.completedAt.toISOString(),
    timezone: latestSync?.timezone || DEFAULT_TIMEZONE,
    rowCount: rows.length,
    summary: buildSummary(rows),
    rows,
    ...(!latestSync
      ? { message: "Lịch chưa được Admin đồng bộ từ Google Sheets vào MongoDB." }
      : {})
  };
}

export async function findScheduleSessionById(sessionId: string): Promise<ScheduleSession | null> {
  const { sessions } = await getCollections();
  const document = await sessions.findOne({ sessionKey: cleanText(sessionId), active: true });
  return document ? toScheduleSession(document) : null;
}

export async function applyScheduleConfirmationToMongo(
  input: ApplyConfirmationInput
): Promise<void> {
  const { sessions, events } = await getCollections();
  const client = await getMongoClient();
  const sessionId = cleanText(input.sessionId);
  const confirmedText = input.confirmed ? "Đã xác nhận" : "Chưa xác nhận";
  const now = new Date();
  const sourceRevision = cleanNumber(input.sourceRevision);

  await client.withSession(async (mongoSession) => {
    await mongoSession.withTransaction(async () => {
      const sessionStillExists = await sessions.findOne(
        { sessionKey: sessionId, active: true },
        { session: mongoSession, projection: { _id: 1 } }
      );
      if (!sessionStillExists) {
        throw new Error("Session is not available in the MongoDB schedule cache.");
      }

      const requestedRoles: EmployeeRole[] = input.role === "both" ? ["host", "support"] : [input.role];
      const appliedRoles: EmployeeRole[] = [];
      for (const role of requestedRoles) {
        const prefix = role === "host" ? "host" : "support";
        const revisionField = `${prefix}ConfirmationRevision`;
        const confirmationFields: Record<string, unknown> = {
          updatedAt: now,
          [`${prefix}Confirm`]: confirmedText,
          [`is${prefix === "host" ? "Host" : "Support"}Confirmed`]: input.confirmed,
          [`${prefix}ConfirmationUpdatedAt`]: now,
          [`${prefix}ConfirmationActorKey`]: input.actorAccountKey
        };
        if (sourceRevision > 0) {
          confirmationFields[revisionField] = sourceRevision;
        }

        const updateResult = await sessions.updateOne(
          {
            sessionKey: sessionId,
            active: true,
            ...(sourceRevision > 0
              ? {
                  $or: [
                    { [revisionField]: { $exists: false } },
                    { [revisionField]: { $lt: sourceRevision } }
                  ]
                }
              : {})
          },
          { $set: confirmationFields },
          { session: mongoSession }
        );
        if (updateResult.matchedCount === 1) appliedRoles.push(role);
      }

      await events.insertOne(
        {
          eventId: randomUUID(),
          sessionId,
          role: input.role,
          confirmed: input.confirmed,
          actorAccountKey: cleanText(input.actorAccountKey),
          actorType: input.actorType,
          actorRole: input.actorRole,
          actorEmployeeId: input.actorEmployeeId ? cleanText(input.actorEmployeeId) : undefined,
          sourceRevision: sourceRevision || undefined,
          appliedToCache: appliedRoles.length > 0,
          appliedRoles,
          createdAt: now
        },
        { session: mongoSession }
      );
    });
  });
}
