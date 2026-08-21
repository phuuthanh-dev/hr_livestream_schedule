import { google } from "googleapis";
import { createGoogleJwt } from "@/lib/googleAuth";
import { findSchedulePerson } from "@/lib/employeeRoster";
import { getEmployeeContractProfile } from "@/lib/employeeContract";
import { getRecruitmentProfile } from "@/lib/recruitmentProfile";
import {
  createGoogleDriveClient,
  ensureEmployeeDriveFolder,
  findDriveChildByName,
  getContractDriveRootFolderId
} from "@/lib/googleDrive";
import {
  createGoogleSheetsClient,
  getGoogleHrMasterSpreadsheetId,
  getGooglePayrollSummarySheetName
} from "@/lib/googleSheets";
import { getMongoDatabase } from "@/lib/mongodb";
import { buildPayrollPersonHours } from "@/lib/payrollPersonSummary";
import { getPayrollDashboard } from "@/lib/payrollStore";
import type { EmployeeRole, PayrollDashboardPayload, PayrollEntry } from "@/lib/types";

const DEFAULT_PAYROLL_PAYSLIP_TEMPLATE_DOC_ID = "1ykdRKfFj0UHpOgLylvAg_ly5gOZhhNfEITdcaefxjQg";
const GOOGLE_DOCS_SCOPE = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive"
];

export type PayrollPayslipDocument = {
  employeeId: string;
  role: EmployeeRole;
  employeeName: string;
  fileName: string;
  documentId: string;
  documentUrl: string;
};

export type PayrollPayslipBatchResult = {
  success: boolean;
  fromDate: string;
  toDate: string;
  generatedCount: number;
  failedCount: number;
  documents: PayrollPayslipDocument[];
  failures: Array<{
    employeeId: string;
    role: EmployeeRole;
    employeeName: string;
    message: string;
  }>;
  message?: string;
};

type PayrollPayslipPersonSummary = {
  employeeId: string;
  role: EmployeeRole;
  employeeName: string;
  grade: string;
  totalHours: number;
  basePay: number;
  commissionPay: number;
  grossPay: number;
  taxAmount: number;
  netPay: number;
  sessionCount: number;
};

type PayrollPayslipRecord = PayrollPayslipDocument & {
  fromDate: string;
  toDate: string;
  generatedAt: string;
  generatedBy: string;
};

function getPayrollPayslipTemplateDocId() {
  return process.env.GOOGLE_PAYROLL_PAYSLIP_TEMPLATE_DOC_ID?.trim() || DEFAULT_PAYROLL_PAYSLIP_TEMPLATE_DOC_ID;
}

