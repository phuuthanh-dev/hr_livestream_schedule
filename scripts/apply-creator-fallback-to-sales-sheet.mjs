#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { google } from "googleapis";
import { readSheet } from "read-excel-file/node";

const DEFAULT_SPREADSHEET_ID = process.env.GOOGLE_HR_MASTER_SPREADSHEET_ID?.trim()
  || "1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw";
const DEFAULT_SHEET_NAME = process.env.GOOGLE_TIKTOK_SALES_IMPORT_SHEET_NAME?.trim()
  || "TikTok_Sales_Import";

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
  return value == null ? "" : String(value).trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeAccount(value) {
  return normalizeText(value).toLowerCase().replace(/^@/, "");
}

function parseVnd(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const digits = normalizeText(value).replace(/[^0-9-]/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const parsed = Number(normalizeText(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function parseRangeFromFileName(fileName) {
  const match = fileName.match(/(\d{8})-(\d{8})/);
  if (!match) throw new Error("Tên file không có khoảng ngày YYYYMMDD-YYYYMMDD.");
  const toKey = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return { from: toKey(match[1]), to: toKey(match[2]) };
}

function parseArgs(argv) {
  const readValue = (name) => {
    const prefix = `${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : "";
  };
  return {
    file: readValue("--file"),
    spreadsheetId: readValue("--spreadsheet-id") || DEFAULT_SPREADSHEET_ID,
    sheetName: readValue("--sheet-name") || DEFAULT_SHEET_NAME
  };
}

function parseSheetDateKey(value) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
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
  if (!args.file) {
    throw new Error("Thiếu --file cho Creator List.");
  }

  const filePath = path.resolve(args.file);
  const fileName = path.basename(filePath);
  const { from, to } = parseRangeFromFileName(fileName);
  const rows = await readSheet(filePath);
  const headers = rows[0].map(normalizeHeader);
  const findColumn = (candidates) => headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
  const columns = {
    accountId: findColumn(["ten nha sang tao", "creator name"]),
    itemsSold: findColumn(["so mon ban ra nho nha sang tao", "items sold"]),
    aov: findColumn(["aov"]),
    productImpressions: findColumn(["luot hien thi san pham", "product impressions"]),
    ctr: findColumn(["ctr"]),
    estimatedCommission: findColumn(["hoa hong uoc tinh", "estimated commission"])
  };

  const creatorMap = new Map(
    rows.slice(2)
      .map((row) => ({
        accountId: normalizeAccount(row[columns.accountId]),
        itemsSold: columns.itemsSold >= 0 ? parseCount(row[columns.itemsSold]) : "",
        aov: columns.aov >= 0 ? parseVnd(row[columns.aov]) : "",
        productImpressions: columns.productImpressions >= 0 ? parseCount(row[columns.productImpressions]) : "",
        ctr: columns.ctr >= 0 ? normalizeText(row[columns.ctr]) : "",
        estimatedCommission: columns.estimatedCommission >= 0 ? parseVnd(row[columns.estimatedCommission]) : ""
      }))
      .filter((row) => row.accountId)
      .map((row) => [row.accountId, row])
  );

  const sheets = createSheetsClient();
  const quotedSheetName = args.sheetName.replace(/'/g, "''");
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: args.spreadsheetId,
    range: `'${quotedSheetName}'!A1:AA5000`,
    valueRenderOption: "FORMATTED_VALUE"
  });
  const values = current.data.values || [];
  const updated = values.map((row, index) => {
    if (index === 0) return row;
    const dateKey = parseSheetDateKey(row[3]);
    const accountId = normalizeAccount(row[2]);
    if (!dateKey || dateKey < from || dateKey > to) return row;
    const creator = creatorMap.get(accountId);
    if (!creator) return row;
    const next = Array.from({ length: Math.max(27, row.length) }, (_, cellIndex) => row[cellIndex] ?? "");
    next[13] = creator.itemsSold;
    next[14] = creator.aov;
    next[19] = creator.productImpressions;
    next[24] = creator.ctr;
    next[26] = creator.estimatedCommission;
    next[9] = normalizeText(next[9])
      ? `${normalizeText(next[9])} | Creator aggregate fallback`
      : "Creator aggregate fallback";
    return next;
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: args.spreadsheetId,
    range: `'${quotedSheetName}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: updated }
  });

  console.log(JSON.stringify({
    success: true,
    fileName,
    from,
    to,
    updatedRows: updated.length - 1
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
