import { randomUUID } from "node:crypto";
import { createGoogleSheetsClient, getGoogleHrMasterSpreadsheetId, getGoogleTikTokSalesImportSheetName } from "@/lib/googleSheets";
import { getMongoDatabase } from "@/lib/mongodb";
import { parseSlotRange } from "@/lib/payrollEngine";
import type { ScheduleSession } from "@/lib/types";

const TIKTOK_SALES_IMPORT_HEADERS = [
  "Session_ID",
  "TikTok_Live_ID",
  "Account_ID",
  "Start_Time",
  "End_Time",
  "Returned_GMV",
  "Gross_Orders",
  "Gross_GMV",
  "Source_Period",
  "Note",
  "Host_ID",
  "Support_ID",
  "Live_Title",
  "Items_Sold",
  "AOV",
  "Avg_View_Duration",
  "Likes",
  "Comments",
  "Shares",
  "Product_Impressions",
  "Product_Clicks",
  "Impressions",
  "Show_GPM",
  "Engagement",
  "CTR",
  "Tap_Through_Rate",
  "Estimated_Commission"
] as const;

type TikTokLiveReportDocument = {
  sessionId?: string;
  tiktokLiveId?: string;
  accountId?: string;
  startAt?: Date;
  endAt?: Date;
  dateKey?: string;
  returnedGmv?: number;
  grossOrders?: number;
  grossGmv?: number;
  sourceFileName?: string;
  title?: string;
  hostId?: string;
  supportId?: string;
  note?: string;
  itemsSold?: number;
  aov?: number;
  avgViewDuration?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  productImpressions?: number;
  productClicks?: number;
  impressions?: number;
  showGpm?: string;
  engagement?: string;
  ctr?: string;
  tapThroughRate?: string;
  estimatedCommission?: number;
};

type EnrichedTikTokLiveReport = TikTokLiveReportDocument & {
  matchedSessionId?: string;
  matchedHostId?: string;
  matchedSupportId?: string;
  matchedNote?: string;
};

type TikTokCreatorFallbackDocument = {
  accountId: string;
  from: string;
  to: string;
  itemsSold?: number;
  aov?: number;
  productImpressions?: number;
  ctr?: string;
  estimatedCommission?: number;
};

export type TikTokSalesImportSheetSyncResult = {
  success: boolean;
  runId: string;
  spreadsheetId: string;
  sheetName: string;
  from: string;
  to: string;
  syncedRows: number;
  preservedRows: number;
  message: string;
  syncedAt: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function assertDateKey(value: string | undefined, label: string) {
  const dateKey = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`${label} không hợp lệ. Dùng YYYY-MM-DD.`);
  }
  return dateKey;
}

