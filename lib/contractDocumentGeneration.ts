import { google } from "googleapis";
import { createGoogleJwt } from "@/lib/googleAuth";
import {
  getEmployeeContractProfile,
  saveGeneratedEmployeeContractDocument
} from "@/lib/employeeContract";
import { findSchedulePerson } from "@/lib/employeeRoster";
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

function formatMoneyDisplay(value: unknown) {
  const cleaned = cleanText(value).replace(/[^\d.-]/g, "");
  if (!cleaned) return "...";
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return "...";
  return new Intl.NumberFormat("vi-VN").format(numeric);
}

function buildPlaceholderMap(input: {
  employeeId: string;
  employeeName: string;
  phone?: string;
  contract?: Awaited<ReturnType<typeof getEmployeeContractProfile>> | null;
}) {
  const signDateParts = splitDateParts("");
  return {
    CONTRACT_CODE: withFallback(input.contract?.contractCode || `${input.employeeId}_HDLT2026`),
    SIGN_DAY: signDateParts.day,
    SIGN_MONTH: signDateParts.month,
    SIGN_YEAR: signDateParts.year,
    SIGN_LOCATION: "...",
    FULL_NAME: withFallback(input.contract?.employeeName || input.employeeName),
    DOB: formatDateDisplay(input.contract?.dateOfBirth || ""),
    CITIZEN_ID: withFallback(input.contract?.citizenId),
    ISSUED_DATE: formatDateDisplay(input.contract?.citizenIdIssuedDate || ""),
    ISSUED_PLACE: withFallback(input.contract?.citizenIdIssuedPlace),
    PERMANENT_ADDRESS: withFallback(input.contract?.permanentAddress),
    TEMPORARY_ADDRESS: withFallback(input.contract?.temporaryAddress),
    PHONE: withFallback(input.phone),
    TERM_MONTHS: "...",
    TERM_MONTHS_TEXT: "...",
    END_DATE: "...",
    RENEWAL_NOTICE_DAYS: "...",
    FIXED_SALARY: formatMoneyDisplay(""),
    FIXED_SALARY_TEXT: "...",
    SALARY_UNIT: "...",
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

  const contract = await getEmployeeContractProfile(input.role, input.employeeId);
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
    contract
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

  return {
    profile,
    documentId,
    documentUrl,
    fileName
  };
}
