import { randomUUID } from "node:crypto";
import { getPayrollDashboard } from "@/lib/payrollStore";
import {
  createGoogleSheetsClient,
  getGoogleHrMasterSpreadsheetId,
  getGooglePayrollSheetName,
  getGooglePayrollSummarySheetName
} from "@/lib/googleSheets";
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
  "Session_ID",
  "Ngày Live",
  "Week_Start",
  "Week_End",
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
  "Report_Start_Time",
  "Report_End_Time",
  "Payroll_Status",
  "Recalculated_At",
  "Ghi Chú Đối Chiếu"
] as const;

export const PAYROLL_SUMMARY_HEADERS = [
  "Week_Start",
  "Week_End",
  "Mã Nhân Sự",
  "Họ Và Tên",
  "Vai Trò",
  "Cấp Độ / Grade",
  "Số Ca",
  "Tổng Giờ Live",
  "Tổng Lương Cứng",
  "Tổng Hoa Hồng",
  "Tổng Bonus",
  "Tổng Thuế",
  "Tổng Thực Nhận",
  "Last_Recalculated_At"
] as const;

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

type SheetGridRow = Array<string | number>;

const EXCEPTION_LABELS: Record<string, string> = {
  missing_report: "Thiếu báo cáo TikTok",
  unmatched_report: "Báo cáo TikTok không khớp ca",
  missing_account: "Thiếu account TikTok",
  missing_rate: "Thiếu bậc lương",
  ambiguous_assignment: "Ca chưa rõ người phụ",
  unconfirmed_shift: "Ca chưa xác nhận"
};

const DETAIL_HEADER_ALIASES: Record<string, string[]> = {
  Session_ID: ["Session_ID", "Mã Ca Live (Session_ID)"],
  "Ngày Live": ["Ngày Live"],
  Week_Start: ["Week_Start"],
  Week_End: ["Week_End"],
  "Mã Nhân Sự": ["Mã Nhân Sự", "Mã Nhân Sự "],
  "Họ Và Tên": ["Họ Và Tên"],
  "Vai Trò": ["Vai Trò"],
  "Cấp Độ / Grade": ["Cấp Độ / Grade"],
  "Số Giờ Live": ["Số Giờ Live"],
  "Lương Giờ/h": ["Lương Giờ/h"],
  "Thành Tiền Lương Cứng": ["Thành Tiền Lương Cứng"],
  "Doanh Thu Thuần (Eligible GMV)": ["Doanh Thu Thuần (Eligible GMV)"],
  "% Hoa Hồng": ["% Hoa Hồng"],
  "Tiền Hoa Hồng": ["Tiền Hoa Hồng"],
  "Thưởng Nóng GMV/CCU": ["Thưởng Nóng GMV/CCU"],
  "TỔNG TIỀN": ["TỔNG TIỀN"],
  "Thuế 10%": ["Thuế 10%"],
  "TỔNG THỰC NHẬN (VNĐ)": ["TỔNG THỰC NHẬN (VNĐ)"],
  "Account Live": ["Account Live"],
  "Địa Điểm": ["Địa Điểm"],
  "TikTok Live IDs": ["TikTok Live IDs", "TikTok Live IDs "],
  Report_Start_Time: ["Report_Start_Time"],
  Report_End_Time: ["Report_End_Time"],
  Payroll_Status: ["Payroll_Status"],
  Recalculated_At: ["Recalculated_At"],
  "Ghi Chú Đối Chiếu": ["Ghi Chú Đối Chiếu"]
};

