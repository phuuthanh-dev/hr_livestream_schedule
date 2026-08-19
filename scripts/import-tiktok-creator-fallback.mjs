#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MongoClient } from "mongodb";
import { readSheet } from "read-excel-file/node";

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

function parseMetricText(value) {
  return normalizeText(value);
}

function parseArgs(argv) {
  const readValue = (name) => {
    const prefix = `${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : "";
  };
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    file: readValue("--file")
  };
}

function parseDateKeyFromCompact(value) {
  if (!/^\d{8}$/.test(value)) return "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function parseRangeFromFileName(fileName) {
  const match = fileName.match(/(\d{8})-(\d{8})/);
  if (!match) throw new Error("Tên file không có khoảng ngày YYYYMMDD-YYYYMMDD.");
  const from = parseDateKeyFromCompact(match[1]);
  const to = parseDateKeyFromCompact(match[2]);
  if (!from || !to) throw new Error("Không đọc được khoảng ngày từ tên file.");
  return { from, to };
}

function printHelp() {
  console.log(`import-tiktok-creator-fallback

Usage:
  node scripts/import-tiktok-creator-fallback.mjs --file=\"C:\\path\\Transaction_Analysis_Creator_List_20260808-20260817.xlsx\"
`);
}

async function main() {
  loadDotEnv(path.resolve(".env"));
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    printHelp();
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error("Thiếu MONGODB_URI.");

  const filePath = path.resolve(args.file);
  const fileName = path.basename(filePath);
  const { from, to } = parseRangeFromFileName(fileName);
  const rows = await readSheet(filePath);
  if (!rows.length) throw new Error("File creator list đang trống.");

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
  if (columns.accountId < 0) throw new Error("Không tìm thấy cột account trong Creator List.");

  const documents = rows.slice(2)
    .map((row) => ({
      accountId: normalizeText(row[columns.accountId]),
      from,
      to,
      itemsSold: columns.itemsSold >= 0 ? parseCount(row[columns.itemsSold]) : undefined,
      aov: columns.aov >= 0 ? parseVnd(row[columns.aov]) : undefined,
      productImpressions: columns.productImpressions >= 0 ? parseCount(row[columns.productImpressions]) : undefined,
      ctr: columns.ctr >= 0 ? parseMetricText(row[columns.ctr]) : undefined,
      estimatedCommission: columns.estimatedCommission >= 0 ? parseVnd(row[columns.estimatedCommission]) : undefined,
      sourceFileName: fileName,
      importedAt: new Date().toISOString()
    }))
    .filter((row) => row.accountId);

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const database = client.db(process.env.MONGODB_DB || "hr_streaming");
    const collection = database.collection("tiktok_creator_period_fallbacks");
    await collection.createIndex({ accountId: 1, from: 1, to: 1 }, { unique: true }).catch(() => undefined);
    if (documents.length > 0) {
      await collection.bulkWrite(documents.map((document) => ({
        updateOne: {
          filter: { accountId: document.accountId, from: document.from, to: document.to },
          update: { $set: document },
          upsert: true
        }
      })), { ordered: false });
    }
    console.log(JSON.stringify({ success: true, from, to, upserted: documents.length, fileName }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