function createGoogleDocsClient() {
  const auth = createGoogleJwt(GOOGLE_DOCS_SCOPE);
  return google.docs({
    version: "v1",
    auth
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 160);
}

function toAsciiUpper(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function formatDateDisplay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(value));
  if (!match) return value || "...";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

const DIGITS_VI = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

function readTripleVi(value: number, full: boolean) {
  const hundred = Math.floor(value / 100);
  const ten = Math.floor((value % 100) / 10);
  const unit = value % 10;
  const parts: string[] = [];

  if (hundred > 0 || full) parts.push(`${DIGITS_VI[hundred]} trăm`);

  if (ten > 1) {
    parts.push(`${DIGITS_VI[ten]} mươi`);
    if (unit === 1) parts.push("mốt");
    else if (unit === 5) parts.push("lăm");
    else if (unit > 0) parts.push(DIGITS_VI[unit]);
    return parts.join(" ").trim();
  }

  if (ten === 1) {
    parts.push("mười");
    if (unit === 5) parts.push("lăm");
    else if (unit > 0) parts.push(DIGITS_VI[unit]);
    return parts.join(" ").trim();
  }

  if (unit > 0) {
    if (hundred > 0 || full) parts.push("lẻ");
    parts.push(DIGITS_VI[unit]);
  }

  return parts.join(" ").trim();
}

function numberToVietnameseWords(value: number) {
  const amount = Math.floor(value || 0);
  if (amount <= 0) return "Không đồng chẵn.";
  const units = ["", "nghìn", "triệu", "tỷ"];
  const chunks: string[] = [];
  let remaining = amount;
  let unitIndex = 0;

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const label = readTripleVi(chunk, unitIndex > 0 && chunks.length > 0);
      chunks.unshift([label, units[unitIndex]].filter(Boolean).join(" ").trim());
    }
    remaining = Math.floor(remaining / 1000);
    unitIndex += 1;
  }

  const sentence = chunks.join(" ").replace(/\s+/g, " ").trim();
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} đồng chẵn.`;
}

function normalizeRoleLabel(role: EmployeeRole) {
  return role === "support" ? "Support Livestream" : "Host Livestream";
}

function isValidDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
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

function parseDateDisplayToKey(value: unknown) {
  if (typeof value === "number") return convertSheetsSerialToDateKey(value);
  const trimmed = String(normalizeCell(value)).trim();
  if (!trimmed) return "";
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) return trimmed;
  const localMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!localMatch) return "";
  const [, day, month, year] = localMatch;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
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

async function persistPayrollPayslips(records: PayrollPayslipRecord[]) {
  if (records.length === 0) return;
  const database = await getMongoDatabase();
  const collection = database.collection<PayrollPayslipRecord>("payroll_payslips");
  await collection.createIndex({ fromDate: 1, toDate: 1, role: 1, employeeId: 1 }, { unique: true }).catch(() => undefined);
  await collection.bulkWrite(records.map((record) => ({
    updateOne: {
      filter: {
        fromDate: record.fromDate,
        toDate: record.toDate,
        role: record.role,
        employeeId: record.employeeId
      },
      update: { $set: record },
      upsert: true
    }
  })), { ordered: false });
}

async function syncPayslipLinksToSummarySheet(records: PayrollPayslipRecord[]) {
  if (records.length === 0) return { updatedCount: 0 };
  const sheets = createGoogleSheetsClient();
  const spreadsheetId = getGoogleHrMasterSpreadsheetId();
  const sheetName = getGooglePayrollSummarySheetName();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
  const existingTab = spreadsheet.data.sheets?.find((sheet) => sheet.properties?.title === sheetName);
  if (!existingTab?.properties?.sheetId) return { updatedCount: 0 };

  const quotedTitle = sheetName.replace(/'/g, "''");
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${quotedTitle}'!A:Z`,
    valueRenderOption: "UNFORMATTED_VALUE"
  });
  const values = (current.data.values as unknown[][] | undefined) || [];
  if (values.length === 0) return { updatedCount: 0 };

  const headers = values[0].map((cell) => String(normalizeCell(cell)));
  const rows = values.slice(1).map((row) => [...row]);
  const weekStartIndex = headers.findIndex((header) => header === "Week_Start");
  const weekEndIndex = headers.findIndex((header) => header === "Week_End");
  const employeeIdIndex = headers.findIndex((header) => header === "Mã Nhân Sự");
  let payslipIndex = headers.findIndex((header) => header === "Payslip_Doc_URL" || header === "Link Phiếu Lương");

  if (weekStartIndex < 0 || weekEndIndex < 0 || employeeIdIndex < 0) {
    return { updatedCount: 0 };
  }

  if (payslipIndex < 0) {
    headers.push("Payslip_Doc_URL");
    payslipIndex = headers.length - 1;
    rows.forEach((row) => {
      while (row.length < headers.length) row.push("");
    });
  }

  const recordMap = new Map(records.map((record) => [
    `${record.fromDate}|${record.toDate}|${record.employeeId.toLowerCase()}`,
    record.documentUrl
  ]));

  let updatedCount = 0;
  rows.forEach((row) => {
    while (row.length < headers.length) row.push("");
    const key = `${parseDateDisplayToKey(row[weekStartIndex])}|${parseDateDisplayToKey(row[weekEndIndex])}|${String(normalizeCell(row[employeeIdIndex])).toLowerCase()}`;
    const documentUrl = recordMap.get(key);
    if (!documentUrl) return;
    if (String(normalizeCell(row[payslipIndex])) === documentUrl) return;
    row[payslipIndex] = documentUrl;
    updatedCount += 1;
  });

  if (updatedCount === 0 && headers.length === values[0].length) {
    return { updatedCount: 0 };
  }

  const allRows = [headers, ...rows];
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${quotedTitle}'!A1:Z`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${quotedTitle}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: allRows }
  });
  const readbackRange = `'${quotedTitle}'!A1:${columnLetterFromCount(headers.length)}${allRows.length}`;
  await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: readbackRange,
    valueRenderOption: "UNFORMATTED_VALUE"
  });
  return { updatedCount };
}

