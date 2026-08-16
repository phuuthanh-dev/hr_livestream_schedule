import { Readable } from "node:stream";
import { getContractImageDownloadUrl } from "@/lib/contractCloudinary";
import {
  createGoogleDriveClient,
  ensureEmployeeDriveFolder,
  getContractDriveRootFolderId,
  upsertDriveBinaryFile,
  upsertDriveTextFile
} from "@/lib/googleDrive";
import { getEmployeeContractProfile, setEmployeeContractDriveSyncStatus } from "@/lib/employeeContract";
import { findSchedulePerson } from "@/lib/employeeRoster";
import { getLatestPeopleApplicationForEmployee } from "@/lib/peopleApplication";
import { getRecruitmentProfile } from "@/lib/recruitmentProfile";
import { getSupportTrainingProfile } from "@/lib/supportTraining";
import type { EmployeeRole, SchedulePerson } from "@/lib/types";

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

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function deriveCvReference(input: {
  recruitment?: { cvUrl?: string | undefined } | null;
  application?: { cvUrl?: string | undefined } | null;
  person?: { cvReference?: string | undefined } | null;
}) {
  return cleanText(input.recruitment?.cvUrl) || cleanText(input.application?.cvUrl) || cleanText(input.person?.cvReference);
}

function guessMimeTypeFromName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function fileNameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    if (!last) return fallback;
    const cleaned = last.replace(/[^\w.-]+/g, "_");
    return cleaned || fallback;
  } catch {
    return fallback;
  }
}

function buildSummaryMarkdown(input: {
  person: SchedulePerson;
  contract?: Awaited<ReturnType<typeof getEmployeeContractProfile>>;
  recruitment?: Awaited<ReturnType<typeof getRecruitmentProfile>>;
  application?: Awaited<ReturnType<typeof getLatestPeopleApplicationForEmployee>>;
  supportTraining?: Awaited<ReturnType<typeof getSupportTrainingProfile>>;
}) {
  const lines = [
    `# Hồ sơ nhân sự ${input.person.id}`,
    "",
    `- Họ tên: ${input.person.name}`,
    `- Vai trò: ${input.person.role}`,
    `- Mã nhân viên: ${input.person.id}`,
    `- Số điện thoại: ${input.person.phone || ""}`,
    `- Địa điểm: ${input.person.workLocation || ""}`,
    `- Level: ${input.person.level || ""}`,
    `- Rating: ${input.person.rating || ""}`,
    `- Cash offer: ${input.person.cashOffer || ""}`,
    `- Contract complete: ${input.contract?.completed ? "Có" : "Không"}`,
    `- Training profile: ${input.supportTraining ? "Có" : "Không"}`,
    `- Recruitment profile: ${input.recruitment ? "Có" : "Không"}`,
    `- Application profile: ${input.application ? "Có" : "Không"}`,
    ""
  ];

  if (input.contract?.permanentAddress) {
    lines.push("## Thường trú", "", input.contract.permanentAddress, "");
  }
  if (input.contract?.temporaryAddress) {
    lines.push("## Tạm trú", "", input.contract.temporaryAddress, "");
  }
  return lines.join("\n");
}

