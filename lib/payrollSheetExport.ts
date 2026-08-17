import { randomUUID } from "node:crypto";
import { getPayrollDashboard } from "@/lib/payrollStore";
import { createGoogleSheetsClient } from "@/lib/googleSheets";
import { getMongoDatabase } from "@/lib/mongodb";
import type {
  PayrollDashboardPayload,
  PayrollEntry,
  PayrollException,
  PayrollPersonHours,
  PayrollSheetExportRecord,
  PayrollSheetExportTotals
} from "@/lib/types";

export const PAYROLL_SHEET_HEADERS = [
  "Mã Ca Live (Session_ID)",
  "Ngày Live",
  "Mã Nhân Sự",
  "Họ Và Tên",
  "Vai Trò",
  "Cấp Độ / Grade",
  "Số Giờ Live",
  "Lương Giờ/h",
  "Thành Tiền Lương Cứng",
  "Doanh Thu Thuần (Eligible GMV)",
  "% Hoa Hồng",
  "Tiền Hoa Hồng",
  "Thưởng Nóng GMV/CCU",
  "TỔNG TIỀN",
  "Thuế 10%",
  "TỔNG THỰC NHẬN (VNĐ)",
  "Account Live",
  "Địa Điểm",
  "TikTok Live IDs",
  "Ghi Chú Đối Chiếu"
];

export const PAYROLL_SUMMARY_HEADERS = [
  "Mã Nhân Sự",
  "Họ Và Tên",
  "Vai Trò",
  "Cấp Độ / Grade",
  "Số Ca",
  "Tổng Giờ Live",
  "Tổng Thực Nhận (VNĐ)"
];

export type PayrollSheetExportResult = PayrollSheetExportRecord & {
  success: boolean;
  message: string;
  reconciliation: {
    entryCount: number;
    personCount: number;
    exceptionTotal: number;
    exceptionCounts: Record<string, number>;
    exceptionMessages: string[];
    notes: string[];
  };
};

const EXCEPTION_LABELS: Record<string, string> = {
  missing_report: "Thiếu báo cáo TikTok",
  unmatched_report: "Báo cáo TikTok không khớp ca",
  missing_account: "Thiếu account TikTok",
  missing_rate: "Thiếu bậc lương",
  ambiguous_assignment: "Ca chưa rõ người phụ",
  unconfirmed_shift: "Ca chưa xác nhận"
};

function getPayrollSpreadsheetId() {
  const spreadsheetId = process.env.GOOGLE_PAYROLL_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("Thiếu biến môi trường GOOGLE_PAYROLL_SPREADSHEET_ID (file Google Sheet nhận bảng lương).");
  }
  return spreadsheetId;
}

