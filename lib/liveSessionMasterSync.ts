import { randomUUID } from "node:crypto";
import { createGoogleSheetsClient, getGoogleHrMasterSpreadsheetId, getGoogleLiveSessionMasterSheetName } from "@/lib/googleSheets";
import { getMongoDatabase } from "@/lib/mongodb";
import { getScheduleFromMongo } from "@/lib/scheduleStore";
import { getScheduleWeekDateKeys, getScheduleWeekStartKey, isValidScheduleDateKey } from "@/lib/scheduleDate";
import { getScheduleSessionCode } from "@/lib/scheduleSessionCode";
import type { ScheduleSession } from "@/lib/types";

const DEFAULT_HEADERS = [
  "STT",
  "Thứ",
  "Ngày",
  "Khung giờ",
  "Mã nhân sự",
  "Tên Host",
  "Hình thức",
  "Mã Nhân sự Support live",
  "Tên Support live",
  "Live_Channel_Id",
  "Kịch Bản",
  "Session_ID",
  "Host_Live_Confirm",
  "Support_Live_Confirm",
  "Backup_Host_ID",
  "Backup_Host_Name",
  "Backup_Support_ID",
  "Backup_Support_Name",
  "Support_Candidate_Pool",
  "Cột 20",
  "Cột 21"
] as const;

const SYNC_RUNS_COLLECTION = "live_session_master_sync_runs";

export type LiveSessionMasterSyncInput = {
  actorAccountKey: string;
  from?: string;
  to?: string;
  weekStartKey?: string;
  targetSheetName?: string;
};

export type LiveSessionMasterSyncResult = {
  success: boolean;
  runId: string;
  spreadsheetId: string;
  sheetName: string;
  sheetUrl: string;
  from?: string;
  to?: string;
  rowCount: number;
  replacedRows: number;
  preservedRows: number;
  syncedAt: string;
  message: string;
};

