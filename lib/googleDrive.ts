import { google } from "googleapis";
import { createGoogleJwt } from "@/lib/googleAuth";

const GOOGLE_DRIVE_SCOPE = ["https://www.googleapis.com/auth/drive"];
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type DriveFileMetadata = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
};

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function getContractDriveRootFolderId() {
  return process.env.GOOGLE_DRIVE_CONTRACT_FOLDER_ID?.trim()
    || process.env.LOCAL_CONTRACT_SYNC_FOLDER_ID?.trim()
    || readRequiredEnv("GOOGLE_DRIVE_CONTRACT_ROOT_FOLDER_ID");
}

export function createGoogleDriveClient() {
  const auth = createGoogleJwt(GOOGLE_DRIVE_SCOPE);
  return google.drive({
    version: "v3",
    auth
  });
}

export async function findDriveChildByName(input: {
  drive: ReturnType<typeof createGoogleDriveClient>;
  parentId: string;
  fileName: string;
}) {
  const response = await input.drive.files.list({
    q: [
      `'${input.parentId}' in parents`,
      `name='${escapeDriveQuery(input.fileName)}'`,
      "trashed=false"
    ].join(" and "),
    fields: "files(id,name,mimeType)",
    pageSize: 5,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });
  return response.data.files?.[0] || null;
}

export async function ensureEmployeeDriveFolder(input: {
  drive: ReturnType<typeof createGoogleDriveClient>;
  rootFolderId: string;
  employeeId: string;
  folderName: string;
  role: string;
}) {
  const employeeId = input.employeeId.trim();
  const listResponse = await input.drive.files.list({
    q: [
      `'${input.rootFolderId}' in parents`,
      "trashed=false",
      `appProperties has { key='employeeId' and value='${escapeDriveQuery(employeeId)}' }`
    ].join(" and "),
    fields: "files(id,name,mimeType)",
    pageSize: 5,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });
  const existing = listResponse.data.files?.[0];
  if (existing?.id) {
    if (existing.name !== input.folderName) {
      await input.drive.files.update({
        fileId: existing.id,
        requestBody: { name: input.folderName },
        fields: "id,name",
        supportsAllDrives: true
      });
    }
    return existing.id;
  }

  const created = await input.drive.files.create({
    requestBody: {
      name: input.folderName,
      mimeType: FOLDER_MIME_TYPE,
      parents: [input.rootFolderId],
      appProperties: {
        employeeId,
        role: input.role
      }
    },
    fields: "id",
    supportsAllDrives: true
  });
  if (!created.data.id) throw new Error("Không tạo được folder hồ sơ nhân sự trên Google Drive.");
  return created.data.id;
}

export async function upsertDriveTextFile(input: {
  drive: ReturnType<typeof createGoogleDriveClient>;
  parentId: string;
  fileName: string;
  content: string;
  mimeType?: string;
}) {
  const mimeType = input.mimeType || "application/json; charset=utf-8";
  const existing = await findDriveChildByName({
    drive: input.drive,
    parentId: input.parentId,
    fileName: input.fileName
  });
  if (existing?.id) {
    await input.drive.files.update({
      fileId: existing.id,
      media: {
        mimeType,
        body: Buffer.from(input.content, "utf8")
      },
      requestBody: {
        name: input.fileName
      },
      fields: "id",
      supportsAllDrives: true
    });
    return existing.id;
  }

  const created = await input.drive.files.create({
    requestBody: {
      name: input.fileName,
      parents: [input.parentId]
    },
    media: {
      mimeType,
      body: Buffer.from(input.content, "utf8")
    },
    fields: "id",
    supportsAllDrives: true
  });
  if (!created.data.id) throw new Error(`Không tạo được file ${input.fileName} trên Drive.`);
  return created.data.id;
}

export async function upsertDriveBinaryFile(input: {
  drive: ReturnType<typeof createGoogleDriveClient>;
  parentId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const existing = await findDriveChildByName({
    drive: input.drive,
    parentId: input.parentId,
    fileName: input.fileName
  });
  if (existing?.id) {
    await input.drive.files.update({
      fileId: existing.id,
      media: {
        mimeType: input.mimeType,
        body: input.buffer
      },
      requestBody: {
        name: input.fileName
      },
      fields: "id",
      supportsAllDrives: true
    });
    return existing.id;
  }

  const created = await input.drive.files.create({
    requestBody: {
      name: input.fileName,
      parents: [input.parentId]
    },
    media: {
      mimeType: input.mimeType,
      body: input.buffer
    },
    fields: "id",
    supportsAllDrives: true
  });
  if (!created.data.id) throw new Error(`Không tạo được file ${input.fileName} trên Drive.`);
  return created.data.id;
}
