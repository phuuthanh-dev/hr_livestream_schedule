#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import { MongoClient } from "mongodb";
import { v2 as cloudinary } from "cloudinary";
import {
  buildLocalProgramEnv,
  loadLocalProgramEnv,
  programRoot
} from "./runtime.mjs";
import {
  buildSyncTargets,
  deriveCvReference,
  isHttpUrl
} from "./target-model.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  const readValue = (name, fallback = "") => {
    const prefix = `${name}=`;
    const match = argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
  };

  return {
    dryRun: flags.has("--dry-run"),
    watch: flags.has("--watch"),
    help: flags.has("--help") || flags.has("-h"),
    employeeId: readValue("--employee-id"),
    intervalMinutes: Number(readValue("--interval-minutes")) || undefined
  };
}

function printHelp() {
  console.log(`contract-drive-sync

Usage:
  node local_programs/contract_drive_sync/sync-contracts.mjs [--dry-run] [--watch] [--employee-id=HRLT25] [--interval-minutes=60]

Flags:
  --dry-run            Chỉ in thay đổi dự kiến, không ghi Google Drive.
  --watch              Chạy lặp theo chu kỳ.
  --employee-id=ID     Chỉ sync 1 nhân sự.
  --interval-minutes   Ghi đè chu kỳ mặc định.
  --help               Hiển thị trợ giúp.

Yêu cầu:
  1. Khai báo cấu hình local program ở:
     local_programs/contract_drive_sync/.env.local
  2. Cài và đăng nhập Google Workspace CLI:
     gws auth login -s drive
  3. Tài khoản đang đăng nhập bằng gws phải có quyền vào folder Drive đích.

Ghi chú:
  Program sẽ sync tất cả dữ liệu hiện có theo nhân sự:
  - schedule_people
  - employee_contract_profiles
  - people_applications
  - CV reference / CV file nếu nguồn tải được
`);
}

function mkdirp(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function formatIso(value) {
  return value ? new Date(value).toISOString() : "";
}

function mimeTypeForExtension(extension) {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "json") return "application/json";
  if (extension === "md") return "text/markdown";
  return "application/octet-stream";
}

function safeFolderName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 140);
}

function buildCloudinaryDownloadUrl(file) {
  return cloudinary.utils.private_download_url(file.publicId, file.format, {
    resource_type: "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 300,
    attachment: false
  });
}

function markdownSummary(profile) {
  const lines = [
    `# Hồ sơ hợp đồng ${profile.employeeId}`,
    "",
    `- Nhân sự: ${profile.employeeName}`,
    `- Vai trò: ${profile.role}`,
    `- Mã hợp đồng: ${profile.contractCode}`,
    `- Gmail: ${profile.gmail}`,
    `- Ngày sinh: ${profile.dateOfBirth}`,
    `- CCCD: ${profile.citizenId}`,
    `- Ngày cấp: ${profile.citizenIdIssuedDate}`,
    `- Nơi cấp: ${profile.citizenIdIssuedPlace}`,
    `- STK: ${profile.bankAccountNumber}`,
    `- Bank: ${profile.bankName}`,
    `- Hoàn tất: ${profile.completed ? "Có" : "Không"}`,
    `- Cập nhật lần cuối: ${formatIso(profile.updatedAt)}`,
    ""
  ];

  if (profile.permanentAddress) {
    lines.push("## Thường trú", "", profile.permanentAddress, "");
  }
  if (profile.temporaryAddress) {
    lines.push("## Tạm trú", "", profile.temporaryAddress, "");
  }
  return lines.join("\n");
}

function loadState(statePath) {
  try {
    if (!fs.existsSync(statePath)) return { items: {} };
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return state && typeof state === "object" && state.items ? state : { items: {} };
  } catch {
    return { items: {} };
  }
}

