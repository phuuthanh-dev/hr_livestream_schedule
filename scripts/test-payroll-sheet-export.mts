// Test nhanh pipeline payroll → Google Sheet export (dry-run + tính lương tuần trước).
// Chạy: npx tsx scripts/test-payroll-sheet-export.mts [weekStartKey]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
for (const envFile of [".env", ".env.local"]) {
  try {
    const content = readFileSync(resolve(root, envFile), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      if (process.env[key] != null) continue;
      process.env[key] = trimmed.slice(separator + 1).trim();
    }
  } catch {
    // bỏ qua nếu không có file env
  }
}

const weekStartKey = process.argv[2] || "2026-08-10";
const { generatePayrollWeek, getPayrollDashboard } = await import("../lib/payrollStore.ts");
const { exportPayrollWeekToSheet, buildPayrollSheetRows } = await import("../lib/payrollSheetExport.ts");

console.log("== Tuần test:", weekStartKey);

let dashboard = await getPayrollDashboard(weekStartKey);
if (!dashboard.entries || dashboard.entries.length === 0) {
  console.log("== Tuần chưa tính → generatePayrollWeek...");
  dashboard = await generatePayrollWeek(weekStartKey, "local-test");
}

console.log("== Period:", dashboard.periodStatus, "| generatedAt:", dashboard.generatedAt);
console.log("== Summary:", JSON.stringify(dashboard.summary, null, 2));
console.log("== Entries:", dashboard.entries?.length, "| Persons:", dashboard.personHours?.length, "| Exceptions:", dashboard.exceptions?.length);
(dashboard.exceptions || []).forEach((exception) => {
  console.log(`   [${exception.type}] ${exception.dateKey} — ${exception.message}`);
});
console.log("== PersonHours:");
(dashboard.personHours || []).forEach((person) => {
  console.log(`   ${person.role.toUpperCase()} ${person.employeeId} ${person.employeeName} (${person.grade}) — ${person.sessionCount} ca, ${person.scheduledHours}h, net ${person.netPay}`);
});

const sampleRows = buildPayrollSheetRows((dashboard.entries || []).slice(0, 3), dashboard.exceptions || []);
console.log("== Mẫu 3 dòng sheet:");
sampleRows.forEach((row) => console.log("  ", JSON.stringify(row)));

console.log("== exportPayrollWeekToSheet (dryRun)...");
const result = await exportPayrollWeekToSheet(weekStartKey, "local-test", { dryRun: true });
console.log("== Result:", JSON.stringify({ message: result.message, rowCount: result.rowCount, totals: result.totals, verification: result.verification, reconciliation: result.reconciliation }, null, 2));

process.exit(0);