type PersistedSyncRun = LiveSessionMasterSyncResult & {
  requestedBy: string;
  startedAt: string;
  mode: "full_refresh" | "refresh_range";
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeDateKey(value?: string) {
  const trimmed = normalizeText(value);
  return trimmed || undefined;
}

function formatDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function parseSheetDateToKey(value: string) {
  const trimmed = normalizeText(value);
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function slotSortValue(slot: string) {
  const match = normalizeText(slot).match(/^(\d{2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compareSessions(a: ScheduleSession, b: ScheduleSession) {
  if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
  const slotDiff = slotSortValue(a.slot) - slotSortValue(b.slot);
  if (slotDiff !== 0) return slotDiff;
  return getScheduleSessionCode(a).localeCompare(getScheduleSessionCode(b));
}

function compareSheetRows(left: string[], right: string[]) {
  const leftDateKey = parseSheetDateToKey(left[2] || "");
  const rightDateKey = parseSheetDateToKey(right[2] || "");
  if (leftDateKey && rightDateKey && leftDateKey !== rightDateKey) {
    return leftDateKey < rightDateKey ? 1 : -1;
  }
  if (leftDateKey && !rightDateKey) return -1;
  if (!leftDateKey && rightDateKey) return 1;

  const slotDiff = slotSortValue(left[3] || "") - slotSortValue(right[3] || "");
  if (slotDiff !== 0) return slotDiff;

  const leftSessionId = normalizeText(left[11] || "");
  const rightSessionId = normalizeText(right[11] || "");
  return leftSessionId.localeCompare(rightSessionId);
}

function renumberRows(rows: string[][]) {
  return rows.map((row, index) => {
    const nextRow = [...row];
    nextRow[0] = String(index + 1);
    return nextRow;
  });
}

function buildDateRange(input: Pick<LiveSessionMasterSyncInput, "from" | "to" | "weekStartKey">) {
  if (input.weekStartKey) {
    if (!isValidScheduleDateKey(input.weekStartKey)) {
      throw new Error("weekStartKey không hợp lệ.");
    }
    const weekStartKey = getScheduleWeekStartKey(input.weekStartKey);
    const weekDates = getScheduleWeekDateKeys(weekStartKey);
    const weekEndKey = weekDates[weekDates.length - 1];
    return { from: weekStartKey, to: weekEndKey };
  }

  const from = normalizeDateKey(input.from);
  const to = normalizeDateKey(input.to);
  if (from && !isValidScheduleDateKey(from)) throw new Error("Ngày bắt đầu sync không hợp lệ.");
  if (to && !isValidScheduleDateKey(to)) throw new Error("Ngày kết thúc sync không hợp lệ.");
  if (from && to && from > to) throw new Error("Khoảng ngày sync không hợp lệ.");
  return { from, to };
}

function isRowInsideRange(row: string[], from?: string, to?: string) {
  if (!from && !to) return true;
  const dateKey = parseSheetDateToKey(row[2] || "");
  if (!dateKey) return false;
  if (from && dateKey < from) return false;
  if (to && dateKey > to) return false;
  return true;
}

function scheduleSessionToRow(session: ScheduleSession, index: number): string[] {
  return [
    String(index + 1),
    normalizeText(session.weekday),
    formatDateKey(session.dateKey),
    normalizeText(session.slot),
    normalizeText(session.hostId),
    normalizeText(session.hostName),
    normalizeText(session.format),
    normalizeText(session.supportId),
    normalizeText(session.supportName),
    normalizeText(session.channel),
    normalizeText(session.scriptUrl),
    normalizeText(getScheduleSessionCode(session)),
    normalizeText(session.hostConfirm),
    normalizeText(session.supportConfirm),
    normalizeText(session.backupHostId),
    normalizeText(session.backupHostName),
    normalizeText(session.backupSupportId),
    normalizeText(session.backupSupportName),
    normalizeText(session.supportCandidatePool),
    "",
    ""
  ];
}

async function ensureSyncIndexes() {
  const database = await getMongoDatabase();
  await database.collection<PersistedSyncRun>(SYNC_RUNS_COLLECTION).createIndex({ syncedAt: -1 }).catch(() => undefined);
}

async function persistSyncRun(run: PersistedSyncRun) {
  await ensureSyncIndexes();
  const database = await getMongoDatabase();
  await database.collection<PersistedSyncRun>(SYNC_RUNS_COLLECTION).insertOne(run);
}

export async function syncLiveSessionMasterFromWebsite(
  input: LiveSessionMasterSyncInput
): Promise<LiveSessionMasterSyncResult> {
  const startedAt = new Date();
  const runId = randomUUID();
  const spreadsheetId = getGoogleHrMasterSpreadsheetId();
  const sheetName = normalizeText(input.targetSheetName) || getGoogleLiveSessionMasterSheetName();
  const sheets = createGoogleSheetsClient();
  const { from, to } = buildDateRange(input);

  const schedulePayload = await getScheduleFromMongo({ from, to });
  const sourceRows = [...(schedulePayload.rows || [])].sort(compareSessions);

  const sheetResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!A:U`
  });

  const values = (sheetResponse.data.values as string[][] | undefined) || [];
  const header = values[0]?.length ? values[0] : [...DEFAULT_HEADERS];
  const existingRows = values.slice(1);
  const preservedRows = existingRows.filter((row) => !isRowInsideRange(row, from, to));
  const rebuiltRows = sourceRows.map((session, index) => scheduleSessionToRow(session, index));
  const mergedRows = [...rebuiltRows, ...preservedRows].sort(compareSheetRows);
  const allRows = [header, ...renumberRows(mergedRows)];

  const quotedSheetName = sheetName.replace(/'/g, "''");
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${quotedSheetName}'!A2:U`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${quotedSheetName}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: allRows
    }
  });

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))"
  });
  const sheetId = metadata.data.sheets?.find((sheet) => sheet.properties?.title === sheetName)?.properties?.sheetId;
  if (sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: {
                  frozenRowCount: 1,
                  frozenColumnCount: 9
                }
              },
              fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"
            }
          }
        ]
      }
    });
  }

  const syncedAt = new Date().toISOString();
  const result: LiveSessionMasterSyncResult = {
    success: true,
    runId,
    spreadsheetId,
    sheetName,
    sheetUrl: sheetId !== undefined
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`
      : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    from,
    to,
    rowCount: sourceRows.length,
    replacedRows: existingRows.length - preservedRows.length,
    preservedRows: preservedRows.length,
    syncedAt,
    message: from || to
      ? `Đã refresh ${sourceRows.length} ca từ website lên tab ${sheetName} trong phạm vi ${from || "..."} -> ${to || "..."}.`
      : `Đã refresh toàn bộ ${sourceRows.length} ca từ website lên tab ${sheetName}.`
  };

  await persistSyncRun({
    ...result,
    requestedBy: normalizeText(input.actorAccountKey) || "admin:admin",
    startedAt: startedAt.toISOString(),
    mode: from || to ? "refresh_range" : "full_refresh"
  });

  return result;
}