const SUMMARY_HEADER_ALIASES: Record<string, string[]> = {
  Week_Start: ["Week_Start"],
  Week_End: ["Week_End"],
  "Mã Nhân Sự": ["Mã Nhân Sự"],
  "Họ Và Tên": ["Họ Và Tên"],
  "Vai Trò": ["Vai Trò"],
  "Cấp Độ / Grade": ["Cấp Độ / Grade"],
  "Số Ca": ["Số Ca"],
  "Tổng Giờ Live": ["Tổng Giờ Live"],
  "Tổng Lương Cứng": ["Tổng Lương Cứng"],
  "Tổng Hoa Hồng": ["Tổng Hoa Hồng"],
  "Tổng Bonus": ["Tổng Bonus"],
  "Tổng Thuế": ["Tổng Thuế"],
  "Tổng Thực Nhận": ["Tổng Thực Nhận"],
  Last_Recalculated_At: ["Last_Recalculated_At"]
};

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

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Math.round(value * 100) / 100;
  return String(value).trim();
}

function convertSheetsSerialToDateKey(value: number) {
  if (!Number.isFinite(value)) return "";
  const epochUtc = Date.UTC(1899, 11, 30);
  const timestamp = epochUtc + Math.round(value) * 24 * 60 * 60 * 1000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeDateLikeCell(value: unknown) {
  if (typeof value === "number") {
    return convertSheetsSerialToDateKey(value);
  }
  return parseDateDisplayToKey(value);
}

function columnLetterFromCount(columnCount: number) {
  let index = Math.max(1, columnCount);
  let output = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    index = Math.floor((index - 1) / 26);
  }
  return output;
}

function parseDateDisplayToKey(value: unknown) {
  const trimmed = String(normalizeCell(value)).trim();
  if (!trimmed) return "";
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) return trimmed;
  const localMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!localMatch) return "";
  const [, day, month, year] = localMatch;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function toLocationLabel(location: PayrollEntry["location"]) {
  return location === "studio" ? "Studio" : "Home";
}