function summarizePayrollPeople(payload: PayrollDashboardPayload) {
  const personHours = payload.personHours?.length
    ? payload.personHours
    : buildPayrollPersonHours(payload.entries || [], payload.settings?.taxRate || 0);
  return personHours.map((person) => ({
    employeeId: person.employeeId,
    role: person.role,
    employeeName: person.employeeName,
    grade: person.grade,
    totalHours: person.scheduledHours,
    basePay: person.basePay,
    commissionPay: person.commissionPay,
    grossPay: person.grossPay,
    taxAmount: person.taxAmount,
    netPay: person.netPay,
    sessionCount: person.sessionCount
  })).sort((left, right) =>
    left.role.localeCompare(right.role) || left.employeeName.localeCompare(right.employeeName, "vi")
  );
}

function summarizePayrollEntries(entries: PayrollEntry[]) {
  return buildPayrollPersonHours(entries, 0.1).map((person) => ({
    employeeId: person.employeeId,
    role: person.role,
    employeeName: person.employeeName,
    grade: person.grade,
    totalHours: person.scheduledHours,
    basePay: person.basePay,
    commissionPay: person.commissionPay,
    grossPay: person.grossPay,
    taxAmount: person.taxAmount,
    netPay: person.netPay,
    sessionCount: person.sessionCount
  })).sort((left, right) =>
    left.role.localeCompare(right.role) || left.employeeName.localeCompare(right.employeeName, "vi")
  );
}

