#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { parseTikTokReport } from "../lib/payrollImport.ts";

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

function parseArgs(argv) {
  const readValue = (name) => {
    const prefix = `${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : "";
  };
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    file: readValue("--file"),
    actor: readValue("--actor") || "admin:admin"
  };
}

function printHelp() {
  console.log(`import-tiktok-live-report-file

Usage:
  node --experimental-strip-types scripts/import-tiktok-live-report-file.mjs --file="C:\\path\\Transaction_Analysis_Live_List_20260808-20260817.xlsx"
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
  const buffer = fs.readFileSync(filePath);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const parsed = await parseTikTokReport(buffer, fileName);
  const parsedDateKeys = parsed.rows.map((row) => row.dateKey).sort();
  const parsedDateFrom = parsedDateKeys[0];
  const parsedDateTo = parsedDateKeys[parsedDateKeys.length - 1];

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const database = client.db(process.env.MONGODB_DB || "hr_streaming");
    const reports = database.collection("tiktok_live_reports");
    const imports = database.collection("tiktok_report_imports");

    const previous = await imports.findOne({ checksum });
    if (previous) {
      await Promise.all([
        reports.deleteMany({
          $or: [
            { lastImportBatchId: previous.batchId },
            { sourceFileName: previous.fileName }
          ]
        }),
        imports.deleteOne({ batchId: previous.batchId })
      ]);
    }

    const batchId = randomUUID();
    const importedAt = new Date();
    const bulkResult = await reports.bulkWrite(parsed.rows.map((row) => ({
      updateOne: {
        filter: { fragmentKey: row.fragmentKey },
        update: {
          $set: {
            ...row,
            lastImportedAt: importedAt,
            lastImportBatchId: batchId,
            sourceFileName: fileName,
            importedBy: args.actor
          },
          $setOnInsert: { firstImportedAt: importedAt }
        },
        upsert: true
      }
    })), { ordered: false });

    await imports.insertOne({
      batchId,
      checksum,
      fileName,
      importedAt,
      importedBy: args.actor,
      totalRows: parsed.rows.length,
      inserted: bulkResult.upsertedCount,
      duplicates: parsed.rows.length - bulkResult.upsertedCount,
      invalidRows: parsed.invalidRows,
      dateFrom: parsedDateFrom,
      dateTo: parsedDateTo
    });

    console.log(JSON.stringify({
      success: true,
      fileName,
      totalRows: parsed.rows.length,
      invalidRows: parsed.invalidRows,
      dateFrom: parsedDateFrom,
      dateTo: parsedDateTo,
      inserted: bulkResult.upsertedCount,
      duplicates: parsed.rows.length - bulkResult.upsertedCount
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
