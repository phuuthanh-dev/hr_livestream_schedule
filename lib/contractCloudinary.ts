import { randomUUID } from "crypto";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import type { EmployeeContractDocumentSide, EmployeeContractFile } from "@/lib/employeeContract";
import type { EmployeeRole } from "@/lib/types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function assertCloudinaryConfigured() {
  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new Error("Cloudinary chưa được cấu hình trên máy chủ.");
  }
}

function safePathSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "employee";
}

export function validateContractImage(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Ảnh CCCD chỉ nhận định dạng JPEG, PNG hoặc WebP.");
  }
  if (file.size <= 0) throw new Error("Tệp CCCD đang trống.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Mỗi ảnh CCCD không được vượt quá 10 MB.");
}

export async function uploadContractImage(input: {
  file: File;
  role: EmployeeRole;
  employeeId: string;
  side: EmployeeContractDocumentSide;
}): Promise<Omit<EmployeeContractFile, "uploadedAt">> {
  assertCloudinaryConfigured();
  validateContractImage(input.file);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const publicId = [
    "hr-contracts",
    input.role,
    safePathSegment(input.employeeId),
    `${input.side}-${randomUUID()}`
  ].join("/");

  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "image",
      type: "authenticated",
      public_id: publicId,
      overwrite: false
    }, (error, response) => {
      if (error || !response) reject(error || new Error("Cloudinary không trả về kết quả upload."));
      else resolve(response);
    });
    stream.end(bytes);
  });

  return {
    publicId: result.public_id,
    format: result.format,
    version: result.version,
    bytes: result.bytes,
    originalFilename: input.file.name.slice(0, 240)
  };
}

export function getContractImageDownloadUrl(file: EmployeeContractFile) {
  assertCloudinaryConfigured();
  return cloudinary.utils.private_download_url(file.publicId, file.format, {
    resource_type: "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
    attachment: false
  });
}

export async function deleteContractImage(publicId: string) {
  assertCloudinaryConfigured();
  await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "authenticated",
    invalidate: true
  });
}