function saveState(statePath, state) {
  mkdirp(path.dirname(statePath));
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

async function withTempUploadFile(media, executeRequest) {
  if (!media?.body) return executeRequest();

  const tempDir = path.join(programRoot, ".tmp");
  mkdirp(tempDir);
  const tempPath = path.join(tempDir, `${Date.now()}-${crypto.randomUUID()}`);
  fs.writeFileSync(tempPath, media.body);

  try {
    return await executeRequest({
      path: tempPath,
      mimeType: media.mimeType
    });
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function buildGwsError(config, args, error) {
  const stderr = String(error?.stderr || "").trim();
  const stdout = String(error?.stdout || "").trim();
  const detail = stderr || stdout || error?.message || "unknown error";
  return new Error(`GWS CLI lỗi (${path.basename(config.gwsPath)} ${args.join(" ")}): ${detail}`);
}

async function runGwsJson(config, args) {
  try {
    const { stdout } = await execFileAsync(config.gwsPath, [...args, "--format", "json"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });
    const output = stdout.trim();
    return output ? JSON.parse(output) : {};
  } catch (error) {
    throw buildGwsError(config, args, error);
  }
}

async function createMongoClient(config) {
  const client = new MongoClient(config.mongodbUri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8000
  });
  await client.connect();
  return client;
}

async function createDriveClient(config) {
  const driveFilesRequest = async (method, {
    params,
    requestBody,
    media
  } = {}) => {
    const args = ["drive", "files", method];
    const normalizedParams = compactObject(params);
    const normalizedBody = compactObject(requestBody);

    if (Object.keys(normalizedParams).length > 0) {
      args.push("--params", JSON.stringify(normalizedParams));
    }
    if (Object.keys(normalizedBody).length > 0) {
      args.push("--json", JSON.stringify(normalizedBody));
    }
    if (media?.path) {
      args.push("--upload", media.path);
      if (media.mimeType) {
        args.push("--upload-content-type", media.mimeType);
      }
    }

    return { data: await runGwsJson(config, args) };
  };

  return {
    files: {
      get: (params) => driveFilesRequest("get", { params }),
      list: (params) => driveFilesRequest("list", { params }),
      create: ({ requestBody, media, ...params }) => withTempUploadFile(
        media,
        (upload) => driveFilesRequest("create", {
          params,
          requestBody,
          media: upload
        })
      ),
      update: ({ requestBody, media, ...params }) => withTempUploadFile(
        media,
        (upload) => driveFilesRequest("update", {
          params,
          requestBody,
          media: upload
        })
      )
    }
  };
}

async function assertRootFolderAccessible(drive, folderId) {
  await drive.files.get({
    fileId: folderId,
    fields: "id,name,mimeType",
    supportsAllDrives: true
  });
}

function toSerializable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toSerializable(item));
  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toSerializable(item)])
    );
  }
  return value;
}

