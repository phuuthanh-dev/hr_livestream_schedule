import { randomUUID } from "node:crypto";
import type { Collection, WithId } from "mongodb";
import { findActiveSchedulePerson, listSchedulePeopleForAdmin } from "@/lib/employeeRoster";
import { getSubmittedScheduleSlotsForWeek } from "@/lib/availabilityStore";
import { findActiveScheduleLocation } from "@/lib/locationStore";
import { getMongoClient, getMongoDatabase } from "@/lib/mongodb";
import { buildManualScheduleAssignment, getSessionLocationMode } from "@/lib/scheduleAssignment";
import { getScheduleTodayKey, getScheduleWeekDateKeys, getScheduleWeekStartKey } from "@/lib/scheduleDate";
import { pickHostCandidatesForSingleSession, pickSupportCandidatesForSingleSession } from "@/lib/scheduleEngine";
import { buildScheduleLaneKey, getScheduleSessionLane } from "@/lib/scheduleLane";
import { buildScheduleSessionCode, buildScheduleSessionKey, getScheduleSessionCode } from "@/lib/scheduleSessionCode";
import type {
  AccountType,
  AvailabilityLocationPreference,
  ConfirmRole,
  EmployeeRole,
  ScheduleHandoverRequest,
  SchedulePayload,
  ScheduleSession,
  ScheduleSummary
} from "@/lib/types";

const SESSIONS_COLLECTION = "schedule_sessions";
const SYNC_RUNS_COLLECTION = "schedule_sync_runs";
const CONFIRMATION_EVENTS_COLLECTION = "schedule_confirmation_events";
const HANDOVER_REQUESTS_COLLECTION = "schedule_handover_requests";
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