async function buildPayslipDocument(input: {
  fromDate: string;
  toDate: string;
  summary: PayrollPayslipPersonSummary;
  actorAccountKey: string;
}) {
  const { summary } = input;
  const person = await findSchedulePerson(summary.role, summary.employeeId);
  if (!person) throw new Error("Không tìm thấy hồ sơ nhân sự.");

  const [contract, recruitment] = await Promise.all([
    getEmployeeContractProfile(summary.role, summary.employeeId),
    getRecruitmentProfile(summary.role, summary.employeeId)
  ]);

  const drive = createGoogleDriveClient();
  const docs = createGoogleDocsClient();
  const rootFolderId = getContractDriveRootFolderId();
  const folderId = await ensureEmployeeDriveFolder({
    drive,
    rootFolderId,
    employeeId: person.id,
    folderName: `${person.name} - ${person.id} - ${person.role}`,
    role: person.role
  });

  const employeeName = cleanText(recruitment?.fullName)
    || cleanText(contract?.employeeName)
    || cleanText(person.name)
    || cleanText(summary.employeeName)
    || summary.employeeId;
  const hourlyRate = summary.totalHours > 0 ? Math.round(summary.basePay / summary.totalHours) : 0;
  const fileName = safeFileName(`PHIEU_LUONG_${summary.employeeId}_${input.fromDate}_${input.toDate}_${employeeName}`);
  const existing = await findDriveChildByName({
    drive,
    parentId: folderId,
    fileName
  });
  if (existing?.id) {
    try {
      await drive.files.delete({
        fileId: existing.id,
        supportsAllDrives: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("File not found")) throw error;
    }
  }

  const copied = await drive.files.copy({
    fileId: getPayrollPayslipTemplateDocId(),
    requestBody: {
      name: fileName,
      parents: [folderId],
      appProperties: {
        employeeId: summary.employeeId,
        role: summary.role,
        documentType: "payroll_payslip",
        fromDate: input.fromDate,
        toDate: input.toDate
      }
    },
    fields: "id",
    supportsAllDrives: true
  });
  const documentId = copied.data.id;
  if (!documentId) throw new Error("Không tạo được phiếu lương trên Google Drive.");

  const requests = [
    ["Nguyễn Văn A", employeeName],
    ["Đội ngũ Livestream", "Đội ngũ Livestream"],
    ["Host Live chính", normalizeRoleLabel(summary.role)],
    ["Ghi mã phiên live nhân sự đã live", `Từ ${formatDateDisplay(input.fromDate)} đến ${formatDateDisplay(input.toDate)} · ${summary.sessionCount} ca live`],
    ["4.380.000", formatMoney(summary.grossPay)],
    ["30 giờ x 60.000đ", `${summary.totalHours} giờ x ${formatMoney(hourlyRate)}đ`],
    ["1.800.000", formatMoney(summary.basePay)],
    ["2% x 120.000.000đ", summary.commissionPay > 0 ? cleanText(recruitment?.salaryOffered) || "Theo dữ liệu commission trong kỳ" : "Không phát sinh hoa hồng trong kỳ"],
    ["2.400.000", formatMoney(summary.commissionPay)],
    ["Nếu có", "Không phát sinh"],
    ["180.000", "0"],
    ["Thưởng đạt mốc mắt xem kỷ lục phiên 15/07", "Không phát sinh"],
    ["250.000", formatMoney(summary.taxAmount)],
    ["Quên xác nhận ca ngày 13/07", "Không phát sinh"],
    ["Đi muộn làm chậm giờ lên sóng (Phiên live 10/07)", "Không phát sinh"],
    ["Muộn 20 phút", "-"],
    ["1 x 50.000đ", "-"],
    ["50.000", "0"],
    ["438.000", formatMoney(summary.taxAmount)],
    ["3.692.000", formatMoney(summary.netPay)],
    ["Bốn triệu một trăm ba mươi ngàn đồng chẵn.", numberToVietnameseWords(summary.netPay)],
    ["Techcombank (TCB)", cleanText(contract?.bankName) || "..."],
    ["190XXXXXXXXX", cleanText(contract?.bankAccountNumber) || "..."],
    ["NGUYEN VAN A", toAsciiUpper(employeeName) || "..."],
    ["Mọi thắc mắc về sai lệch số liệu, vui lòng phản hồi lại bộ phận HR trước 17h00 ngày 28/07/2026.", "Mọi thắc mắc về sai lệch số liệu, vui lòng phản hồi lại bộ phận HR để được kiểm tra và đối soát."]
  ].map(([containsText, replaceText]) => ({
    replaceAllText: {
      containsText: { text: containsText, matchCase: true },
      replaceText
    }
  }));

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests }
  });

  return {
    employeeId: summary.employeeId,
    role: summary.role,
    employeeName,
    fileName,
    documentId,
    documentUrl: `https://docs.google.com/document/d/${documentId}/edit`
  } satisfies PayrollPayslipDocument;
}