function roundMoney(value: number) {
  return Math.round(value);
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function formatDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function exceptionMatchesEntry(exception: PayrollException, entry: PayrollEntry) {
  if (exception.dateKey !== entry.dateKey) return false;
  if (exception.employeeId) return exception.employeeId === entry.employeeId;
  if (exception.sessionId && entry.sessionIds.includes(exception.sessionId)) return true;
  if (exception.accountId && exception.accountId.toLowerCase() === entry.accountId.toLowerCase()) return true;
  return false;
}

function buildExceptionNotes(entries: PayrollEntry[], exceptions: PayrollException[]) {
  return entries.map((entry) => {
    const related = exceptions.filter((exception) => exceptionMatchesEntry(exception, entry));
    if (related.length === 0) return "";
    const labels = Array.from(new Set(related.map((exception) => EXCEPTION_LABELS[exception.type] || exception.type)));
    return labels.join("; ");
  });
}

export function buildPayrollSheetRows(entries: PayrollEntry[], exceptions: PayrollException[]) {
  const notes = buildExceptionNotes(entries, exceptions);
  return entries.map((entry, index) => [
    entry.sessionIds.join(" | "),
    formatDateKey(entry.dateKey),
    entry.employeeId,
    entry.employeeName,
    entry.role === "host" ? "HOST" : "SUPPORT",
    entry.grade,
    roundHours(entry.scheduledHours),
    roundMoney(entry.hourlyRate),
    roundMoney(entry.basePay),
    roundMoney(entry.eligibleGmv),
    entry.commissionRate,
    roundMoney(entry.commissionPay),
    roundMoney(entry.adjustments),
    roundMoney(entry.grossPay),
    roundMoney(entry.taxAmount),
    roundMoney(entry.netPay),
    entry.accountId,
    entry.location === "studio" ? "Studio" : "Nhà",
    entry.tiktokLiveIds.join(" | "),
    notes[index]
  ]) as Array<Array<string | number>>;
}

export function buildPayrollSummaryRows(personHours: PayrollPersonHours[]) {
  return personHours.map((person) => [
    person.employeeId,
    person.employeeName,
    person.role === "host" ? "HOST" : "SUPPORT",
    person.grade,
    person.sessionCount,
    roundHours(person.scheduledHours),
    roundMoney(person.netPay)
  ]) as Array<Array<string | number>>;
}

function summarizeEntries(entries: PayrollEntry[]): PayrollSheetExportTotals {
  return entries.reduce(
    (totals, entry) => ({
      scheduledHours: totals.scheduledHours + entry.scheduledHours,
      basePay: totals.basePay + entry.basePay,
      commissionPay: totals.commissionPay + entry.commissionPay,
      adjustments: totals.adjustments + entry.adjustments,
      grossPay: totals.grossPay + entry.grossPay,
      taxAmount: totals.taxAmount + entry.taxAmount,
      netPay: totals.netPay + entry.netPay
    }),
    { scheduledHours: 0, basePay: 0, commissionPay: 0, adjustments: 0, grossPay: 0, taxAmount: 0, netPay: 0 }
  );
}

function buildReconciliation(dashboard: PayrollDashboardPayload) {
  const entries = dashboard.entries || [];
  const exceptions = dashboard.exceptions || [];
  const exceptionCounts: Record<string, number> = {};
  exceptions.forEach((exception) => {
    exceptionCounts[exception.type] = (exceptionCounts[exception.type] || 0) + 1;
  });
  const notes: string[] = [];
  if (exceptions.length === 0) {
    notes.push("Đối chiếu chấm công ↔ lương: không có ngoại lệ, toàn bộ ca đã khớp báo cáo TikTok.");
  } else {
    notes.push(`Đối chiếu chấm công ↔ lương: ${exceptions.length} ngoại lệ cần xem trước khi chốt lương.`);
  }
  if (dashboard.periodStatus === "locked") {
    notes.push("Tuần lương đã khóa — số liệu xuất ra là bản chốt.");
  }
  return {
    entryCount: entries.length,
    personCount: new Set(entries.map((entry) => `${entry.role}:${entry.employeeId.toLowerCase()}`)).size,
    exceptionTotal: exceptions.length,
    exceptionCounts,
    exceptionMessages: exceptions.slice(0, 20).map((exception) =>
      `${formatDateKey(exception.dateKey)} · ${EXCEPTION_LABELS[exception.type] || exception.type}: ${exception.message}`
    ),
    notes
  };
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Math.round(value * 100) / 100;
  return String(value).trim();
}

function compareWritten(expected: Array<Array<string | number>>, actual: unknown[][]) {
  let checked = 0;
  let mismatches = 0;
  expected.forEach((row, rowIndex) => {
    row.forEach((cell, cellIndex) => {
      const expectedValue = normalizeCell(cell);
      const actualValue = normalizeCell(actual[rowIndex]?.[cellIndex]);
      checked += 1;
      if (typeof expectedValue === "number" && typeof actualValue === "number") {
        if (Math.abs(expectedValue - actualValue) > 0.01) mismatches += 1;
        return;
      }
      if (String(expectedValue) !== String(actualValue)) mismatches += 1;
    });
  });
  return { checked, mismatches, ok: mismatches === 0 };
}

async function getExportCollection() {
  const database = await getMongoDatabase();
  const collection = database.collection<PayrollSheetExportRecord & { _id?: unknown }>("payroll_sheet_exports");
  await collection.createIndex({ weekStartKey: 1, exportedAt: -1 }).catch(() => undefined);
  return collection;
}

export async function getLastPayrollSheetExport(weekStartKey: string) {
  const collection = await getExportCollection();
  const document = await collection.findOne(
    { weekStartKey, dryRun: false },
    { sort: { exportedAt: -1 } }
  );
  if (!document) return null;
  const { _id: _ignored, ...record } = document;
  return record as PayrollSheetExportRecord;
}

export async function exportPayrollWeekToSheet(
  weekStartKey: string,
  actorAccountKey: string,
  options?: { dryRun?: boolean }
): Promise<PayrollSheetExportResult> {
  const dashboard = await getPayrollDashboard(weekStartKey);
  if (!dashboard.periodStatus || !dashboard.entries || dashboard.entries.length === 0) {
    throw new Error("Tuần này chưa có bảng lương — hãy bấm Tính lương tuần trước khi xuất.");
  }
  const entries = dashboard.entries;
  const exceptions = dashboard.exceptions || [];
  const personHours = dashboard.personHours || [];
  const reconciliation = buildReconciliation(dashboard);
  const totals = summarizeEntries(entries);

  const detailRows = buildPayrollSheetRows(entries, exceptions);
  const summaryRows = buildPayrollSummaryRows(personHours);
  const tabTitle = `Payroll_${weekStartKey}`;
  const exportedAt = new Date();

  if (options?.dryRun) {
    return {
      success: true,
      exportId: randomUUID(),
      weekStartKey,
      weekEndKey: dashboard.weekEndKey || weekStartKey,
      spreadsheetId: "",
      tabTitle,
      sheetUrl: "",
      exportedAt: exportedAt.toISOString(),
      exportedBy: actorAccountKey,
      rowCount: detailRows.length,
      totals,
      exceptionCounts: reconciliation.exceptionCounts,
      verification: { checked: 0, mismatches: 0, ok: true },
      dryRun: true,
      message: `Dry-run: đã dựng ${detailRows.length} dòng lương (ngày × người) cho tab ${tabTitle}.`,
      reconciliation
    };
  }

  const spreadsheetId = getPayrollSpreadsheetId();
  const sheets = createGoogleSheetsClient();

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
  const existingTab = spreadsheet.data.sheets?.find((sheet) => sheet.properties?.title === tabTitle);
  let sheetId = existingTab?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabTitle } } }] }
    });
    sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  if (sheetId === undefined || sheetId === null) {
    throw new Error("Không tạo được tab payroll trong Google Sheet.");
  }

  const allRows: Array<Array<string | number>> = [
    PAYROLL_SHEET_HEADERS,
    ...detailRows,
    [],
    [`TỔNG HỢP THEO NGƯỜI — TUẦN ${formatDateKey(weekStartKey)} → ${formatDateKey(dashboard.weekEndKey || weekStartKey)}`],
    PAYROLL_SUMMARY_HEADERS,
    ...summaryRows
  ];
  const quotedTitle = tabTitle.replace(/'/g, "''");
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${quotedTitle}'!A1:AZ` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${quotedTitle}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: allRows }
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 7, endColumnIndex: 9 },
            cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
            fields: "userEnteredFormat.numberFormat"
          }
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 16 },
            cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0₫" } } },
            fields: "userEnteredFormat.numberFormat"
          }
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 10, endColumnIndex: 11 },
            cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.00%" } } },
            fields: "userEnteredFormat.numberFormat"
          }
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount"
          }
        }
      ]
    }
  });

  const readback = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${quotedTitle}'!A1`,
    valueRenderOption: "UNFORMATTED_VALUE"
  });
  const verification = compareWritten(allRows, (readback.data.values as unknown[][]) || []);

  const record: PayrollSheetExportRecord = {
    exportId: randomUUID(),
    weekStartKey,
    weekEndKey: dashboard.weekEndKey || weekStartKey,
    spreadsheetId,
    tabTitle,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
    exportedAt: exportedAt.toISOString(),
    exportedBy: actorAccountKey,
    rowCount: detailRows.length,
    totals,
    exceptionCounts: reconciliation.exceptionCounts,
    verification,
    dryRun: false
  };
  const collection = await getExportCollection();
  await collection.insertOne({ ...record });

  return {
    ...record,
    success: true,
    message: verification.ok
      ? `Đã xuất ${detailRows.length} dòng lương vào tab ${tabTitle} và xác minh khớp 100%.`
      : `Đã xuất ${detailRows.length} dòng vào tab ${tabTitle} nhưng read-back lệch ${verification.mismatches} ô — cần kiểm tra.`,
    reconciliation
  };
}