type ScheduleConflictCheckInput = {
  excludeSessionId?: string;
  dateKey: string;
  slot: string;
  lane: "home" | "studio";
  hostId?: string;
  supportId?: string;
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

type ScheduleHandoverRequestDocument = {
  requestId: string;
  sessionId: string;
  sessionCode?: string;
  dateKey: string;
  dateLabel: string;
  slot: string;
  role: EmployeeRole;
  fromEmployeeId: string;
  fromEmployeeName: string;
  fromPersonKey: string;
  toEmployeeId: string;
  toEmployeeName: string;
  toPersonKey: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  note?: string;
  createdAt: Date;
  respondedAt?: Date;
  responseNote?: string;
  createdBy: string;
  respondedBy?: string;
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

function toScheduleHandoverRequest(document: ScheduleHandoverRequestDocument): ScheduleHandoverRequest {
  return {
    requestId: document.requestId,
    sessionId: document.sessionId,
    sessionCode: document.sessionCode,
    dateKey: document.dateKey,
    dateLabel: document.dateLabel,
    slot: document.slot,
    role: document.role,
    fromEmployeeId: document.fromEmployeeId,
    fromEmployeeName: document.fromEmployeeName,
    toEmployeeId: document.toEmployeeId,
    toEmployeeName: document.toEmployeeName,
    status: document.status,
    note: cleanText(document.note) || undefined,
    createdAt: document.createdAt.toISOString(),
    respondedAt: document.respondedAt?.toISOString(),
    responseNote: cleanText(document.responseNote) || undefined
  };
}

export type UpdateScheduleAssignmentInput = {
  sessionId: string;
  hostId?: string;
  supportId?: string;
  locationMode?: AvailabilityLocationPreference;
  rerankRole?: "host" | "support";
  actorAccountKey: string;
};

export type DeleteScheduleSessionInput = {
  sessionId: string;
  actorAccountKey: string;
};

export type ReleaseFutureScheduleAssignmentsInput = {
  role: EmployeeRole;
  employeeId: string;
  actorAccountKey: string;
  fromDateKey?: string;
};

export type CancelScheduleParticipationInput = {
  sessionId: string;
  role: EmployeeRole;
  actorAccountKey: string;
  actorType: AccountType;
  actorRole?: EmployeeRole;
  actorEmployeeId?: string;
  expectedDateKey?: string;
};

export type CreateScheduleSessionInput = {
  dateKey: string;
  slot: string;
  locationMode: AvailabilityLocationPreference;
  actorAccountKey: string;
};

export type CreateScheduleHandoverRequestInput = {
  sessionId: string;
  role: EmployeeRole;
  fromEmployeeId: string;
  toEmployeeId: string;
  actorAccountKey: string;
  note?: string;
};

export type RespondScheduleHandoverRequestInput = {
  requestId: string;
  actorAccountKey: string;
  actorEmployeeId: string;
  action: "accept" | "reject";
  responseNote?: string;
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

function buildAutoConfirmationState(input: ScheduleSession) {
  const lane = getScheduleSessionLane(input);
  const hostAssigned = Boolean(cleanText(input.hostId));
  const supportAssigned = lane === "studio" && Boolean(cleanText(input.supportId));
  return {
    hostConfirm: hostAssigned ? "Đã xác nhận" : "Chưa xác nhận",
    supportConfirm: supportAssigned ? "Đã xác nhận" : "Chưa xác nhận",
    isHostConfirmed: hostAssigned,
    isSupportConfirmed: supportAssigned,
    canConfirmHost: hostAssigned,
    canConfirmSupport: supportAssigned
  };
}

function buildPreservedHostPerson(session: ScheduleSession) {
  if (!cleanText(session.hostId)) return null;
  return {
    id: session.hostId,
    name: session.hostName || session.hostId,
    role: "host" as const,
    workLocation: getSessionLocationMode(session) || "studio",
    liveChannelId: session.channel
  };
}

function buildPreservedSupportPerson(session: ScheduleSession) {
  if (!cleanText(session.supportId)) return null;
  return {
    id: session.supportId,
    name: session.supportName || session.supportId,
    role: "support" as const
  };
}

function weekdayLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("vi-VN", { weekday: "long", timeZone: DEFAULT_TIMEZONE })
    .format(new Date(Date.UTC(year, month - 1, day, 5)));
}

function dateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function slotStartMinutes(slot: string) {
  const match = slot.match(/^\s*(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

function buildManualSessionKey(dateKey: string, slot: string, lane: "home" | "studio") {
  const baseKey = buildScheduleSessionKey(dateKey, slot, lane);
  return `${baseKey}_${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function assertNoScheduleAssignmentConflict(
  sessions: Collection<ScheduleSessionDocument>,
  input: ScheduleConflictCheckInput
) {
  const hostId = cleanText(input.hostId);
  const supportId = cleanText(input.supportId);
  const rows = await sessions.find({
    active: true,
    dateKey: input.dateKey,
    slot: input.slot,
    ...(input.excludeSessionId ? { sessionKey: { $ne: input.excludeSessionId } } : {})
  }).toArray();

  for (const row of rows) {
    const candidate = toScheduleSession(row);
    if (getScheduleSessionLane(candidate) === input.lane) {
      throw new Error(`Khung giờ ${candidate.slot} ngày ${candidate.dateLabel} đã có ca ${input.lane === "home" ? "Home" : "Studio"}.`);
    }
    if (hostId && cleanText(candidate.hostId).toLowerCase() === hostId.toLowerCase()) {
      throw new Error(`Host ${candidate.hostName || candidate.hostId} đã được gán ở ca ${candidate.slot} ngày ${candidate.dateLabel}.`);
    }
    if (supportId && cleanText(candidate.supportId).toLowerCase() === supportId.toLowerCase()) {
      throw new Error(`Support ${candidate.supportName || candidate.supportId} đã được gán ở ca ${candidate.slot} ngày ${candidate.dateLabel}.`);
    }
  }
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
      const handovers = database.collection<ScheduleHandoverRequestDocument>(HANDOVER_REQUESTS_COLLECTION);
      await Promise.all([
        sessions.createIndex({ sessionKey: 1 }, { unique: true }),
        sessions.createIndex({ active: 1, dateKey: 1, slotSortKey: 1 }),
        sessions.createIndex({ active: 1, hostPersonKey: 1, dateKey: 1 }),
        sessions.createIndex({ active: 1, supportPersonKey: 1, dateKey: 1 }),
        syncRuns.createIndex({ batchId: 1 }, { unique: true }),
        syncRuns.createIndex({ syncType: 1, status: 1, completedAt: -1 }),
        events.createIndex({ eventId: 1 }, { unique: true }),
        events.createIndex({ sessionId: 1, createdAt: -1 }),
        events.createIndex({ actorAccountKey: 1, createdAt: -1 }),
        handovers.createIndex({ requestId: 1 }, { unique: true }),
        handovers.createIndex({ toPersonKey: 1, status: 1, dateKey: 1 }),
        handovers.createIndex({ fromPersonKey: 1, status: 1, dateKey: 1 }),
        handovers.createIndex({ sessionId: 1, role: 1, status: 1, createdAt: -1 })
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
  handovers: Collection<ScheduleHandoverRequestDocument>;
}> {
  await ensureScheduleIndexes();
  const database = await getMongoDatabase();
  return {
    sessions: database.collection<ScheduleSessionDocument>(SESSIONS_COLLECTION),
    syncRuns: database.collection<ScheduleSyncRunDocument>(SYNC_RUNS_COLLECTION),
    events: database.collection<ScheduleConfirmationEventDocument>(CONFIRMATION_EVENTS_COLLECTION),
    handovers: database.collection<ScheduleHandoverRequestDocument>(HANDOVER_REQUESTS_COLLECTION)
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
    Object.assign(row, buildAutoConfirmationState(row));
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

export async function listScheduleHandoverRequestsForEmployee(input: {
  employeeId: string;
  from?: string;
  to?: string;
}): Promise<ScheduleHandoverRequest[]> {
  const { handovers } = await getCollections();
  const employeeId = cleanText(input.employeeId);
  if (!employeeId) return [];
  const dateFilter: Record<string, string> = {};
  if (input.from) dateFilter.$gte = input.from;
  if (input.to) dateFilter.$lte = input.to;
  const documents = await handovers.find({
    $or: [
      { fromPersonKey: buildPersonKey("host", employeeId) },
      { fromPersonKey: buildPersonKey("support", employeeId) },
      { toPersonKey: buildPersonKey("host", employeeId) },
      { toPersonKey: buildPersonKey("support", employeeId) }
    ],
    ...(Object.keys(dateFilter).length > 0 ? { dateKey: dateFilter } : {})
  }).sort({ createdAt: -1 }).toArray();
  return documents.map(toScheduleHandoverRequest);
}

export async function createScheduleHandoverRequest(
  input: CreateScheduleHandoverRequestInput
): Promise<ScheduleHandoverRequest> {
  const { sessions, handovers } = await getCollections();
  const sessionId = cleanText(input.sessionId);
  const fromEmployeeId = cleanText(input.fromEmployeeId);
  const toEmployeeId = cleanText(input.toEmployeeId);
  if (!sessionId) throw new Error("Thiếu sessionId để nhường ca.");
  if (!fromEmployeeId || !toEmployeeId) throw new Error("Cần chọn người nhường và người nhận ca.");
  if (fromEmployeeId.toLowerCase() === toEmployeeId.toLowerCase()) {
    throw new Error("Người nhận ca phải khác người đang giữ ca.");
  }

  const document = await sessions.findOne({ sessionKey: sessionId, active: true });
  if (!document) throw new Error("Không tìm thấy ca trong lịch MongoDB.");
  const current = toScheduleSession(document);
  if (current.dateKey < getScheduleTodayKey()) {
    throw new Error(`Chỉ được nhường ca tương lai. Ca ${current.slot} ngày ${current.dateLabel} đã qua.`);
  }

  const assignedEmployeeId = input.role === "host" ? current.hostId : current.supportId;
  const assignedEmployeeName = input.role === "host" ? current.hostName : current.supportName;
  if (cleanText(assignedEmployeeId).toLowerCase() !== fromEmployeeId.toLowerCase()) {
    throw new Error("Ca đã đổi người trước khi yêu cầu nhường ca được tạo.");
  }

  const recipient = await findActiveSchedulePerson(input.role, toEmployeeId);
  if (!recipient) {
    throw new Error(`${input.role === "host" ? "Host" : "Support"} nhận ca không tồn tại hoặc đã tạm ngưng.`);
  }

  const existingPending = await handovers.findOne({
    sessionId,
    role: input.role,
    status: "pending"
  });
  if (existingPending) {
    throw new Error("Ca này đang có một yêu cầu nhường ca chờ xác nhận.");
  }

  await assertNoScheduleAssignmentConflict(sessions, {
    excludeSessionId: current.sessionId,
    dateKey: current.dateKey,
    slot: current.slot,
    lane: getScheduleSessionLane(current),
    ...(input.role === "host" ? { hostId: recipient.id } : {}),
    ...(input.role === "support" ? { supportId: recipient.id } : {})
  });

  const request: ScheduleHandoverRequestDocument = {
    requestId: `handover-${randomUUID()}`,
    sessionId: current.sessionId,
    sessionCode: current.sessionCode || "",
    dateKey: current.dateKey,
    dateLabel: current.dateLabel,
    slot: current.slot,
    role: input.role,
    fromEmployeeId,
    fromEmployeeName: assignedEmployeeName || fromEmployeeId,
    fromPersonKey: buildPersonKey(input.role, fromEmployeeId),
    toEmployeeId: recipient.id,
    toEmployeeName: recipient.name,
    toPersonKey: buildPersonKey(input.role, recipient.id),
    status: "pending",
    note: cleanText(input.note) || undefined,
    createdAt: new Date(),
    createdBy: cleanText(input.actorAccountKey) || fromEmployeeId
  };
  await handovers.insertOne(request);
  return toScheduleHandoverRequest(request);
}

export async function respondScheduleHandoverRequest(
  input: RespondScheduleHandoverRequestInput
): Promise<{ request: ScheduleHandoverRequest; session?: ScheduleSession }> {
  const { handovers, sessions } = await getCollections();
  const requestId = cleanText(input.requestId);
  const actorEmployeeId = cleanText(input.actorEmployeeId);
  if (!requestId || !actorEmployeeId) {
    throw new Error("Thiếu requestId hoặc nhân sự phản hồi.");
  }

  const requestDocument = await handovers.findOne({ requestId });
  if (!requestDocument) throw new Error("Không tìm thấy yêu cầu nhường ca.");
  if (requestDocument.status !== "pending") throw new Error("Yêu cầu này không còn ở trạng thái chờ xác nhận.");
  if (cleanText(requestDocument.toEmployeeId).toLowerCase() !== actorEmployeeId.toLowerCase()) {
    throw new Error("Bạn không có quyền phản hồi yêu cầu nhường ca này.");
  }

  if (input.action === "reject") {
    const rejectedAt = new Date();
    await handovers.updateOne(
      { requestId, status: "pending" },
      {
        $set: {
          status: "rejected",
          respondedAt: rejectedAt,
          responseNote: cleanText(input.responseNote) || undefined,
          respondedBy: cleanText(input.actorAccountKey) || actorEmployeeId
        }
      }
    );
    return {
      request: toScheduleHandoverRequest({
        ...requestDocument,
        status: "rejected",
        respondedAt: rejectedAt,
        responseNote: cleanText(input.responseNote) || undefined,
        respondedBy: cleanText(input.actorAccountKey) || actorEmployeeId
      })
    };
  }

  const currentDocument = await sessions.findOne({ sessionKey: requestDocument.sessionId, active: true });
  if (!currentDocument) throw new Error("Ca này không còn tồn tại trên lịch chính.");
  const current = toScheduleSession(currentDocument);
  if (current.dateKey < getScheduleTodayKey()) {
    throw new Error(`Ca ${current.slot} ngày ${current.dateLabel} đã qua nên không thể nhận nhường ca nữa.`);
  }

  const assignedEmployeeId = requestDocument.role === "host" ? current.hostId : current.supportId;
  if (cleanText(assignedEmployeeId).toLowerCase() !== cleanText(requestDocument.fromEmployeeId).toLowerCase()) {
    throw new Error("Ca đã đổi người trước khi yêu cầu nhường ca được xác nhận.");
  }

  const recipient = await findActiveSchedulePerson(requestDocument.role, requestDocument.toEmployeeId);
  if (!recipient) {
    throw new Error("Người nhận ca không còn active nên không thể hoàn tất nhường ca.");
  }

  const updatedSession = await updateScheduleSessionAssignment({
    sessionId: current.sessionId,
    ...(requestDocument.role === "host" ? { hostId: recipient.id } : {}),
    ...(requestDocument.role === "support" ? { supportId: recipient.id } : {}),
    actorAccountKey: input.actorAccountKey
  });

  const acceptedAt = new Date();
  await handovers.updateOne(
    { requestId, status: "pending" },
    {
      $set: {
        status: "accepted",
        respondedAt: acceptedAt,
        responseNote: cleanText(input.responseNote) || undefined,
        respondedBy: cleanText(input.actorAccountKey) || actorEmployeeId
      }
    }
  );
  return {
    request: toScheduleHandoverRequest({
      ...requestDocument,
      status: "accepted",
      respondedAt: acceptedAt,
      responseNote: cleanText(input.responseNote) || undefined,
      respondedBy: cleanText(input.actorAccountKey) || actorEmployeeId
    }),
    session: updatedSession
  };
}

async function saveUpdatedScheduleSession(
  sessions: Collection<ScheduleSessionDocument>,
  current: ScheduleSession,
  updated: ScheduleSession,
  actorAccountKey: string
) {
  await assertNoScheduleAssignmentConflict(sessions, {
    excludeSessionId: current.sessionId,
    dateKey: updated.dateKey,
    slot: updated.slot,
    lane: getScheduleSessionLane(updated),
    hostId: updated.hostId,
    supportId: updated.supportId
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
    { sessionKey: current.sessionId, active: true },
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
        manualOverrideUpdatedBy: cleanText(actorAccountKey) || "admin:admin",
        updatedAt: now
      },
      ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {})
    }
  );
  if (result.matchedCount !== 1) throw new Error("Ca đã thay đổi trước khi cập nhật được lưu.");
}

async function rerankScheduleSessionRole(
  sessions: Collection<ScheduleSessionDocument>,
  current: ScheduleSession,
  role: "host" | "support",
  actorAccountKey: string
): Promise<ScheduleSession> {
  const weekStartKey = getScheduleWeekStartKey(current.dateKey);
  const weekEndKey = getScheduleWeekDateKeys(weekStartKey).at(-1) || weekStartKey;
  const [people, availability, weekPayload] = await Promise.all([
    listSchedulePeopleForAdmin(),
    getSubmittedScheduleSlotsForWeek(weekStartKey),
    getScheduleFromMongo({ from: weekStartKey, to: weekEndKey })
  ]);
  const activePeople = people.filter((person) => person.active !== false);
  const siblingSessions = (weekPayload.rows || []).filter((session) => session.sessionId !== current.sessionId);

  const hostWeekCounts = new Map<string, number>();
  const hostDayCounts = new Map<string, number>();
  const occupiedHosts = new Set<string>();
  const supportWeekCounts = new Map<string, number>();
  const supportUsedDays = new Set<string>();
  const occupiedSupports = new Set<string>();

  siblingSessions.forEach((session) => {
    if (session.hostId) {
      const key = buildPersonKey("host", session.hostId).toLowerCase();
      hostWeekCounts.set(key, (hostWeekCounts.get(key) || 0) + 1);
      hostDayCounts.set(`${key}__${session.dateKey}`, (hostDayCounts.get(`${key}__${session.dateKey}`) || 0) + 1);
      occupiedHosts.add(`${key}__${session.dateKey}__${session.slot}`);
    }
    if (session.supportId) {
      const key = buildPersonKey("support", session.supportId).toLowerCase();
      supportWeekCounts.set(key, (supportWeekCounts.get(key) || 0) + 1);
      supportUsedDays.add(`${key}__${session.dateKey}`);
      occupiedSupports.add(`${key}__${session.dateKey}__${session.slot}`);
    }
  });

  const preservedHost = (current.hostId ? await findActiveSchedulePerson("host", current.hostId) : null) || buildPreservedHostPerson(current);
  const preservedSupport = (current.supportId ? await findActiveSchedulePerson("support", current.supportId) : null) || buildPreservedSupportPerson(current);
  const lane = getScheduleSessionLane(current);

  if (role === "host") {
    const candidates = pickHostCandidatesForSingleSession({
      dateKey: current.dateKey,
      slot: current.slot,
      lane,
      people: activePeople,
      availability,
      hostWeekCounts,
      hostDayCounts,
      occupiedHosts,
      excludeEmployeeIds: current.hostId ? [current.hostId] : []
    });
    const nextHost = candidates[0]?.person || null;
    const updated = buildManualScheduleAssignment({
      current,
      host: nextHost,
      support: preservedSupport,
      hostWasEdited: true,
      supportWasEdited: false,
      locationMode: candidates[0]?.location || getSessionLocationMode(current) || undefined
    });
    updated.backupHostId = candidates[1]?.person.id || "";
    updated.backupHostName = candidates[1]?.person.name || "";
    if (!nextHost) {
      updated.warnings = updated.warnings.filter((warning) => !warning.startsWith("BACKUP_HOST:"));
      if (!updated.warnings.some((warning) => warning.startsWith("OPEN_HOST:"))) {
        updated.warnings.push("OPEN_HOST: Không tìm thấy Host thay thế phù hợp khi xếp lại ca.");
      }
    }
    await saveUpdatedScheduleSession(sessions, current, updated, actorAccountKey);
    return updated;
  }

  if (lane !== "studio") {
    throw new Error("Ca Home không dùng Support để xếp lại.");
  }

  const supportCandidates = pickSupportCandidatesForSingleSession({
    session: current,
    currentHost: preservedHost,
    people: activePeople,
    availability,
    supportWeekCounts,
    supportUsedDays,
    occupiedSupports,
    excludeEmployeeIds: current.supportId ? [current.supportId] : []
  });
  const updated = buildManualScheduleAssignment({
    current,
    host: preservedHost,
    support: supportCandidates[0] || null,
    hostWasEdited: false,
    supportWasEdited: true
  });
  updated.backupSupportId = supportCandidates[1]?.id || "";
  updated.backupSupportName = supportCandidates[1]?.name || "";
  updated.supportCandidatePool = supportCandidates.map((person) => person.id).join(", ");
  if (!supportCandidates[0]) {
    updated.warnings = updated.warnings.filter((warning) => !warning.startsWith("BACKUP_SUPPORT:"));
    if (!updated.warnings.some((warning) => warning.startsWith("OPEN_SUPPORT:"))) {
      updated.warnings.push("OPEN_SUPPORT: Không tìm thấy Support thay thế phù hợp khi xếp lại ca.");
    }
  }
  await saveUpdatedScheduleSession(sessions, current, updated, actorAccountKey);
  return updated;
}

export async function releaseFutureScheduleAssignmentsForEmployee(
  input: ReleaseFutureScheduleAssignmentsInput
): Promise<{ released: number; sessionIds: string[] }> {
  const { sessions } = await getCollections();
  const employeeId = cleanText(input.employeeId);
  if (!employeeId) return { released: 0, sessionIds: [] };

  const fromDateKey = cleanText(input.fromDateKey) || getScheduleTodayKey();
  const personKeyField = input.role === "host" ? "hostPersonKey" : "supportPersonKey";
  const personKey = buildPersonKey(input.role, employeeId);
  if (!personKey) return { released: 0, sessionIds: [] };

  const documents = await sessions.find({
    active: true,
    dateKey: { $gt: fromDateKey },
    [personKeyField]: personKey
  }).toArray();

  const releasedSessionIds: string[] = [];
  for (const document of documents) {
    const current = toScheduleSession(document);
    const retainedHostId = input.role === "host" ? "" : current.hostId;
    const retainedSupportId = input.role === "support" ? "" : current.supportId;
    const activeHost = retainedHostId ? await findActiveSchedulePerson("host", retainedHostId) : null;
    const activeSupport = retainedSupportId ? await findActiveSchedulePerson("support", retainedSupportId) : null;
    const host = activeHost || (retainedHostId ? buildPreservedHostPerson(current) : null);
    const support = activeSupport || (retainedSupportId ? buildPreservedSupportPerson(current) : null);
    const locationMode = getSessionLocationMode(current) || "studio";
    const updated = buildManualScheduleAssignment({
      current,
      host,
      support,
      hostWasEdited: input.role === "host",
      supportWasEdited: input.role === "support",
      locationMode,
      studioLocationName: locationMode === "studio" ? current.format : undefined
    });

    await saveUpdatedScheduleSession(sessions, current, updated, input.actorAccountKey);
    releasedSessionIds.push(current.sessionId);
  }

  return {
    released: releasedSessionIds.length,
    sessionIds: releasedSessionIds
  };
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
  if (input.rerankRole) {
    return rerankScheduleSessionRole(sessions, current, input.rerankRole, input.actorAccountKey);
  }
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
  await saveUpdatedScheduleSession(sessions, current, updated, input.actorAccountKey);
  return updated;
}

export async function createScheduleSession(
  input: CreateScheduleSessionInput
): Promise<ScheduleSession> {
  const { sessions } = await getCollections();
  const dateKey = cleanText(input.dateKey);
  const slot = cleanText(input.slot);
  const locationMode = input.locationMode === "home" ? "home" : "studio";
  if (!dateKey) throw new Error("Thiếu ngày tạo ca.");
  if (!slot) throw new Error("Thiếu khung giờ tạo ca.");

  const now = new Date();
  const draft: ScheduleSession = {
    rowNumber: 0,
    stt: "",
    sessionId: buildManualSessionKey(dateKey, slot, locationMode),
    sessionCode: buildScheduleSessionCode({ dateKey, slot, lane: locationMode }),
    dateKey,
    dateLabel: dateLabel(dateKey),
    weekday: weekdayLabel(dateKey),
    slot,
    slotSortKey: String(slotStartMinutes(slot)).padStart(4, "0"),
    hostId: "",
    hostName: "",
    format: locationMode === "home" ? "Home" : "Studio",
    supportId: "",
    supportName: "",
    channel: "",
    scriptUrl: "",
    hostConfirm: "Chưa xác nhận",
    supportConfirm: "Chưa xác nhận",
    backupHostId: "",
    backupHostName: "",
    backupSupportId: "",
    backupSupportName: "",
    supportCandidatePool: "",
    status: "open",
    generatedBy: "website",
    generationBatchId: "",
    manualOverride: true,
    isHostConfirmed: false,
    isSupportConfirmed: false,
    canConfirmHost: false,
    canConfirmSupport: false,
    supportRequired: locationMode === "studio",
    isSupportOnly: false,
    missingSupport: locationMode === "studio",
    warningLevel: "danger",
    warnings: locationMode === "studio"
      ? ["OPEN_HOST: Chưa chọn Host cho ca.", "OPEN_SUPPORT: Ca Studio chưa có Support."]
      : ["OPEN_HOST: Chưa chọn Host cho ca."]
  };

  await assertNoScheduleAssignmentConflict(sessions, {
    dateKey,
    slot,
    lane: locationMode,
    hostId: "",
    supportId: ""
  });

  await sessions.insertOne({
    ...draft,
    sessionKey: draft.sessionId,
    hostPersonKey: "",
    supportPersonKey: "",
    backupHostPersonKey: "",
    backupSupportPersonKey: "",
    active: true,
    sourceGeneratedAt: null,
    sourceSnapshotRevision: 0,
    syncBatchId: `manual-${randomUUID()}`,
    firstSyncedAt: now,
    lastSeenAt: now,
    updatedAt: now,
    deactivatedAt: null,
    manualOverrideUpdatedAt: now,
    manualOverrideUpdatedBy: cleanText(input.actorAccountKey) || "admin:admin",
    hostConfirmationRevision: 0,
    supportConfirmationRevision: 0
  });

  return draft;
}

export async function cancelScheduleParticipation(
  input: CancelScheduleParticipationInput
): Promise<ScheduleSession> {
  const { sessions } = await getCollections();
  const sessionId = cleanText(input.sessionId);
  if (!sessionId) throw new Error("Thiếu Session ID cần hủy tham gia.");

  const document = await sessions.findOne({ sessionKey: sessionId, active: true });
  if (!document) throw new Error("Không tìm thấy ca trong lịch MongoDB.");
  const current = toScheduleSession(document);

  if (input.actorType === "employee") {
    if (!input.actorRole || input.actorRole !== input.role || !input.actorEmployeeId) {
      throw new Error("Vai trò hủy tham gia không khớp với tài khoản nhân viên.");
    }
    const assignedEmployeeId = input.role === "host" ? current.hostId : current.supportId;
    if (cleanText(assignedEmployeeId).toLowerCase() !== cleanText(input.actorEmployeeId).toLowerCase()) {
      throw new Error("Ca đã đổi người trước khi hủy tham gia được lưu.");
    }
    if (input.expectedDateKey && cleanText(current.dateKey) !== cleanText(input.expectedDateKey)) {
      throw new Error("Ngày của ca đã thay đổi trước khi hủy tham gia được lưu.");
    }
  }

  const retainedHostId = input.role === "host" ? "" : current.hostId;
  const retainedSupportId = input.role === "support" ? "" : current.supportId;
  const activeHost = retainedHostId ? await findActiveSchedulePerson("host", retainedHostId) : null;
  const activeSupport = retainedSupportId ? await findActiveSchedulePerson("support", retainedSupportId) : null;
  const host = activeHost || (retainedHostId ? {
    id: current.hostId,
    name: current.hostName || current.hostId,
    role: "host" as const,
    workLocation: getSessionLocationMode(current) || "studio",
    liveChannelId: current.channel
  } : null);
  const support = activeSupport || (retainedSupportId ? {
    id: current.supportId,
    name: current.supportName || current.supportId,
    role: "support" as const
  } : null);

  const updated = buildManualScheduleAssignment({
    current,
    host,
    support,
    hostWasEdited: input.role === "host",
    supportWasEdited: input.role === "support",
    locationMode: getSessionLocationMode(current) || "studio"
  });
  const now = new Date();
  const unsetFields: Record<string, ""> = {};
  if (input.role === "host") {
    unsetFields.hostConfirmationUpdatedAt = "";
    unsetFields.hostConfirmationActorKey = "";
  }
  if (input.role === "support") {
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
        ...(input.role === "host" ? { hostConfirmationRevision: 0 } : {}),
        ...(input.role === "support" ? { supportConfirmationRevision: 0 } : {}),
        manualOverride: true,
        manualOverrideUpdatedAt: now,
        manualOverrideUpdatedBy: cleanText(input.actorAccountKey) || "employee",
        updatedAt: now
      },
      ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {})
    }
  );
  if (result.matchedCount !== 1) throw new Error("Ca đã thay đổi trước khi hủy tham gia được lưu.");
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
