#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CURRENT_OFFER_HEADER,
  EMPLOYEE_ID_HEADER,
  buildOfferProposal,
  buildSummary,
  normalizeText,
  rowToObject
} from "./proposal-engine.mjs";
import {
  buildLocalProgramEnv,
  loadLocalProgramEnv,
  saveState
} from "./runtime.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  const readValue = (name, fallback = "") => {
    const prefix = `${name}=`;
    const match = argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
  };

  return {
    help: flags.has("--help") || flags.has("-h"),
    apply: flags.has("--apply"),
    allowOverwrite: flags.has("--allow-overwrite"),
    includeFilled: flags.has("--include-filled"),
    employeeId: readValue("--employee-id").toUpperCase(),
    rowNumber: Number(readValue("--row-number")) || undefined,
    limit: Number(readValue("--limit")) || undefined
  };
}

function printHelp() {
  console.log(`host-offer-sync

Usage:
  node local_programs/host_offer_sync/sync-host-offers.mjs [--employee-id=HRLT25] [--row-number=18] [--include-filled] [--limit=20]
  node local_programs/host_offer_sync/sync-host-offers.mjs --employee-id=HRLT25 --apply
  node local_programs/host_offer_sync/sync-host-offers.mjs --employee-id=HRLT25 --apply --allow-overwrite

Flags:
  --employee-id=ID     Chỉ xử lý 1 host theo mã nhân viên.
  --row-number=NUM     Chỉ xử lý 1 dòng cụ thể trên sheet.
  --include-filled     Khi chạy theo lô, lấy cả dòng đã có cột H.
  --limit=NUM          Giới hạn số dòng khi chạy theo lô.
  --apply              Ghi cột H thật.
  --allow-overwrite    Cho phép ghi đè cột H nếu đang có giá trị khác.
  --help               Hiển thị trợ giúp.

Mặc định:
  - Program chỉ dry-run.
  - Khi không chỉ định row hay employee, program chỉ quét các dòng đang trống cột H.
  - Program chỉ auto-sync cho lane company-account.
  - Row personal-account hoặc mixed sẽ trả về hold và chuyển sang skill hr-offer-eval.
`);
}

function cleanGwsText(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !line.startsWith("Using keyring backend"))
    .join("\n")
    .trim();
}

async function runGwsJson(gwsPath, args) {
  const { stdout, stderr } = await execFileAsync(gwsPath, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  }).catch((error) => {
    throw new Error(cleanGwsText(error.stderr || error.stdout || error.message));
  });

  const output = cleanGwsText(stdout || stderr);
  return output ? JSON.parse(output) : {};
}

async function getSheetValues(config) {
  const payload = await runGwsJson(config.gwsPath, [
    "sheets",
    "spreadsheets",
    "values",
    "get",
    "--params",
    JSON.stringify({
      spreadsheetId: config.spreadsheetId,
      range: config.rangeA1
    }, null, 0)
  ]);
  return payload.values || [];
}

async function updateCell(config, rangeA1, value) {
  return runGwsJson(config.gwsPath, [
    "sheets",
    "spreadsheets",
    "values",
    "update",
    "--params",
    JSON.stringify({
      spreadsheetId: config.spreadsheetId,
      range: rangeA1,
      valueInputOption: "USER_ENTERED"
    }, null, 0),
    "--json",
    JSON.stringify({
      majorDimension: "ROWS",
      values: [[value]]
    }, null, 0)
  ]);
}

function resolveRows(rows, args, config) {
  if (!rows.length) throw new Error("Sheet không có dữ liệu.");
  const headers = rows[0];
  const dataRows = rows.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    row,
    candidate: rowToObject(headers, row)
  }));

  if (args.rowNumber) {
    const match = dataRows.find((item) => item.rowNumber === args.rowNumber);
    if (!match) throw new Error(`Không tìm thấy row ${args.rowNumber} trong range đã đọc.`);
    return { headers, selectedRows: [match] };
  }

  if (args.employeeId) {
    const match = dataRows.filter((item) => normalizeText(item.candidate[EMPLOYEE_ID_HEADER]).toUpperCase() === args.employeeId);
    if (match.length === 0) throw new Error(`Không tìm thấy employeeId ${args.employeeId}.`);
    if (match.length > 1) throw new Error(`employeeId ${args.employeeId} xuất hiện nhiều hơn 1 dòng.`);
    return { headers, selectedRows: match };
  }

  const selectedRows = dataRows
    .filter((item) => normalizeText(item.candidate[EMPLOYEE_ID_HEADER]))
    .filter((item) => args.includeFilled || !normalizeText(item.candidate[CURRENT_OFFER_HEADER]))
    .slice(0, args.limit || config.batchLimit);

  return { headers, selectedRows };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  loadLocalProgramEnv();
  const config = buildLocalProgramEnv();
  const values = await getSheetValues(config);
  const { headers, selectedRows } = resolveRows(values, args, config);
  const results = selectedRows.map((item) => buildOfferProposal({
    headers,
    row: item.row,
    rowNumber: item.rowNumber,
    tabName: config.tabName
  }));

  if (args.apply) {
    for (const item of results) {
      if (item.status !== "ready") continue;
      if (item.currentValue === item.proposedValue) {
        item.status = "skipped";
        item.notes.push("Bỏ qua vì cột H hiện đã khớp.");
        continue;
      }
      if (item.currentValue && !args.allowOverwrite) {
        item.status = "skipped";
        item.notes.push("Bỏ qua vì cột H đang có giá trị khác; cần --allow-overwrite để ghi đè.");
        continue;
      }

      const response = await updateCell(config, item.targetRange, item.proposedValue);
      item.status = "applied";
      item.response = response;
      item.notes.push("Đã ghi cột H thành công.");
    }
  }

  const output = {
    success: true,
    mode: args.apply ? "apply" : "dry-run",
    spreadsheetId: config.spreadsheetId,
    tabName: config.tabName,
    selectedRows: selectedRows.length,
    summary: buildSummary(results),
    results
  };

  saveState(config.statePath, {
    ...output,
    generatedAt: new Date().toISOString(),
    args: {
      apply: args.apply,
      allowOverwrite: args.allowOverwrite,
      includeFilled: args.includeFilled,
      employeeId: args.employeeId || "",
      rowNumber: args.rowNumber || null,
      limit: args.limit || null
    }
  });

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