function escapeDriveQuery(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildTargetId(target) {
  return String(target.employeeId || target.key || "").trim();
}

function buildFolderDisplayName(target) {
  return safeFolderName(`${buildTargetId(target)} - ${target.employeeName || "Chưa rõ tên"}`);
}

function buildContractPayload(contract) {
  if (!contract) return null;
  return {
    employeeId: contract.employeeId,
    employeeName: contract.employeeName,
    role: contract.role,
    contractCode: contract.contractCode,
    gmail: contract.gmail,
    dateOfBirth: contract.dateOfBirth,
    citizenId: contract.citizenId,
    citizenIdIssuedDate: contract.citizenIdIssuedDate,
    citizenIdIssuedPlace: contract.citizenIdIssuedPlace,
    permanentAddress: contract.permanentAddress,
    temporaryAddress: contract.temporaryAddress,
    bankAccountNumber: contract.bankAccountNumber,
    bankName: contract.bankName,
    completed: contract.completed,
    submittedAt: formatIso(contract.submittedAt),
    updatedAt: formatIso(contract.updatedAt),
    citizenIdFront: contract.citizenIdFront || null,
    citizenIdBack: contract.citizenIdBack || null
  };
}

function buildCvReferenceContent(target) {
  const lines = [];
  if (target.person?.cvReference) lines.push(`schedule_people.cvReference=${target.person.cvReference}`);
  if (target.recruitment?.cvUrl) lines.push(`recruitment_profiles.cvUrl=${target.recruitment.cvUrl}`);
  if (target.application?.cvUrl) lines.push(`people_applications.cvUrl=${target.application.cvUrl}`);
  return lines.join("\n");
}

function buildSummaryMarkdown(target) {
  const lines = [
    `# Hồ sơ nhân sự ${buildTargetId(target)}`,
    "",
    `- Nhân sự: ${target.employeeName || buildTargetId(target)}`,
    `- Vai trò: ${target.role || "chưa rõ"}`,
    `- Sync stamp: ${target.updatedAt || "chưa có"}`,
    `- Có people: ${target.person ? "Có" : "Không"}`,
    `- Có contract: ${target.contract ? "Có" : "Không"}`,
    `- Có recruitment: ${target.recruitment ? "Có" : "Không"}`,
    `- Có application: ${target.application ? "Có" : "Không"}`,
    `- Có support training: ${target.supportTraining ? "Có" : "Không"}`,
    `- CV reference: ${deriveCvReference(target) || "Không có"}`,
    ""
  ];

  if (target.person) {
    lines.push(
      "## People",
      "",
      `- Tên: ${target.person.name || target.employeeName || ""}`,
      `- Phone: ${target.person.phone || "Không có"}`,
      `- Level: ${target.person.level || "Không có"}`,
      `- Cash offer: ${target.person.cashOffer || "Không có"}`,
      `- Cập nhật: ${formatIso(target.person.updatedAt)}`,
      ""
    );
  }

  if (target.contract) {
    lines.push(
      "## Contract",
      "",
      `- Mã hợp đồng: ${target.contract.contractCode || "Không có"}`,
      `- Gmail: ${target.contract.gmail || "Không có"}`,
      `- Hoàn tất: ${target.contract.completed ? "Có" : "Không"}`,
      `- Cập nhật: ${formatIso(target.contract.updatedAt)}`,
      ""
    );
  }

  if (target.recruitment) {
    lines.push(
      "## Recruitment",
      "",
      `- Họ tên: ${target.recruitment.fullName || target.employeeName || ""}`,
      `- Tên gọi khác: ${target.recruitment.aliasName || "Không có"}`,
      `- Phone: ${target.recruitment.phone || "Không có"}`,
      `- Email: ${target.recruitment.email || "Không có"}`,
      `- Level: ${target.recruitment.level || "Không có"}`,
      `- Rating: ${target.recruitment.rating || "Không có"}`,
      `- Salary offered: ${target.recruitment.salaryOffered || "Không có"}`,
      `- Source tab: ${target.recruitment.sourceTab || "Không có"}`,
      `- Updated: ${formatIso(target.recruitment.updatedAt)}`,
      ""
    );
  }

  if (target.application) {
    lines.push(
      "## Application",
      "",
      `- Họ tên: ${target.application.fullName || target.employeeName || ""}`,
      `- Phone: ${target.application.phone || "Không có"}`,
      `- Email: ${target.application.email || "Không có"}`,
      `- Trạng thái: ${target.application.status || "Không có"}`,
      `- Submitted: ${formatIso(target.application.submittedAt)}`,
      `- Updated: ${formatIso(target.application.updatedAt)}`,
      ""
    );
  }

  if (target.supportTraining) {
    lines.push(
      "## Support Training",
      "",
      `- Nhân sự: ${target.supportTraining.employeeName || target.employeeName || ""}`,
      `- Rating: ${target.supportTraining.rating || "Không có"}`,
      `- Score: ${target.supportTraining.scorePercent ?? "Không có"}%`,
      `- Cash offer: ${target.supportTraining.cashOffer || "Không có"}`,
      `- Passed: ${target.supportTraining.passed ? "Có" : "Không"}`,
      `- Completed: ${formatIso(target.supportTraining.completedAt) || "Chưa có"}`,
      `- Updated: ${formatIso(target.supportTraining.updatedAt)}`,
      ""
    );
  }

  return lines.join("\n");
}

function remoteMimeExtension(contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (normalized === "application/pdf") return "pdf";
  if (normalized === "application/msword") return "doc";
  if (normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "text/plain") return "txt";
  return "";
}

function extensionFromUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\.([a-zA-Z0-9]{1,8})$/);
    return match ? match[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

async function downloadRemoteFile(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Tải CV thất bại: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().startsWith("text/html")) {
    throw new Error("CV URL trả về HTML, chỉ lưu link tham chiếu.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("CV URL không trả về dữ liệu.");

  const extension = remoteMimeExtension(contentType) || extensionFromUrl(url) || "bin";
  return {
    buffer,
    fileName: `cv.${extension}`,
    contentType: contentType.split(";")[0].trim().toLowerCase() || mimeTypeForExtension(extension)
  };
}

async function listSyncTargets(db, employeeId) {
  const personFilter = employeeId ? { employeeId: employeeId.toUpperCase() } : {};
  const contractFilter = employeeId ? { employeeId: employeeId.toUpperCase() } : {};
  const recruitmentFilter = employeeId ? { employeeId: employeeId.toUpperCase() } : {};
  const applicationFilter = employeeId ? { employeeId: employeeId.toUpperCase() } : {};
  const supportTrainingFilter = employeeId ? { employeeId: employeeId.toUpperCase() } : {};
  const [people, contracts, recruitmentProfiles, applications, supportTrainingProfiles] = await Promise.all([
    db.collection("schedule_people").find(personFilter).sort({ updatedAt: 1, employeeId: 1 }).toArray(),
    db.collection("employee_contract_profiles").find(contractFilter).sort({ updatedAt: 1, employeeId: 1 }).toArray(),
    db.collection("recruitment_profiles").find(recruitmentFilter).sort({ updatedAt: 1, employeeId: 1 }).toArray(),
    db.collection("people_applications").find(applicationFilter).sort({ updatedAt: 1, employeeId: 1 }).toArray(),
    db.collection("support_training_profiles").find(supportTrainingFilter).sort({ updatedAt: 1, employeeId: 1 }).toArray()
  ]);

  return buildSyncTargets({
    people,
    contracts,
    recruitmentProfiles,
    applications,
    supportTrainingProfiles,
    employeeId
  });
}

async function ensureEmployeeFolder(drive, rootFolderId, target, dryRun) {
  const employeeId = buildTargetId(target);
  const syncKey = target.key;
  const identifierClause = employeeId
    ? `appProperties has { key='employeeId' and value='${escapeDriveQuery(employeeId)}' }`
    : `appProperties has { key='syncKey' and value='${escapeDriveQuery(syncKey)}' }`;
  const response = await drive.files.list({
    q: [
      `'${rootFolderId}' in parents`,
      "trashed = false",
      "mimeType = 'application/vnd.google-apps.folder'",
      identifierClause
    ].join(" and "),
    fields: "files(id,name)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  if (response.data.files?.[0]?.id) return response.data.files[0].id;
  if (dryRun) return `dry-run-folder-${employeeId}`;

  const created = await drive.files.create({
    requestBody: {
      name: buildFolderDisplayName(target),
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
      appProperties: {
        syncKind: "employee_profile",
        syncKey,
        employeeId,
        role: target.role || ""
      }
    },
    fields: "id",
    supportsAllDrives: true
  });
  if (!created.data.id) throw new Error(`Không tạo được folder cho ${employeeId}.`);
  return created.data.id;
}

async function findChildByName(drive, parentId, fileName) {
  const response = await drive.files.list({
    q: [
      `'${parentId}' in parents`,
      "trashed = false",
      `name = '${fileName.replace(/'/g, "\\'")}'`
    ].join(" and "),
    fields: "files(id,name,appProperties)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return response.data.files?.[0] || null;
}

function isVirtualDryRunFolderId(value) {
  return String(value || "").startsWith("dry-run-folder-");
}

async function upsertTextFile(drive, parentId, fileName, content, dryRun) {
  if (dryRun && isVirtualDryRunFolderId(parentId)) {
    return { action: "create", fileId: "" };
  }
  const existing = await findChildByName(drive, parentId, fileName);
  const contentHash = sha1(content);
  if (existing?.appProperties?.contentHash === contentHash) {
    return { action: "skip", fileId: existing.id || "" };
  }
  if (dryRun) {
    return { action: existing ? "update" : "create", fileId: existing?.id || "" };
  }

  const media = {
    mimeType: mimeTypeForExtension(path.extname(fileName).slice(1).toLowerCase()),
    body: Buffer.from(content, "utf8")
  };
  if (existing?.id) {
    await drive.files.update({
      fileId: existing.id,
      media,
      requestBody: { appProperties: { contentHash } },
      supportsAllDrives: true
    });
    return { action: "update", fileId: existing.id };
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId],
      appProperties: { contentHash }
    },
    media,
    fields: "id",
    supportsAllDrives: true
  });
  return { action: "create", fileId: created.data.id || "" };
}

async function downloadToBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Tải ảnh Cloudinary thất bại: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function upsertBinaryFile(drive, parentId, fileName, buffer, source, dryRun) {
  if (dryRun && isVirtualDryRunFolderId(parentId)) {
    return { action: "create", fileId: "" };
  }
  const existing = await findChildByName(drive, parentId, fileName);
  const contentHash = sha1(buffer);
  const appProperties = {
    contentHash,
    ...Object.fromEntries(
      Object.entries(source?.appProperties || {})
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => [key, String(value)])
    )
  };
  if (
    existing?.appProperties?.contentHash === contentHash
    && Object.entries(appProperties)
      .every(([key, value]) => existing?.appProperties?.[key] === value)
  ) {
    return { action: "skip", fileId: existing.id || "" };
  }
  if (dryRun) {
    return { action: existing ? "update" : "create", fileId: existing?.id || "" };
  }

  const media = {
    mimeType: mimeTypeForExtension(source.format),
    body: buffer
  };
  if (existing?.id) {
    await drive.files.update({
      fileId: existing.id,
      media,
      requestBody: {
        description: source.description || fileName,
        appProperties
      },
      supportsAllDrives: true
    });
    return { action: "update", fileId: existing.id };
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId],
      description: source.description || fileName,
      appProperties
    },
    media,
    fields: "id",
    supportsAllDrives: true
  });
  return { action: "create", fileId: created.data.id || "" };
}