export async function generatePayrollPayslipsForWeek(weekStartKey: string, actorAccountKey: string): Promise<PayrollPayslipBatchResult> {
  const payload = await getPayrollDashboard(weekStartKey);
  if (!payload.success || !payload.weekEndKey) {
    throw new Error(payload.message || "Không tải được dữ liệu payroll để tạo phiếu lương.");
  }
  const summaries = summarizePayrollPeople(payload);
  if (summaries.length === 0) {
    throw new Error("Tuần này chưa có bảng lương để tạo phiếu lương.");
  }

  const documents: PayrollPayslipDocument[] = [];
  const failures: PayrollPayslipBatchResult["failures"] = [];

  for (const summary of summaries) {
    try {
      documents.push(await buildPayslipDocument({
        fromDate: weekStartKey,
        toDate: payload.weekEndKey,
        summary,
        actorAccountKey
      }));
    } catch (error) {
      failures.push({
        employeeId: summary.employeeId,
        role: summary.role,
        employeeName: summary.employeeName,
        message: error instanceof Error ? error.message : "Không tạo được phiếu lương."
      });
    }
  }

  const generatedCount = documents.length;
  const failedCount = failures.length;
  const generatedAt = new Date().toISOString();
  const persistedRecords = documents.map((document) => ({
    ...document,
    fromDate: weekStartKey,
    toDate: payload.weekEndKey!,
    generatedAt,
    generatedBy: actorAccountKey
  }));
  await persistPayrollPayslips(persistedRecords);
  const sheetSync = await syncPayslipLinksToSummarySheet(persistedRecords);
  return {
    success: failedCount === 0,
    fromDate: weekStartKey,
    toDate: payload.weekEndKey,
    generatedCount,
    failedCount,
    documents,
    failures,
    message: failedCount === 0
      ? `Đã tạo ${generatedCount} phiếu lương trong tuần ${formatDateDisplay(weekStartKey)} - ${formatDateDisplay(payload.weekEndKey)} và cập nhật ${sheetSync.updatedCount} link vào Payroll_Summary_Raw.`
      : `Đã tạo ${generatedCount} phiếu lương, còn ${failedCount} nhân sự cần kiểm tra. Đã cập nhật ${sheetSync.updatedCount} link vào Payroll_Summary_Raw.`
  };
}

export async function generatePayrollPayslipsForRange(fromDate: string, toDate: string, actorAccountKey: string): Promise<PayrollPayslipBatchResult> {
  if (!isValidDateKey(fromDate) || !isValidDateKey(toDate)) {
    throw new Error("Khoảng ngày tạo phiếu lương không hợp lệ.");
  }
  if (fromDate > toDate) {
    throw new Error("Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.");
  }

  const database = await getMongoDatabase();
  const entries = await database
    .collection<PayrollEntry>("payroll_entries")
    .find({ dateKey: { $gte: fromDate, $lte: toDate } })
    .sort({ dateKey: 1, employeeName: 1 })
    .toArray();

  const summaries = summarizePayrollEntries(entries);
  if (summaries.length === 0) {
    throw new Error("Khoảng ngày này chưa có bảng lương để tạo phiếu lương.");
  }

  const documents: PayrollPayslipDocument[] = [];
  const failures: PayrollPayslipBatchResult["failures"] = [];

  for (const summary of summaries) {
    try {
      documents.push(await buildPayslipDocument({
        fromDate,
        toDate,
        summary,
        actorAccountKey
      }));
    } catch (error) {
      failures.push({
        employeeId: summary.employeeId,
        role: summary.role,
        employeeName: summary.employeeName,
        message: error instanceof Error ? error.message : "Không tạo được phiếu lương."
      });
    }
  }

  const generatedCount = documents.length;
  const failedCount = failures.length;
  const generatedAt = new Date().toISOString();
  const persistedRecords = documents.map((document) => ({
    ...document,
    fromDate,
    toDate,
    generatedAt,
    generatedBy: actorAccountKey
  }));
  await persistPayrollPayslips(persistedRecords);
  const sheetSync = await syncPayslipLinksToSummarySheet(persistedRecords);
  return {
    success: failedCount === 0,
    fromDate,
    toDate,
    generatedCount,
    failedCount,
    documents,
    failures,
    message: failedCount === 0
      ? `Đã tạo ${generatedCount} phiếu lương từ ${formatDateDisplay(fromDate)} đến ${formatDateDisplay(toDate)} và cập nhật ${sheetSync.updatedCount} link vào Payroll_Summary_Raw.`
      : `Đã tạo ${generatedCount} phiếu lương, còn ${failedCount} nhân sự cần kiểm tra. Đã cập nhật ${sheetSync.updatedCount} link vào Payroll_Summary_Raw.`
  };
}
