import { randomUUID } from "node:crypto";
import type { Collection, WithId } from "mongodb";
import { findActiveSchedulePerson } from "@/lib/employeeRoster";
import { findActiveScheduleLocation } from "@/lib/locationStore";
import { getMongoClient, getMongoDatabase } from "@/lib/mongodb";
import { buildManualScheduleAssignment, getSessionLocationMode } from "@/lib/scheduleAssignment";
import { buildScheduleLaneKey, getScheduleSessionLane } from "@/lib/scheduleLane";
import { buildScheduleSessionCode, getScheduleSessionCode } from "@/lib/scheduleSessionCode";
import type {
  AccountType,
  AvailabilityLocationPreference,
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
  sourceGeneratedAt?: Date | null;
  sourceSnapshotRevision?: number;
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
  manualOverrideUpdatedAt?: Date;
  manualOverrideUpdatedBy?: string;
};

type ScheduleSyncRunDocument = {
  batchId: string;
  syncType: "schedule";
  mode: "schedule_refresh" | "sheet_snapshot" | "website_generation" | "website_generation_refresh_unconfirmed";
  status: "success";
  requestedBy: string;
  sourceGeneratedAt?: Date | null;
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

type ApplyConfirmationInput = {
  sessionId: string;
  role: ConfirmRole;
  confirmed: boolean;
  actorAccountKey: string;
  actorType: AccountType;
  actorRole?: EmployeeRole;
  actorEmployeeId?: string;
  expectedDateKey?: string;
  sourceRevision?: number;
};

type PublishGeneratedWeekInput = {
  weekStartKey: string;
  weekEndKey: string;
  todayKey: string;
  rows: ScheduleSession[];
  requestedBy: string;
  preserveManualOverrides?: boolean;
  startedAt?: Date;
};

type ScheduleWriteResult = {
  batchId: string;
  mode: "website_generation" | "website_generation_refresh_unconfirmed";
  inserted: number;
  updated: number;
  deactivated: number;
  total: number;
  syncedAt: string;
};

export type UpdateScheduleAssignmentInput = {
  sessionId: string;
  hostId?: string;
  supportId?: string;
  locationMode?: AvailabilityLocationPreference;
  actorAccountKey: string;
};

export type DeleteScheduleSessionInput = {
  sessionId: string;
  actorAccountKey: string;
};

let indexesPromise: Promise<void> | undefined;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function cleanNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPersonKey(role: EmployeeRole, employeeId: string): string {
  const normalizedId = cleanText(employeeId).toLowerCase();
  return normalizedId ? `${role}:${normalizedId}` : "";
}

function normalizeScheduleSession(input: ScheduleSession): ScheduleSession {
  const warningLevel = ["ok", "info", "danger"].includes(input.warningLevel)
    ? input.warningLevel
    : "info";
  const status = input.status === "published" || input.status === "open"
    || input.status === "canceled" || input.status === "completed"
    ? input.status
    : undefined;

  return {
    rowNumber: cleanNumber(input.rowNumber),
    stt: cleanText(input.stt),
    sessionId: cleanText(input.sessionId),
    sessionCode: cleanText(input.sessionCode) || buildScheduleSessionCode({
      dateKey: cleanText(input.dateKey),
      slot: cleanText(input.slot),
      hostId: cleanText(input.hostId),
      supportId: cleanText(input.supportId),
      lane: cleanText(input.format).toLowerCase().includes("home") ? "home" : "studio"
    }),
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
    status,
    generatedBy: input.generatedBy === "website" || input.generatedBy === "google_sheet"
      ? input.generatedBy
      : undefined,
    generationBatchId: cleanText(input.generationBatchId) || undefined,
    manualOverride: input.manualOverride === true,
    isHostConfirmed: input.isHostConfirmed === true,
    isSupportConfirmed: input.isSupportConfirmed === true,
    canConfirmHost: input.canConfirmHost === true,
    canConfirmSupport: input.canConfirmSupport === true,
    supportRequired: input.supportRequired === true,
    isSupportOnly: input.isSupportOnly === true,
    missingSupport: input.missingSupport === true,
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
      if (!row.hostId && row.status === "open") summary.openHost += 1;
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
      openHost: 0,
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

export async function getScheduleSessionsForGeneration(
  weekStartKey: string,
  weekEndKey: string
): Promise<ScheduleSession[]> {
  const { sessions } = await getCollections();
  const documents = await sessions
    .find({ active: true, dateKey: { $gte: weekStartKey, $lte: weekEndKey } })
    .sort({ dateKey: 1, slotSortKey: 1, sessionKey: 1 })
    .toArray();
  return documents.map(toScheduleSession);
}

export async function publishGeneratedScheduleWeek(
  input: PublishGeneratedWeekInput
): Promise<ScheduleWriteResult> {
  const normalizedRows = input.rows.map(normalizeScheduleSession);
  const seenSessionIds = new Set<string>();
  normalizedRows.forEach((row) => {
    if (!row.sessionId) throw new Error("Lịch được tạo đang thiếu Session ID.");
    if (row.dateKey < input.weekStartKey || row.dateKey > input.weekEndKey || row.dateKey <= input.todayKey) {
      throw new Error(`Session ${row.sessionId} nằm ngoài phạm vi ngày tương lai của tuần được chạy.`);
    }
    if (seenSessionIds.has(row.sessionId)) throw new Error(`Session ID bị trùng: ${row.sessionId}.`);
    seenSessionIds.add(row.sessionId);
    row.sessionCode = getScheduleSessionCode(row);
  });

  const { sessions, syncRuns } = await getCollections();
  const client = await getMongoClient();
  const batchId = randomUUID();
  const completedAt = new Date();
  const startedAt = input.startedAt || completedAt;
  let inserted = 0;
  let updated = 0;
  let deactivated = 0;
  let publishedTotal = 0;

  await client.withSession(async (mongoSession) => {
    await mongoSession.withTransaction(async () => {
      const existingFutureRows = await sessions.find(
        {
          active: true,
          dateKey: { $gte: input.weekStartKey, $lte: input.weekEndKey, $gt: input.todayKey }
        },
        { session: mongoSession }
      ).toArray();
      const protectedSlotKeys = new Set(
        existingFutureRows
          .filter((row) => row.isHostConfirmed || row.isSupportConfirmed || (input.preserveManualOverrides !== false && row.manualOverride))
          .map((row) => buildScheduleLaneKey(row.dateKey, row.slot, getScheduleSessionLane(row)))
      );
      const rowsToPublish = normalizedRows.filter(
        (row) => !protectedSlotKeys.has(buildScheduleLaneKey(row.dateKey, row.slot, getScheduleSessionLane(row)))
      );
      const publishKeys = rowsToPublish.map((row) => row.sessionId);

      if (rowsToPublish.length > 0) {
        const result = await sessions.bulkWrite(
          rowsToPublish.map((row) => ({
            updateOne: {
              filter: { sessionKey: row.sessionId },
              update: {
                $set: {
                  ...row,
                  generatedBy: "website" as const,
                  generationBatchId: batchId,
                  sessionKey: row.sessionId,
                  hostPersonKey: buildPersonKey("host", row.hostId),
                  supportPersonKey: buildPersonKey("support", row.supportId),
                  backupHostPersonKey: buildPersonKey("host", row.backupHostId),
                  backupSupportPersonKey: buildPersonKey("support", row.backupSupportId),
                  active: true,
                  sourceGeneratedAt: completedAt,
                  sourceSnapshotRevision: 0,
                  syncBatchId: batchId,
                  lastSeenAt: completedAt,
                  updatedAt: completedAt,
                  deactivatedAt: null,
                  hostConfirmationRevision: 0,
                  supportConfirmationRevision: 0
                },
                $setOnInsert: { firstSyncedAt: completedAt },
                $unset: {
                  sourceSpreadsheetId: "",
                  sourceSheetName: "",
                  hostConfirmationUpdatedAt: "",
                  hostConfirmationActorKey: "",
                  supportConfirmationUpdatedAt: "",
                  supportConfirmationActorKey: ""
                }
              },
              upsert: true
            }
          })),
          { session: mongoSession }
        );
        inserted = result.upsertedCount;
        updated = result.matchedCount;
      }

      const deactivateResult = await sessions.updateMany(
        {
          active: true,
          dateKey: { $gte: input.weekStartKey, $lte: input.weekEndKey, $gt: input.todayKey },
          isHostConfirmed: { $ne: true },
          isSupportConfirmed: { $ne: true },
          ...(input.preserveManualOverrides !== false ? { manualOverride: { $ne: true } } : {}),
          ...(publishKeys.length > 0 ? { sessionKey: { $nin: publishKeys } } : {})
        },
        { $set: { active: false, deactivatedAt: completedAt, updatedAt: completedAt } },
        { session: mongoSession }
      );
      deactivated = deactivateResult.modifiedCount;
      publishedTotal = rowsToPublish.length;

      await syncRuns.insertOne(
        {
          batchId,
          syncType: "schedule",
          mode: input.preserveManualOverrides === false ? "website_generation_refresh_unconfirmed" : "website_generation",
          status: "success",
          requestedBy: cleanText(input.requestedBy) || "admin:admin",
          sourceGeneratedAt: completedAt,
          timezone: DEFAULT_TIMEZONE,
          startedAt,
          completedAt,
          total: publishedTotal,
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
    mode: input.preserveManualOverrides === false ? "website_generation_refresh_unconfirmed" : "website_generation",
    inserted,
    updated,
    deactivated,
    total: publishedTotal,
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
    sheetName: "Website Schedule API",
    generatedAt: latestSync?.sourceGeneratedAt?.toISOString() || latestSync?.completedAt.toISOString(),
    syncedAt: latestSync?.completedAt.toISOString(),
    timezone: latestSync?.timezone || DEFAULT_TIMEZONE,
    rowCount: rows.length,
    summary: buildSummary(rows),
    rows,
    ...(!latestSync ? { message: "Lịch chưa được Admin chạy trên website." } : {})
  };
}

export async function findScheduleSessionById(sessionId: string): Promise<ScheduleSession | null> {
  const { sessions } = await getCollections();
  const document = await sessions.findOne({ sessionKey: cleanText(sessionId), active: true });
  return document ? toScheduleSession(document) : null;
}

export async function updateScheduleSessionAssignment(
  input: UpdateScheduleAssignmentInput
): Promise<ScheduleSession> {
  const { sessions } = await getCollections();
  const sessionId = cleanText(input.sessionId);
  if (!sessionId) throw new Error("Thiếu Session ID cần cập nhật.");
  if (input.locationMode !== undefined && input.locationMode !== "home" && input.locationMode !== "studio") {
    throw new Error("Địa điểm ca không hợp lệ.");
  }

  const document = await sessions.findOne({ sessionKey: sessionId, active: true });
  if (!document) throw new Error("Không tìm thấy ca trong lịch MongoDB.");
  const current = toScheduleSession(document);
  const hostWasEdited = input.hostId !== undefined;
  const supportWasEdited = input.supportId !== undefined;
  const resolvedHostId = hostWasEdited ? cleanText(input.hostId) : current.hostId;
  const resolvedSupportId = supportWasEdited ? cleanText(input.supportId) : current.supportId;
  const activeHost = resolvedHostId ? await findActiveSchedulePerson("host", resolvedHostId) : null;
  const activeSupport = resolvedSupportId ? await findActiveSchedulePerson("support", resolvedSupportId) : null;

  if (hostWasEdited && resolvedHostId && !activeHost) {
    throw new Error("Host được chọn không tồn tại hoặc đã tạm ngưng.");
  }
  if (supportWasEdited && resolvedSupportId && !activeSupport) {
    throw new Error("Support được chọn không tồn tại hoặc đã tạm ngưng.");
  }

  const host = activeHost || (resolvedHostId ? {
    id: current.hostId,
    name: current.hostName || current.hostId,
    role: "host" as const,
    workLocation: getSessionLocationMode(current) || "studio",
    liveChannelId: current.channel
  } : null);
  const support = activeSupport || (resolvedSupportId ? {
    id: current.supportId,
    name: current.supportName || current.supportId,
    role: "support" as const
  } : null);
  const configuredLocation = cleanText(host?.workLocation).toLowerCase().replace(/\s+/g, "-");
  const studioLocation = configuredLocation && !["home", "both", "studio"].includes(configuredLocation)
    ? await findActiveScheduleLocation(configuredLocation)
    : null;

  if (configuredLocation && !["home", "both", "studio"].includes(configuredLocation) && !studioLocation) {
    throw new Error("Địa điểm Studio trong hồ sơ Host không tồn tại hoặc đã tạm ngưng.");
  }

  const updated = buildManualScheduleAssignment({
    current,
    host,
    support,
    hostWasEdited,
    supportWasEdited,
    locationMode: input.locationMode,
    studioLocationName: studioLocation?.name
  });
  const hostNeedsConfirmationReset = current.hostId.toLowerCase() !== updated.hostId.toLowerCase()
    || current.format.toLowerCase() !== updated.format.toLowerCase();
  const supportNeedsConfirmationReset = current.supportId.toLowerCase() !== updated.supportId.toLowerCase()
    || current.format.toLowerCase() !== updated.format.toLowerCase();
  const now = new Date();
  const unsetFields: Record<string, ""> = {};

  if (hostNeedsConfirmationReset) {
    unsetFields.hostConfirmationUpdatedAt = "";
    unsetFields.hostConfirmationActorKey = "";
  }
  if (supportNeedsConfirmationReset) {
    unsetFields.supportConfirmationUpdatedAt = "";
    unsetFields.supportConfirmationActorKey = "";
  }

  const result = await sessions.updateOne(
    { sessionKey: sessionId, active: true },
    {
      $set: {
        ...updated,
        hostPersonKey: buildPersonKey("host", updated.hostId),
        supportPersonKey: buildPersonKey("support", updated.supportId),
        backupHostPersonKey: buildPersonKey("host", updated.backupHostId),
        backupSupportPersonKey: buildPersonKey("support", updated.backupSupportId),
        ...(hostNeedsConfirmationReset ? { hostConfirmationRevision: 0 } : {}),
        ...(supportNeedsConfirmationReset ? { supportConfirmationRevision: 0 } : {}),
        manualOverride: true,
        manualOverrideUpdatedAt: now,
        manualOverrideUpdatedBy: cleanText(input.actorAccountKey) || "admin:admin",
        updatedAt: now
      },
      ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {})
    }
  );
  if (result.matchedCount !== 1) throw new Error("Ca đã thay đổi trước khi cập nhật được lưu.");
  return updated;
}

export async function deleteScheduleSession(
  input: DeleteScheduleSessionInput
): Promise<ScheduleSession> {
  const { sessions } = await getCollections();
  const sessionId = cleanText(input.sessionId);
  if (!sessionId) throw new Error("Thiếu Session ID cần xóa.");

  const document = await sessions.findOne({ sessionKey: sessionId, active: true });
  if (!document) throw new Error("Không tìm thấy ca trong lịch MongoDB.");
  const current = toScheduleSession(document);
  const now = new Date();

  const result = await sessions.updateOne(
    { sessionKey: sessionId, active: true },
    {
      $set: {
        active: false,
        deactivatedAt: now,
        manualOverride: true,
        manualOverrideUpdatedAt: now,
        manualOverrideUpdatedBy: cleanText(input.actorAccountKey) || "admin:admin",
        updatedAt: now
      }
    }
  );
  if (result.matchedCount !== 1) throw new Error("Ca đã thay đổi trước khi xóa được lưu.");
  return current;
}

export async function applyScheduleConfirmationToMongo(input: ApplyConfirmationInput): Promise<void> {
  const { sessions, events } = await getCollections();
  const client = await getMongoClient();
  const sessionId = cleanText(input.sessionId);
  const confirmedText = input.confirmed ? "Đã xác nhận" : "Chưa xác nhận";
  const now = new Date();
  const sourceRevision = cleanNumber(input.sourceRevision);

  await client.withSession(async (mongoSession) => {
    await mongoSession.withTransaction(async () => {
      const current = await sessions.findOne(
        { sessionKey: sessionId, active: true },
        { session: mongoSession, projection: { _id: 1, dateKey: 1, hostId: 1, supportId: 1 } }
      );
      if (!current) throw new Error("Không tìm thấy ca trong lịch MongoDB.");

      if (input.actorType === "employee") {
        if (!input.actorRole || input.role !== input.actorRole || !input.actorEmployeeId) {
          throw new Error("Vai trò xác nhận không khớp với tài khoản nhân viên.");
        }
        const assignedEmployeeId = input.role === "host" ? current.hostId : current.supportId;
        if (cleanText(assignedEmployeeId).toLowerCase() !== cleanText(input.actorEmployeeId).toLowerCase()) {
          throw new Error("Phân công đã thay đổi trước khi xác nhận được lưu.");
        }
        if (input.expectedDateKey && cleanText(current.dateKey) !== cleanText(input.expectedDateKey)) {
          throw new Error("Ngày của ca đã thay đổi trước khi xác nhận được lưu.");
        }
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
        if (sourceRevision > 0) confirmationFields[revisionField] = sourceRevision;

        const result = await sessions.updateOne(
          {
            sessionKey: sessionId,
            active: true,
            ...(sourceRevision > 0
              ? { $or: [{ [revisionField]: { $exists: false } }, { [revisionField]: { $lt: sourceRevision } }] }
              : {})
          },
          { $set: confirmationFields },
          { session: mongoSession }
        );
        if (result.matchedCount === 1) appliedRoles.push(role);
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