async function syncTarget(drive, target, config) {
  const folderId = await ensureEmployeeFolder(drive, config.rootFolderId, target, config.dryRun);
  const files = [];
  const warnings = [];

  if (target.person) {
    files.push({
      name: "person-profile.json",
      ...(await upsertTextFile(drive, folderId, "person-profile.json", JSON.stringify(toSerializable(target.person), null, 2), config.dryRun))
    });
  }

  if (target.contract) {
    files.push({
      name: "contract-profile.json",
      ...(await upsertTextFile(drive, folderId, "contract-profile.json", JSON.stringify(buildContractPayload(target.contract), null, 2), config.dryRun))
    });
  }

  if (target.recruitment) {
    files.push({
      name: "recruitment-profile.json",
      ...(await upsertTextFile(drive, folderId, "recruitment-profile.json", JSON.stringify(toSerializable(target.recruitment), null, 2), config.dryRun))
    });
  }

  if (target.application) {
    files.push({
      name: "application-profile.json",
      ...(await upsertTextFile(drive, folderId, "application-profile.json", JSON.stringify(toSerializable(target.application), null, 2), config.dryRun))
    });
  }

  if (target.supportTraining) {
    files.push({
      name: "support-training-profile.json",
      ...(await upsertTextFile(drive, folderId, "support-training-profile.json", JSON.stringify(toSerializable(target.supportTraining), null, 2), config.dryRun))
    });
  }

  const cvReferenceContent = buildCvReferenceContent(target);
  if (cvReferenceContent) {
    files.push({
      name: "cv-reference.txt",
      ...(await upsertTextFile(drive, folderId, "cv-reference.txt", cvReferenceContent, config.dryRun))
    });
  }

  files.push({
    name: "README.md",
    ...(await upsertTextFile(drive, folderId, "README.md", buildSummaryMarkdown(target), config.dryRun))
  });

  if (target.contract) {
    for (const side of ["front", "back"]) {
      const source = side === "front" ? target.contract.citizenIdFront : target.contract.citizenIdBack;
      if (!source?.publicId || !source?.format) continue;
      const fileName = `cccd-${side}.${source.format}`;
      const buffer = await downloadToBuffer(buildCloudinaryDownloadUrl(source));
      files.push({
        name: fileName,
        ...(await upsertBinaryFile(drive, folderId, fileName, buffer, {
          description: source.originalFilename || fileName,
          appProperties: {
            sourceKind: "cloudinary",
            publicId: source.publicId,
            version: String(source.version || 0)
          }
        }, config.dryRun))
      });
    }
  }

  const cvUrl = deriveCvReference(target);
  if (isHttpUrl(cvUrl)) {
    try {
      const remote = await downloadRemoteFile(cvUrl);
      files.push({
        name: remote.fileName,
        ...(await upsertBinaryFile(drive, folderId, remote.fileName, remote.buffer, {
          description: cvUrl,
          appProperties: {
            sourceKind: "cv_url",
            sourceHash: sha1(cvUrl),
            contentType: remote.contentType
          }
        }, config.dryRun))
      });
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { folderId, files, warnings };
}

function shouldSync(state, target) {
  return state.items?.[target.key] !== target.updatedAt;
}

function markSynced(state, target) {
  state.items[target.key] = target.updatedAt;
}

async function runOnce(config, cli) {
  const state = loadState(config.statePath);
  const mongoClient = await createMongoClient(config);
  const drive = await createDriveClient(config);

  try {
    await assertRootFolderAccessible(drive, config.rootFolderId);
    const db = mongoClient.db(config.mongoDbName);
    const targets = (await listSyncTargets(db, cli.employeeId))
      .filter((target) => shouldSync(state, target));

    if (targets.length === 0) {
      console.log("[Local programming] Không có hồ sơ people / contract / cv mới cần sync.");
      return;
    }

    console.log(`[Local programming] Có ${targets.length} hồ sơ nhân sự cần sync lên Drive.`);
    for (const target of targets) {
      const result = await syncTarget(drive, target, config);
      const summary = result.files
        .filter((item) => item.action !== "skip")
        .map((item) => `${item.name}:${item.action}`)
        .join(", ") || "không đổi";
      const warningSuffix = result.warnings.length > 0 ? ` | cảnh báo: ${result.warnings.join(" ; ")}` : "";
      console.log(`[Local programming] ${buildTargetId(target)} -> ${result.folderId} | ${summary}${warningSuffix}`);
      if (!config.dryRun) markSynced(state, target);
    }

    if (!config.dryRun) {
      state.lastRunAt = new Date().toISOString();
      saveState(config.statePath, state);
    }
  } finally {
    await mongoClient.close();
  }
}

function buildConfig(cli) {
  loadLocalProgramEnv();
  const localConfig = buildLocalProgramEnv();
  cloudinary.config({
    secure: true,
    ...parseCloudinaryUrl(localConfig.cloudinaryUrl)
  });

  return {
    ...localConfig,
    dryRun: cli.dryRun,
    intervalMinutes: cli.intervalMinutes || localConfig.intervalMinutes
  };
}

function parseCloudinaryUrl(value) {
  const cleaned = String(value || "").trim();
  const match = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(cleaned);
  if (!match) {
    throw new Error("LOCAL_CONTRACT_SYNC_CLOUDINARY_URL không hợp lệ.");
  }
  return {
    api_key: decodeURIComponent(match[1]),
    api_secret: decodeURIComponent(match[2]),
    cloud_name: decodeURIComponent(match[3])
  };
}

async function main() {
  const cli = parseArgs(process.argv);
  if (cli.help) {
    printHelp();
    return;
  }

  const config = buildConfig(cli);
  if (!cli.watch) {
    await runOnce(config, cli);
    return;
  }

  console.log(`[Local programming] Chạy watch mode mỗi ${config.intervalMinutes} phút.`);
  while (true) {
    const startedAt = Date.now();
    try {
      await runOnce(config, cli);
    } catch (error) {
      console.error(`[Local programming] Sync lỗi: ${error instanceof Error ? error.message : String(error)}`);
    }
    const elapsed = Date.now() - startedAt;
    const sleepMs = Math.max(config.intervalMinutes * 60 * 1000 - elapsed, 5_000);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

main().catch((error) => {
  console.error(`[Local programming] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
