import { google } from "googleapis";
import { createGoogleJwt } from "@/lib/googleAuth";
import {
  getEmployeeContractProfile,
  saveGeneratedEmployeeContractDocument
} from "@/lib/employeeContract";
import { findSchedulePerson } from "@/lib/employeeRoster";
import { getRecruitmentProfile } from "@/lib/recruitmentProfile";
import { updateRecruitmentSheetContractCode } from "@/lib/recruitmentSheetImport";
import {
  createGoogleDriveClient,
  ensureEmployeeDriveFolder,
  getContractDriveRootFolderId
} from "@/lib/googleDrive";
import type { EmployeeRole } from "@/lib/types";

const DEFAULT_CONTRACT_TEMPLATE_DOC_ID = "1NjjgR1rsqVSZH-H4do6JK8BnZPqw2pkplTpC32igzoA";
const GOOGLE_DOCS_SCOPE = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive"
];

function getContractTemplateDocId() {
  return process.env.GOOGLE_CONTRACT_TEMPLATE_DOC_ID?.trim() || DEFAULT_CONTRACT_TEMPLATE_DOC_ID;
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

function safeFolderName(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function withFallback(value: unknown) {
  const cleaned = cleanText(value);
  return cleaned || "...";
}

function formatDateDisplay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(value));
  if (!match) return "...";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function splitDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(value));
  if (!match) {
    return { day: "...", month: "...", year: "..." };
  }
  return {
    day: String(Number(match[3])),
    month: String(Number(match[2])),
    year: match[1]
  };
}

function currentVietnamDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function addMonthsToDateKey(dateKey: string, months: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(dateKey));
  if (!match) return "";
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonthIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(normalizedMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

function extractNumericMoney(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return null;
  const match = raw.match(/(\d[\d.,]*)/);
  if (!match) return null;
  const normalized = match[1]
    .replace(/[.](?=\d{3}\b)/g, "")
    .replace(/[,](?=\d{3}\b)/g, "")
    .replace(/,/g, ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function formatMoneyDisplay(value: unknown) {
  const numeric = extractNumericMoney(value);
  if (numeric === null) return "...";
  return new Intl.NumberFormat("vi-VN").format(numeric);
}

const DIGITS_VI = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

function readTripleVi(value: number, full: boolean) {
  const hundred = Math.floor(value / 100);
  const ten = Math.floor((value % 100) / 10);
  const unit = value % 10;
  const parts: string[] = [];

  if (hundred > 0 || full) {
    parts.push(`${DIGITS_VI[hundred]} trăm`);
  }

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
  if (!Number.isFinite(value) || value <= 0) return "...";
  const units = ["", "nghìn", "triệu", "tỷ"];
  const chunks: string[] = [];
  let remaining = Math.floor(value);
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

  if (chunks.length === 0) return "...";
  const sentence = chunks.join(" ").replace(/\s+/g, " ").trim();
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} đồng`;
}

function resolveSalaryFields(value: unknown) {
  const raw = cleanText(value);
  const numeric = extractNumericMoney(value);
  if (!raw && numeric === null) {
    return { fixedSalary: "...", fixedSalaryText: "...", salaryUnit: "..." };
  }
  return {
    fixedSalary: numeric === null ? raw : formatMoneyDisplay(value),
    fixedSalaryText: numeric === null ? "..." : numberToVietnameseWords(numeric),
    salaryUnit: "VNĐ/giờ"
  };
}

function buildPlaceholderMap(input: {
  employeeId: string;
  employeeName: string;
  phone?: string;
  contract?: Awaited<ReturnType<typeof getEmployeeContractProfile>> | null;
  salaryOffered?: string;
  fallbackCashOffer?: string;
}) {
  const signDateKey = currentVietnamDateKey();
  const signDateParts = splitDateParts(signDateKey);
  const endDateKey = addMonthsToDateKey(signDateKey, 4);
  const salary = resolveSalaryFields(input.salaryOffered || input.fallbackCashOffer || "");
  return {
    CONTRACT_CODE: withFallback(input.contract?.contractCode || `${input.employeeId}_HDLT2026`),
    SIGN_DAY: signDateParts.day,
    SIGN_MONTH: signDateParts.month,
    SIGN_YEAR: signDateParts.year,
    SIGN_LOCATION: "Thành Phố Hồ Chí Minh",
    FULL_NAME: withFallback(input.contract?.employeeName || input.employeeName),
    DOB: formatDateDisplay(input.contract?.dateOfBirth || ""),
    CITIZEN_ID: withFallback(input.contract?.citizenId),
    ISSUED_DATE: formatDateDisplay(input.contract?.citizenIdIssuedDate || ""),
    ISSUED_PLACE: withFallback(input.contract?.citizenIdIssuedPlace),
    PERMANENT_ADDRESS: withFallback(input.contract?.permanentAddress),
    TEMPORARY_ADDRESS: withFallback(input.contract?.temporaryAddress),
    PHONE: withFallback(input.phone),
    TERM_MONTHS: "4",
    TERM_MONTHS_TEXT: "bốn",
    END_DATE: formatDateDisplay(endDateKey),
    RENEWAL_NOTICE_DAYS: "...",
    FIXED_SALARY: salary.fixedSalary,
    FIXED_SALARY_TEXT: salary.fixedSalaryText,
    SALARY_UNIT: salary.salaryUnit,
    PAYMENT_DAY: "..."
  } satisfies Record<string, string>;
}

export async function generateEmployeeContractGoogleDoc(input: {
  role: EmployeeRole;
  employeeId: string;
  actorAccountKey: string;
}) {
  const person = await findSchedulePerson(input.role, input.employeeId);
  if (!person) throw new Error("Không tìm thấy nhân sự để tạo hợp đồng.");

  const [contract, recruitment] = await Promise.all([
    getEmployeeContractProfile(input.role, input.employeeId),
    getRecruitmentProfile(input.role, input.employeeId)
  ]);
  const templateId = getContractTemplateDocId();
  const drive = createGoogleDriveClient();
  const docs = createGoogleDocsClient();
  const rootFolderId = getContractDriveRootFolderId();
  const folderName = safeFolderName(`${person.name} - ${person.id} - ${person.role}`);
  const folderId = await ensureEmployeeDriveFolder({
    drive,
    rootFolderId,
    employeeId: person.id,
    folderName,
    role: person.role
  });

  const fileName = safeFolderName(`HOP_DONG_${person.id}_${person.name}`);
  const copied = await drive.files.copy({
    fileId: templateId,
    requestBody: {
      name: fileName,
      parents: [folderId],
      appProperties: {
        employeeId: person.id,
        role: person.role,
        contractTemplateId: templateId
      }
    },
    fields: "id,name",
    supportsAllDrives: true
  });
  const documentId = copied.data.id;
  if (!documentId) throw new Error("Không copy được template hợp đồng.");

  const placeholders = buildPlaceholderMap({
    employeeId: person.id,
    employeeName: person.name,
    phone: person.phone,
    contract,
    salaryOffered: recruitment?.salaryOffered,
    fallbackCashOffer: person.cashOffer
  });

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: Object.entries(placeholders).map(([key, value]) => ({
        replaceAllText: {
          containsText: {
            text: `{{${key}}}`,
            matchCase: true
          },
          replaceText: value
        }
      }))
    }
  });

  const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
  const profile = await saveGeneratedEmployeeContractDocument({
    role: person.role,
    employeeId: person.id,
    employeeName: person.name,
    actorAccountKey: input.actorAccountKey,
    templateId,
    documentId,
    documentUrl,
    fileName
  });
  let sheetUpdate: Awaited<ReturnType<typeof updateRecruitmentSheetContractCode>>;
  try {
    sheetUpdate = await updateRecruitmentSheetContractCode({
      role: person.role,
      employeeId: person.id,
      contractCode: profile.contractCode
    });
  } catch (error) {
    sheetUpdate = {
      success: false,
      spreadsheetId: "",
      tabName: person.role === "host" ? "Thông tin Mẫu Live" : "Thông tin Support Live",
      rowNumber: 0,
      message: error instanceof Error ? error.message : "Không ghi được Mã HĐ về Google Sheet."
    };
  }

  return {
    profile,
    documentId,
    documentUrl,
    fileName,
    sheetUpdate
  };
}
