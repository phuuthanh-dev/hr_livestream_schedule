#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { google } from "googleapis";
import { MongoClient } from "mongodb";

const DEFAULT_SPREADSHEET_ID = process.env.GOOGLE_HR_MASTER_SPREADSHEET_ID?.trim()
  || "1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw";
const DEFAULT_SHEET_NAME = process.env.GOOGLE_TIKTOK_SALES_IMPORT_SHEET_NAME?.trim()
  || "TikTok_Sales_Import";
const HEADERS = [
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
];

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function parseDateKey(value, label) {
  const dateKey = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`${label} không hợp lệ. Dùng YYYY-MM-DD.`);
  }
  return dateKey;
}

function parseArgs(argv) {
  const readValue = (name) => {
    const prefix = `${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : "";
  };
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    from: readValue("--from"),
    to: readValue("--to"),
    spreadsheetId: readValue("--spreadsheet-id") || DEFAULT_SPREADSHEET_ID,
    sheetName: readValue("--sheet-name") || DEFAULT_SHEET_NAME
  };
}

function printHelp() {
  console.log(`sync-tiktok-sales-import

Usage:
  node scripts/sync-tiktok-sales-import.mjs --from=2026-08-08 --to=2026-08-16
  node scripts/sync-tiktok-sales-import.mjs --from=2026-08-08 --to=2026-08-16 --sheet-name=TikTok_Sales_Import
`);
}

function createSheetsClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim() || process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY?.trim() || process.env.GOOGLE_SHEETS_PRIVATE_KEY?.trim();
  if (!clientEmail || !privateKeyRaw) {
    throw new Error("Thiếu GOOGLE_SHEETS_CLIENT_EMAIL hoặc GOOGLE_SHEETS_PRIVATE_KEY.");
  }
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKeyRaw.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

function formatDateTimeBangkok(value) {
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
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${read("day")}/${read("month")}/${read("year")} ${read("hour")}:${read("minute")}`;
}

function parseSheetDateTimeToDateKey(value) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeSourcePeriod(fileName) {
  return normalizeText(fileName).replace(/\.(xlsx|csv)$/i, "");
}

function compareReports(a, b) {
  const aTime = a.startAt instanceof Date ? a.startAt.getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.startAt instanceof Date ? b.startAt.getTime() : Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return normalizeText(a.sessionId).localeCompare(normalizeText(b.sessionId));
}

function normalizeAccount(value) {
  return normalizeText(value).toLowerCase().replace(/^@/, "");
}

function parseSlotRange(dateKey, slot) {
  const match = normalizeText(slot).match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!match) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  let endMinutes = Number(match[3]) * 60 + Number(match[4]);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const base = Date.UTC(year, month - 1, day, -7, 0, 0, 0);
  return {
    startAt: new Date(base + startMinutes * 60_000),
    endAt: new Date(base + endMinutes * 60_000)
  };
}

function overlapMilliseconds(left, right) {
  return Math.max(0, Math.min(left.endAt.getTime(), right.endAt.getTime()) - Math.max(left.startAt.getTime(), right.startAt.getTime()));
}

function mapReportsToSessions(reports, sessions) {
  const sessionRanges = sessions
    .map((session) => {
      const range = parseSlotRange(session.dateKey, session.slot);
      if (!range || !session.channel) return null;
      return { session, ...range };
    })
    .filter(Boolean);

  return reports.map((report) => {
    const candidates = sessionRanges
      .filter(({ session }) => session.dateKey === report.dateKey && normalizeAccount(session.channel) === normalizeAccount(report.accountId))
      .map((candidate) => ({
        ...candidate,
        overlap: overlapMilliseconds(
          { startAt: report.startAt, endAt: report.endAt },
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

function mergeCreatorFallback(reports, fallbackDocuments) {
  return reports.map((report) => {
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

function buildRow(report) {
  return [
    normalizeText(report.matchedSessionId || report.sessionId),
    normalizeText(report.tiktokLiveId),
    normalizeText(report.accountId),
    formatDateTimeBangkok(report.startAt),
    formatDateTimeBangkok(report.endAt),
    report.returnedGmv ?? 0,
    report.grossOrders ?? 0,
    report.grossGmv ?? 0,
    normalizeSourcePeriod(report.sourceFileName),
    normalizeText(report.matchedNote) || "Synced from application",
    normalizeText(report.matchedHostId || report.hostId),
    normalizeText(report.matchedSupportId || report.supportId),
    normalizeText(report.title),
    report.itemsSold ?? "",
    report.aov ?? "",
    normalizeText(report.avgViewDuration),
    report.likes ?? "",
    report.comments ?? "",
    report.shares ?? "",
    report.productImpressions ?? "",
    report.productClicks ?? "",
    report.impressions ?? "",
    normalizeText(report.showGpm),
    normalizeText(report.engagement),
    normalizeText(report.ctr),
    normalizeText(report.tapThroughRate),
    report.estimatedCommission ?? ""
  ];
}

async function main() {
  loadDotEnv(path.resolve(".env"));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const from = parseDateKey(args.from, "Ngày bắt đầu sync");
  const to = parseDateKey(args.to, "Ngày kết thúc sync");
  if (from > to) throw new Error("Khoảng ngày sync không hợp lệ.");
  if (!process.env.MONGODB_URI) throw new Error("Thiếu MONGODB_URI.");

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const database = client.db(process.env.MONGODB_DB || "hr_streaming");
    const reports = await database.collection("tiktok_live_reports")
      .find({ dateKey: { $gte: from, $lte: to } })
      .toArray();
    reports.sort(compareReports);
    const creatorFallbacks = await database.collection("tiktok_creator_period_fallbacks")
      .find({ from: { $lte: to }, to: { $gte: from } })
      .toArray();
    const sessions = await database.collection("schedule_sessions")
      .find({ active: true, dateKey: { $gte: from, $lte: to } })
      .toArray();
    const enrichedReports = mergeCreatorFallback(mapReportsToSessions(reports, sessions), creatorFallbacks);

    const sheets = createSheetsClient();
    const quotedSheetName = args.sheetName.replace(/'/g, "''");
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: args.spreadsheetId,
      range: `'${quotedSheetName}'!A:AA`,
      valueRenderOption: "FORMATTED_VALUE"
    });
    const currentRows = current.data.values || [];
    const header = currentRows[0]?.length ? currentRows[0] : HEADERS;
    const preservedRows = currentRows.slice(1).filter((row) => {
      const dateKey = parseSheetDateTimeToDateKey(row[3]);
      return !dateKey || dateKey < from || dateKey > to;
    });
    const syncedRows = enrichedReports.map(buildRow);
    const allRows = [header, ...preservedRows, ...syncedRows];

    await sheets.spreadsheets.values.clear({
      spreadsheetId: args.spreadsheetId,
      range: `'${quotedSheetName}'!A2:AA`
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: args.spreadsheetId,
      range: `'${quotedSheetName}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: allRows }
    });

    console.log(JSON.stringify({
      success: true,
      spreadsheetId: args.spreadsheetId,
      sheetName: args.sheetName,
      from,
      to,
      syncedRows: syncedRows.length,
      preservedRows: preservedRows.length
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
