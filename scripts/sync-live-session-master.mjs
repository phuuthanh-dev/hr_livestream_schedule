#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { google } from "googleapis";
import { MongoClient } from "mongodb";

const DEFAULT_SPREADSHEET_ID = process.env.GOOGLE_HR_MASTER_SPREADSHEET_ID?.trim()
  || "1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw";
const DEFAULT_SHEET_NAME = process.env.GOOGLE_LIVE_SESSION_MASTER_SHEET_NAME?.trim()
  || "Live_Session_Master";
const HEADERS = [
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
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const readValue = (name) => {
    const prefix = `${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : "";
  };
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    sheetName: readValue("--sheet-name") || DEFAULT_SHEET_NAME,
    spreadsheetId: readValue("--spreadsheet-id") || DEFAULT_SPREADSHEET_ID,
    from: readValue("--from"),
    to: readValue("--to")
  };
}

function printHelp() {
  console.log(`sync-live-session-master

Usage:
  node scripts/sync-live-session-master.mjs [--sheet-name=Live_Session_Master_WebSync_Test]
  node scripts/sync-live-session-master.mjs --from=2026-08-17 --to=2026-08-23 --sheet-name=Live_Session_Master_WebSync_Test

Notes:
  - Reads active rows from MongoDB collection schedule_sessions
  - Refreshes target sheet from website runtime data
  - Preserves rows outside the date range if --from / --to are provided
`);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function parseDateKey(value) {
  const trimmed = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function formatDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function parseSheetDateToKey(value) {
  const trimmed = normalizeText(value);
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function slotSortValue(slot) {
  const match = normalizeText(slot).match(/^(\d{2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compareSessions(a, b) {
  if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
  const slotDiff = slotSortValue(a.slot) - slotSortValue(b.slot);
  if (slotDiff !== 0) return slotDiff;
  return normalizeText(a.sessionId).localeCompare(normalizeText(b.sessionId));
}

function compareSheetRows(left, right) {
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

function renumberRows(rows) {
  return rows.map((row, index) => {
    const nextRow = [...row];
    nextRow[0] = String(index + 1);
    return nextRow;
  });
}

function isRowInsideRange(row, from, to) {
  if (!from && !to) return true;
  const dateKey = parseSheetDateToKey(row[2] || "");
  if (!dateKey) return false;
  if (from && dateKey < from) return false;
  if (to && dateKey > to) return false;
  return true;
}

function buildRow(session, index) {
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
    normalizeText(session.sessionId),
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

async function main() {
  loadDotEnv(path.resolve(".env"));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const mongoUri = process.env.MONGODB_URI;
  const mongoDb = process.env.MONGODB_DB || "hr_streaming";
  if (!mongoUri) {
    throw new Error("Thiếu MONGODB_URI.");
  }

  const from = parseDateKey(args.from);
  const to = parseDateKey(args.to);
  if (args.from && !from) throw new Error("Giá trị --from không hợp lệ. Dùng YYYY-MM-DD.");
  if (args.to && !to) throw new Error("Giá trị --to không hợp lệ. Dùng YYYY-MM-DD.");
  if (from && to && from > to) throw new Error("Khoảng ngày sync không hợp lệ.");

  const client = new MongoClient(mongoUri, { maxPoolSize: 4, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const database = client.db(mongoDb);
    const query = {
      active: true,
      ...(from || to ? { dateKey: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {})
    };
    const sessions = await database
      .collection("schedule_sessions")
      .find(query, {
        projection: {
          weekday: 1,
          dateKey: 1,
          slot: 1,
          hostId: 1,
          hostName: 1,
          format: 1,
          supportId: 1,
          supportName: 1,
          channel: 1,
          scriptUrl: 1,
          sessionId: 1,
          hostConfirm: 1,
          supportConfirm: 1,
          backupHostId: 1,
          backupHostName: 1,
          backupSupportId: 1,
          backupSupportName: 1,
          supportCandidatePool: 1
        }
      })
      .toArray();

    sessions.sort(compareSessions);
    const builtRows = sessions.map((session, index) => buildRow(session, index));

    const sheets = createSheetsClient();
    const quotedName = args.sheetName.replace(/'/g, "''");
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: args.spreadsheetId,
      range: `'${quotedName}'!A:U`
    });
    const values = current.data.values || [];
    const header = values[0]?.length ? values[0] : HEADERS;
    const existingRows = values.slice(1);
    const preservedRows = existingRows.filter((row) => !isRowInsideRange(row, from, to));
    const mergedRows = [...builtRows, ...preservedRows].sort(compareSheetRows);
    const allRows = [header, ...renumberRows(mergedRows)];

    await sheets.spreadsheets.values.clear({
      spreadsheetId: args.spreadsheetId,
      range: `'${quotedName}'!A2:U`
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: args.spreadsheetId,
      range: `'${quotedName}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: allRows }
    });

    console.log(JSON.stringify({
      success: true,
      spreadsheetId: args.spreadsheetId,
      sheetName: args.sheetName,
      from: from || null,
      to: to || null,
      syncedRows: builtRows.length,
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