async function downloadBufferFromUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Không tải được file nguồn từ ${url}.`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers.get("content-type") || "application/octet-stream"
  };
}

async function syncOptionalRemoteFile(input: {
  drive: ReturnType<typeof createGoogleDriveClient>;
  folderId: string;
  url: string;
  preferredFileName: string;
}) {
  const sourceUrl = cleanText(input.url);
  if (!isHttpUrl(sourceUrl)) return;
  const { buffer, mimeType } = await downloadBufferFromUrl(sourceUrl);
  const contentType = mimeType.toLowerCase();
  if (contentType.startsWith("text/html")) return;
  const fileName = fileNameFromUrl(sourceUrl, input.preferredFileName);
  await upsertDriveBinaryFile({
    drive: input.drive,
    parentId: input.folderId,
    fileName,
    mimeType: mimeType || guessMimeTypeFromName(fileName),
    buffer
  });
}

async function syncContractImage(input: {
  drive: ReturnType<typeof createGoogleDriveClient>;
  folderId: string;
  fileName: string;
  file?: { publicId: string; format: string } | null;
}) {
  if (!input.file?.publicId || !input.file.format) return;
  const downloadUrl = getContractImageDownloadUrl({
    ...input.file,
    version: 0,
    bytes: 0,
    originalFilename: input.fileName,
    uploadedAt: new Date().toISOString()
  });
  const { buffer, mimeType } = await downloadBufferFromUrl(downloadUrl);
  await upsertDriveBinaryFile({
    drive: input.drive,
    parentId: input.folderId,
    fileName: input.fileName,
    mimeType,
    buffer
  });
}

export async function syncEmployeeBundleToDrive(input: {
  role: EmployeeRole;
  employeeId: string;
}) {
  const person = await findSchedulePerson(input.role, input.employeeId);
  if (!person) throw new Error("Không tìm thấy nhân sự để sync Drive.");

  const [contract, recruitment, application, supportTraining] = await Promise.all([
    getEmployeeContractProfile(input.role, input.employeeId),
    getRecruitmentProfile(input.role, input.employeeId),
    getLatestPeopleApplicationForEmployee(input.role, input.employeeId),
    input.role === "support" ? getSupportTrainingProfile(input.employeeId) : Promise.resolve(null)
  ]);

  const drive = createGoogleDriveClient();
  const rootFolderId = getContractDriveRootFolderId();
  const folderName = safeFolderName(`${person.name} - ${person.id} - ${person.role}`);
  const folderId = await ensureEmployeeDriveFolder({
    drive,
    rootFolderId,
    employeeId: person.id,
    folderName,
    role: person.role
  });

  await upsertDriveTextFile({
    drive,
    parentId: folderId,
    fileName: "person-profile.json",
    content: JSON.stringify(person, null, 2)
  });

  if (contract) {
    await upsertDriveTextFile({
      drive,
      parentId: folderId,
      fileName: "contract-profile.json",
      content: JSON.stringify(contract, null, 2)
    });
  }

  if (recruitment) {
    await upsertDriveTextFile({
      drive,
      parentId: folderId,
      fileName: "recruitment-profile.json",
      content: JSON.stringify(recruitment, null, 2)
    });
  }

  if (application) {
    await upsertDriveTextFile({
      drive,
      parentId: folderId,
      fileName: "application-profile.json",
      content: JSON.stringify(application, null, 2)
    });
  }

  if (supportTraining) {
    await upsertDriveTextFile({
      drive,
      parentId: folderId,
      fileName: "support-training-profile.json",
      content: JSON.stringify(supportTraining, null, 2)
    });
  }

  const cvReference = deriveCvReference({ recruitment, application, person });
  if (cvReference) {
    await upsertDriveTextFile({
      drive,
      parentId: folderId,
      fileName: "cv-reference.txt",
      content: cvReference,
      mimeType: "text/plain; charset=utf-8"
    });
    await syncOptionalRemoteFile({
      drive,
      folderId,
      url: cvReference,
      preferredFileName: "cv-file"
    }).catch(() => undefined);
  }

  await upsertDriveTextFile({
    drive,
    parentId: folderId,
    fileName: "README.md",
    content: buildSummaryMarkdown({ person, contract, recruitment, application, supportTraining }),
    mimeType: "text/markdown; charset=utf-8"
  });

  if (contract) {
    await syncContractImage({
      drive,
      folderId,
      fileName: `cccd-front.${contract.citizenIdFront?.format || "jpg"}`,
      file: contract.citizenIdFront || null
    });
    await syncContractImage({
      drive,
      folderId,
      fileName: `cccd-back.${contract.citizenIdBack?.format || "jpg"}`,
      file: contract.citizenIdBack || null
    });
  }

  await setEmployeeContractDriveSyncStatus({
    role: input.role,
    employeeId: input.employeeId,
    employeeName: person.name,
    status: "success",
    syncedAt: new Date(),
    folderId
  });

  return { folderId };
}

export async function syncEmployeeBundleToDriveSafely(input: {
  role: EmployeeRole;
  employeeId: string;
}) {
  try {
    const result = await syncEmployeeBundleToDrive(input);
    return { success: true as const, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive sync failed.";
    await setEmployeeContractDriveSyncStatus({
      role: input.role,
      employeeId: input.employeeId,
      employeeName: "",
      status: "error",
      syncedAt: new Date(),
      error: message
    }).catch(() => undefined);
    return {
      success: false as const,
      message
    };
  }
}