function parseSheetDateTimeToDateKey(value: unknown) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function formatDateTimeBangkok(value?: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${read("day")}/${read("month")}/${read("year")} ${read("hour")}:${read("minute")}`;
}

function normalizeSourcePeriod(fileName?: string) {
  const text = normalizeText(fileName);
  return text.replace(/\.(xlsx|csv)$/i, "");
}

function compareReports(a: TikTokLiveReportDocument, b: TikTokLiveReportDocument) {
  const aTime = a.startAt instanceof Date ? a.startAt.getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.startAt instanceof Date ? b.startAt.getTime() : Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return normalizeText(a.sessionId).localeCompare(normalizeText(b.sessionId));
}

function normalizeAccount(value: string | undefined) {
  return normalizeText(value).toLowerCase().replace(/^@/, "");
}

function overlapMilliseconds(
  left: { startAt: Date; endAt: Date },
  right: { startAt: Date; endAt: Date }
) {
  return Math.max(0, Math.min(left.endAt.getTime(), right.endAt.getTime()) - Math.max(left.startAt.getTime(), right.startAt.getTime()));
}

function mapReportsToSessions(reports: TikTokLiveReportDocument[], sessions: ScheduleSession[]) {
  const sessionRanges = new Map<string, { session: ScheduleSession; startAt: Date; endAt: Date }>();
  sessions.forEach((session) => {
    const range = parseSlotRange(session.dateKey, session.slot);
    if (!range || !session.channel) return;
    sessionRanges.set(session.sessionId, { session, startAt: range.startAt, endAt: range.endAt });
  });

  return reports.map<EnrichedTikTokLiveReport>((report) => {
    if (!(report.startAt instanceof Date) || !(report.endAt instanceof Date)) return report;
    const candidates = Array.from(sessionRanges.values())
      .filter(({ session }) => session.dateKey === report.dateKey && normalizeAccount(session.channel) === normalizeAccount(report.accountId))
      .map((candidate) => ({
        ...candidate,
        overlap: overlapMilliseconds(
          { startAt: report.startAt as Date, endAt: report.endAt as Date },
          { startAt: candidate.startAt, endAt: candidate.endAt }
        )
      }))
      .filter((candidate) => candidate.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap);

    const best = candidates[0];
    if (!best) {
      return {
        ...report,
        matchedNote: normalizeText(report.note) || "Synced from application | No schedule match"
      };
    }

    return {
      ...report,
      matchedSessionId: best.session.sessionId,
      matchedHostId: best.session.hostId,
      matchedSupportId: best.session.supportId,
      matchedNote: normalizeText(report.note) || "Synced from application | Auto matched from schedule"
    };
  });
}

function mergeCreatorFallback(
  reports: EnrichedTikTokLiveReport[],
  fallbackDocuments: TikTokCreatorFallbackDocument[]
) {
  return reports.map<EnrichedTikTokLiveReport>((report) => {
    const fallback = fallbackDocuments.find((document) =>
      normalizeAccount(document.accountId) === normalizeAccount(report.accountId)
      && normalizeText(report.dateKey) >= document.from
      && normalizeText(report.dateKey) <= document.to
    );
    if (!fallback) return report;
    return {
      ...report,
      itemsSold: report.itemsSold ?? fallback.itemsSold,
      aov: report.aov ?? fallback.aov,
      productImpressions: report.productImpressions ?? fallback.productImpressions,
      ctr: report.ctr || fallback.ctr,
      estimatedCommission: report.estimatedCommission ?? fallback.estimatedCommission,
      matchedNote: report.matchedNote || normalizeText(report.note) || "Synced from application | Creator aggregate fallback"
    };
  });
}

function buildSheetRow(document: EnrichedTikTokLiveReport) {
  return [
    normalizeText(document.matchedSessionId || document.sessionId),
    normalizeText(document.tiktokLiveId),
    normalizeText(document.accountId),
    formatDateTimeBangkok(document.startAt),
    formatDateTimeBangkok(document.endAt),
    document.returnedGmv ?? 0,
    document.grossOrders ?? 0,
    document.grossGmv ?? 0,
    normalizeSourcePeriod(document.sourceFileName),
    normalizeText(document.matchedNote) || "Synced from application",
    normalizeText(document.matchedHostId || document.hostId),
    normalizeText(document.matchedSupportId || document.supportId),
    normalizeText(document.title),
    document.itemsSold ?? "",
    document.aov ?? "",
    normalizeText(document.avgViewDuration),
    document.likes ?? "",
    document.comments ?? "",
    document.shares ?? "",
    document.productImpressions ?? "",
    document.productClicks ?? "",
    document.impressions ?? "",
    normalizeText(document.showGpm),
    normalizeText(document.engagement),
    normalizeText(document.ctr),
    normalizeText(document.tapThroughRate),
    document.estimatedCommission ?? ""
  ] as Array<string | number>;
}

async function getSyncCollection() {
  const database = await getMongoDatabase();
  const collection = database.collection("tiktok_sales_sheet_sync_runs");
  await collection.createIndex({ syncedAt: -1 }).catch(() => undefined);
  return collection;
}

export async function syncTikTokSalesImportSheet(input: {
  actorAccountKey: string;
  from: string;
  to: string;
  spreadsheetId?: string;
  sheetName?: string;
}) {
  const from = assertDateKey(input.from, "Ngày bắt đầu sync");
  const to = assertDateKey(input.to, "Ngày kết thúc sync");
  if (from > to) {
    throw new Error("Khoảng ngày sync TikTok_Sales_Import không hợp lệ.");
  }

  const spreadsheetId = normalizeText(input.spreadsheetId) || getGoogleHrMasterSpreadsheetId();
  const sheetName = normalizeText(input.sheetName) || getGoogleTikTokSalesImportSheetName();
  const quotedSheetName = sheetName.replace(/'/g, "''");

  const database = await getMongoDatabase();
  const reports = (await database.collection<TikTokLiveReportDocument>("tiktok_live_reports")
    .find({ dateKey: { $gte: from, $lte: to } })
    .toArray())
    .sort(compareReports);
  const creatorFallbacks = await database.collection<TikTokCreatorFallbackDocument>("tiktok_creator_period_fallbacks")
    .find({ from: { $lte: to }, to: { $gte: from } })
    .toArray();
  const sessions = await database.collection<ScheduleSession>("schedule_sessions")
    .find({
      active: true,
      dateKey: { $gte: from, $lte: to }
    })
    .toArray();
  const enrichedReports = mergeCreatorFallback(mapReportsToSessions(reports, sessions), creatorFallbacks);

  const sheets = createGoogleSheetsClient();
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${quotedSheetName}'!A:AA`,
    valueRenderOption: "FORMATTED_VALUE"
  });
  const currentRows = current.data.values || [];
  const header = currentRows[0]?.length ? currentRows[0] : Array.from(TIKTOK_SALES_IMPORT_HEADERS);
  const existingRows = currentRows.slice(1);
  const preservedRows = existingRows.filter((row) => {
    const rowDateKey = parseSheetDateTimeToDateKey(row[3]);
    return !rowDateKey || rowDateKey < from || rowDateKey > to;
  });
  const syncedRows = enrichedReports.map(buildSheetRow);
  const allRows = [header, ...preservedRows, ...syncedRows];

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${quotedSheetName}'!A2:AA`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${quotedSheetName}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: allRows }
  });

  const syncedAt = new Date().toISOString();
  const runId = randomUUID();
  const result: TikTokSalesImportSheetSyncResult = {
    success: true,
    runId,
    spreadsheetId,
    sheetName,
    from,
    to,
    syncedRows: syncedRows.length,
    preservedRows: preservedRows.length,
    message: `Đã sync ${syncedRows.length} dòng TikTok_Sales_Import từ app ra sheet cho khoảng ${from} → ${to}.`,
    syncedAt
  };

  const collection = await getSyncCollection();
  await collection.insertOne({
    ...result,
    actorAccountKey: input.actorAccountKey
  });

  return result;
}