function toRoleLabel(entry: PayrollEntry) {
  return entry.role === "host" ? "Host (Chính)" : "Support";
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

function buildEntryTimeRange(entry: PayrollEntry) {
  const formatTimeRange = (start: string, end: string) =>
    `${start.slice(0, 2)}:${start.slice(2)}-${end.slice(0, 2)}:${end.slice(2)}`;

  const addHours = (hhmm: string, hours: number) => {
    const total = (Number(hhmm.slice(0, 2)) * 60) + Number(hhmm.slice(2));
    const adjusted = (total + (hours * 60)) % (24 * 60);
    const normalized = adjusted < 0 ? adjusted + (24 * 60) : adjusted;
    const hour = String(Math.floor(normalized / 60)).padStart(2, "0");
    const minute = String(normalized % 60).padStart(2, "0");
    return `${hour}${minute}`;
  };

  const times = entry.sessionIds
    .map((sessionId) => {
      const sessionCodeMatch = sessionId.match(/^SS-\d{8}-(\d{4})(\d{4})-/);
      if (sessionCodeMatch) {
        const start = sessionCodeMatch[1];
        const end = sessionCodeMatch[2];
        return formatTimeRange(start, end);
      }

      const sessionKeyMatch = sessionId.match(/^AUTO_\d{8}_(\d{4})_(?:HOME|STUDIO)$/);
      if (sessionKeyMatch) {
        const start = sessionKeyMatch[1];
        return formatTimeRange(start, addHours(start, 2));
      }

      return null;
    })
    .filter(Boolean) as string[];
  return times.join(" | ");
}

export function buildPayrollSheetRows(entries: PayrollEntry[], exceptions: PayrollException[]) {
  const notes = buildExceptionNotes(entries, exceptions);
  return entries.map((entry, index) => [
    entry.sessionIds.join(" | "),
    formatDateKey(entry.dateKey),
    entry.weekStartKey,
    entry.weekEndKey,
    entry.employeeId,
    entry.employeeName,
    toRoleLabel(entry),
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
    toLocationLabel(entry.location),
    entry.tiktokLiveIds.join(" | "),
    buildEntryTimeRange(entry),
    buildEntryTimeRange(entry),
    "calculated",
    entry.generatedAt,
    notes[index]
  ]) as SheetGridRow[];
}

export function buildPayrollSummaryRows(personHours: PayrollPersonHours[], entries: PayrollEntry[], weekStartKey: string, weekEndKey: string, recalculatedAt: string) {
  const aggregates = new Map<string, { basePay: number; commissionPay: number; adjustments: number; taxAmount: number; netPay: number }>();
  entries.forEach((entry) => {
    const key = `${entry.role}:${entry.employeeId.toLowerCase()}`;
    const current = aggregates.get(key) || { basePay: 0, commissionPay: 0, adjustments: 0, taxAmount: 0, netPay: 0 };
    current.basePay += entry.basePay;
    current.commissionPay += entry.commissionPay;
    current.adjustments += entry.adjustments;
    current.taxAmount += entry.taxAmount;
    current.netPay += entry.netPay;
    aggregates.set(key, current);
  });

  return personHours.map((person) => {
    const key = `${person.role}:${person.employeeId.toLowerCase()}`;
    const totals = aggregates.get(key) || { basePay: 0, commissionPay: 0, adjustments: 0, taxAmount: 0, netPay: 0 };
    return [
      weekStartKey,
      weekEndKey,
      person.employeeId,
      person.employeeName,
      person.role === "host" ? "Host" : "Support",
      person.grade,
      person.sessionCount,
      roundHours(person.scheduledHours),
      roundMoney(totals.basePay),
      roundMoney(totals.commissionPay),
      roundMoney(totals.adjustments),
      roundMoney(totals.taxAmount),
      roundMoney(totals.netPay),
      recalculatedAt
    ];
  }) as SheetGridRow[];
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

function compareWritten(headers: readonly string[], expected: SheetGridRow[], actual: unknown[][]) {
  const dateHeaders = new Set(["Ngày Live", "Week_Start", "Week_End"]);
  let checked = 0;
  let mismatches = 0;
  expected.forEach((row, rowIndex) => {
    row.forEach((cell, cellIndex) => {
      const header = headers[cellIndex] || "";
      if (dateHeaders.has(header)) {
        const expectedDate = normalizeDateLikeCell(cell);
        const actualDate = normalizeDateLikeCell(actual[rowIndex]?.[cellIndex]);
        checked += 1;
        if (expectedDate !== actualDate) mismatches += 1;
        return;
      }
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

function getHeaderIndexMap(headers: string[]) {
  return new Map(headers.map((header, index) => [String(normalizeCell(header)).toLowerCase(), index]));
}

function findExistingColumnIndex(indexMap: Map<string, number>, aliases: string[]) {
  for (const alias of aliases) {
    const index = indexMap.get(alias.trim().toLowerCase());
    if (index !== undefined) return index;
  }
  return -1;
}

function normalizeExistingRows(rows: string[][], existingHeaders: string[], canonicalHeaders: readonly string[], aliases: Record<string, string[]>) {
  const indexMap = getHeaderIndexMap(existingHeaders);
  return rows
    .filter((row) => row.some((cell) => normalizeCell(cell) !== ""))
    .map((row) => canonicalHeaders.map((header) => {
      const sourceIndex = findExistingColumnIndex(indexMap, aliases[header] || [header]);
      return sourceIndex >= 0 ? normalizeCell(row[sourceIndex]) : "";
    }) as SheetGridRow);
}

function isDetailRowInsideWeek(row: SheetGridRow, weekStartKey: string, weekEndKey: string) {
  const storedWeekStart = parseDateDisplayToKey(row[2]);
  if (storedWeekStart) return storedWeekStart === weekStartKey;
  const dateKey = parseDateDisplayToKey(row[1]);
  return Boolean(dateKey && dateKey >= weekStartKey && dateKey <= weekEndKey);
}

function isSummaryRowInsideWeek(row: SheetGridRow, weekStartKey: string) {
  const storedWeekStart = parseDateDisplayToKey(row[0]);
  return storedWeekStart === weekStartKey;
}

function compareDetailRows(left: SheetGridRow, right: SheetGridRow) {
  const leftDate = parseDateDisplayToKey(left[1]);
  const rightDate = parseDateDisplayToKey(right[1]);
  if (leftDate && rightDate && leftDate !== rightDate) {
    return leftDate > rightDate ? -1 : 1;
  }
  const leftSession = String(normalizeCell(left[0]));
  const rightSession = String(normalizeCell(right[0]));
  if (leftSession !== rightSession) return rightSession.localeCompare(leftSession);
  return String(normalizeCell(right[4])).localeCompare(String(normalizeCell(left[4])));
}

function compareSummaryRows(left: SheetGridRow, right: SheetGridRow) {
  const leftWeek = parseDateDisplayToKey(left[0]);
  const rightWeek = parseDateDisplayToKey(right[0]);
  if (leftWeek && rightWeek && leftWeek !== rightWeek) {
    return leftWeek > rightWeek ? -1 : 1;
  }
  return String(normalizeCell(left[2])).localeCompare(String(normalizeCell(right[2])));
}

async function ensureSheetTab(sheets: ReturnType<typeof createGoogleSheetsClient>, spreadsheetId: string, title: string) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
  const existingTab = spreadsheet.data.sheets?.find((sheet) => sheet.properties?.title === title);
  let sheetId = existingTab?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
    sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Không tạo được tab ${title} trong Google Sheet.`);
  }
  return { sheetId, quotedTitle: title.replace(/'/g, "''") };
}

async function writeFixedSheet(args: {
  sheets: ReturnType<typeof createGoogleSheetsClient>;
  spreadsheetId: string;
  sheetName: string;
  headers: readonly string[];
  aliases: Record<string, string[]>;
  replacementRows: SheetGridRow[];
  shouldReplaceRow: (row: SheetGridRow) => boolean;
  compareRows: (left: SheetGridRow, right: SheetGridRow) => number;
  freezeColumns?: number;
}) {
  const { sheets, spreadsheetId, sheetName, headers, aliases, replacementRows, shouldReplaceRow, compareRows, freezeColumns = 1 } = args;
  const { sheetId, quotedTitle } = await ensureSheetTab(sheets, spreadsheetId, sheetName);
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${quotedTitle}'!A:AZ`
  });
  const values = (current.data.values as string[][] | undefined) || [];
  const existingHeaders = values[0]?.length ? values[0].map((cell) => String(normalizeCell(cell))) : [...headers];
  const existingRows = normalizeExistingRows(values.slice(1), existingHeaders, headers, aliases);
  const preservedRows = existingRows.filter((row) => !shouldReplaceRow(row));
  const mergedRows = [...preservedRows, ...replacementRows].sort(compareRows);
  const allRows: SheetGridRow[] = [[...headers], ...mergedRows];

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${quotedTitle}'!A1:AZ`
  });
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
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 1,
                frozenColumnCount: freezeColumns
              }
            },
            fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"
          }
        }
      ]
    }
  });

  const readbackRange = `'${quotedTitle}'!A1:${columnLetterFromCount(headers.length)}${allRows.length}`;
  const readback = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: readbackRange,
    valueRenderOption: "UNFORMATTED_VALUE"
  });

  return {
    sheetId,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
    rowCount: replacementRows.length,
    preservedRows: preservedRows.length,
    verification: compareWritten(headers, allRows, (readback.data.values as unknown[][]) || [])
  };
}

