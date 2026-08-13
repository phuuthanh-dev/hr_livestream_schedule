import { randomUUID } from "crypto";
import { v2 as cloudinary } from "cloudinary";
import type { EmployeeContractDocumentSide, EmployeeContractFile } from "@/lib/employeeContract";
import { validateEmployeeContractImageInput } from "@/lib/employeeContractValidation";
import type { EmployeeRole } from "@/lib/types";

type CloudinaryAsset = {
  public_id?: string;
  resource_type?: string;
  type?: string;
  format?: string;
  version?: number;
  bytes?: number;
};

function getCloudinaryConfiguration() {
  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new Error("Cloudinary chưa được cấu hình trên máy chủ.");
  }
  return {
    cloudName: String(config.cloud_name),
    apiKey: String(config.api_key),
    apiSecret: String(config.api_secret)
  };
}

function safePathSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "employee";
}

function contractImagePrefix(role: EmployeeRole, employeeId: string, side: EmployeeContractDocumentSide) {
  return `hr-contracts/${role}/${safePathSegment(employeeId)}/${side}-`;
}

function contentTypeForFormat(format: string) {
  if (format === "jpg" || format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "";
}

export function createContractUploadSignature(input: {
  role: EmployeeRole;
  employeeId: string;
  side: EmployeeContractDocumentSide;
  contentType: unknown;
  size: unknown;
}) {
  validateEmployeeContractImageInput({ contentType: input.contentType, size: input.size });
  const config = getCloudinaryConfiguration();
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${contractImagePrefix(input.role, input.employeeId, input.side)}${randomUUID()}`;
  const allowedFormats = "jpg,jpeg,png,webp";
  const signature = cloudinary.utils.api_sign_request({
    allowed_formats: allowedFormats,
    public_id: publicId,
    timestamp,
    type: "authenticated"
  }, config.apiSecret);

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    allowedFormats,
    publicId,
    timestamp,
    signature,
    deliveryType: "authenticated" as const
  };
}

export async function verifyUploadedContractImage(input: {
  publicId: string;
  role: EmployeeRole;
  employeeId: string;
  side: EmployeeContractDocumentSide;
  originalFilename: string;
}): Promise<Omit<EmployeeContractFile, "uploadedAt">> {
  getCloudinaryConfiguration();
  if (!input.publicId.startsWith(contractImagePrefix(input.role, input.employeeId, input.side))) {
    throw new Error("Tài liệu CCCD không thuộc hồ sơ này.");
  }

  const asset = await cloudinary.api.resource(input.publicId, {
    resource_type: "image",
    type: "authenticated"
  }) as CloudinaryAsset;
  const format = String(asset.format || "").toLowerCase();
  const bytes = Number(asset.bytes || 0);
  try {
    validateEmployeeContractImageInput({ contentType: contentTypeForFormat(format), size: bytes });
    if (asset.public_id !== input.publicId || asset.resource_type !== "image" || asset.type !== "authenticated") {
      throw new Error("Cloudinary trả về tài liệu không đúng chế độ bảo mật.");
    }
  } catch (error) {
    await deleteContractImage(input.publicId).catch(() => undefined);
    throw error;
  }

  return {
    publicId: input.publicId,
    format,
    version: Number(asset.version || 0),
    bytes,
    originalFilename: input.originalFilename.trim().slice(0, 240) || `cccd-${input.side}.${format}`
  };
}

export function getContractImageDownloadUrl(file: EmployeeContractFile) {
  getCloudinaryConfiguration();
  return cloudinary.utils.private_download_url(file.publicId, file.format, {
    resource_type: "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
    attachment: false
  });
}

export async function deleteContractImage(publicId: string) {
  getCloudinaryConfiguration();
  await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "authenticated",
    invalidate: true
  });
}