export async function exportPayrollWeekToSheet(
  weekStartKey: string,
  actorAccountKey: string,
  options?: { dryRun?: boolean }
): Promise<PayrollSheetExportResult> {
  const dashboard = await getPayrollDashboard(weekStartKey);
  if (!dashboard.periodStatus || !dashboard.entries || dashboard.entries.length === 0) {
    throw new Error("Tuần này chưa có bảng lương — hãy bấm Tính lương tuần trước khi đồng bộ.");
  }

  const entries = dashboard.entries;
  const exceptions = dashboard.exceptions || [];
  const personHours = dashboard.personHours || [];
  const reconciliation = buildReconciliation(dashboard);
  const totals = summarizeEntries(entries);
  const detailSheetName = getGooglePayrollSheetName();
  const summarySheetName = getGooglePayrollSummarySheetName();
  const exportedAt = new Date();
  const exportedAtIso = exportedAt.toISOString();

  const detailRows = buildPayrollSheetRows(entries, exceptions);
  const summaryRows = buildPayrollSummaryRows(personHours, entries, weekStartKey, dashboard.weekEndKey || weekStartKey, exportedAtIso);

  if (options?.dryRun) {
    return {
      success: true,
      exportId: randomUUID(),
      weekStartKey,
      weekEndKey: dashboard.weekEndKey || weekStartKey,
      spreadsheetId: getGoogleHrMasterSpreadsheetId(),
      tabTitle: detailSheetName,
      summaryTabTitle: summarySheetName,
      sheetUrl: "",
      summarySheetUrl: "",
      exportedAt: exportedAtIso,
      exportedBy: actorAccountKey,
      rowCount: detailRows.length,
      summaryRowCount: summaryRows.length,
      totals,
      exceptionCounts: reconciliation.exceptionCounts,
      verification: { checked: 0, mismatches: 0, ok: true },
      dryRun: true,
      message: `Dry-run: đã dựng ${detailRows.length} dòng chi tiết cho ${detailSheetName} và ${summaryRows.length} dòng tổng hợp cho ${summarySheetName}.`,
      reconciliation
    };
  }

  const spreadsheetId = getGoogleHrMasterSpreadsheetId();
  const sheets = createGoogleSheetsClient();

  const detailResult = await writeFixedSheet({
    sheets,
    spreadsheetId,
    sheetName: detailSheetName,
    headers: PAYROLL_SHEET_HEADERS,
    aliases: DETAIL_HEADER_ALIASES,
    replacementRows: detailRows,
    shouldReplaceRow: (row) => isDetailRowInsideWeek(row, weekStartKey, dashboard.weekEndKey || weekStartKey),
    compareRows: compareDetailRows,
    freezeColumns: 5
  });

  const summaryResult = await writeFixedSheet({
    sheets,
    spreadsheetId,
    sheetName: summarySheetName,
    headers: PAYROLL_SUMMARY_HEADERS,
    aliases: SUMMARY_HEADER_ALIASES,
    replacementRows: summaryRows,
    shouldReplaceRow: (row) => isSummaryRowInsideWeek(row, weekStartKey),
    compareRows: compareSummaryRows,
    freezeColumns: 4
  });

  const verification = {
    checked: detailResult.verification.checked + summaryResult.verification.checked,
    mismatches: detailResult.verification.mismatches + summaryResult.verification.mismatches,
    ok: detailResult.verification.ok && summaryResult.verification.ok
  };

  const record: PayrollSheetExportRecord = {
    exportId: randomUUID(),
    weekStartKey,
    weekEndKey: dashboard.weekEndKey || weekStartKey,
    spreadsheetId,
    tabTitle: detailSheetName,
    summaryTabTitle: summarySheetName,
    sheetUrl: detailResult.sheetUrl,
    summarySheetUrl: summaryResult.sheetUrl,
    exportedAt: exportedAtIso,
    exportedBy: actorAccountKey,
    rowCount: detailRows.length,
    summaryRowCount: summaryRows.length,
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
      ? `Đã đồng bộ ${detailRows.length} dòng vào ${detailSheetName} và ${summaryRows.length} dòng vào ${summarySheetName}; read-back khớp 100%.`
      : `Đã đồng bộ ${detailRows.length} dòng vào ${detailSheetName} và ${summaryRows.length} dòng vào ${summarySheetName}, nhưng read-back lệch ${verification.mismatches} ô — cần kiểm tra.`,
    reconciliation
  };
}
