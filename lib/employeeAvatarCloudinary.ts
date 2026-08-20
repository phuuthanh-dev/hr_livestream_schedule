import { randomUUID } from "crypto";
import { v2 as cloudinary } from "cloudinary";
import type { EmployeeRole } from "@/lib/types";

export type EmployeeAvatarAsset = {
  publicId: string;
  format: string;
  version: number;
  bytes: number;
  updatedAt: Date;
};

type CloudinaryAsset = {
  public_id?: string;
  resource_type?: string;
  type?: string;
  format?: string;
  version?: number;
  bytes?: number;
};

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function getCloudinaryConfiguration() {
  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new Error("Cloudinary chưa được cấu hình trên máy chủ.");
  }
  return { apiKey: String(config.api_key), apiSecret: String(config.api_secret), cloudName: String(config.cloud_name) };
}

function safePathSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "employee";
}

function avatarPrefix(role: EmployeeRole, employeeId: string) {
  return `hr-avatars/${role}/${safePathSegment(employeeId)}/avatar-`;
}

function contentTypeForFormat(format: string) {
  if (format === "jpg" || format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "";
}

export function validateEmployeeAvatarInput(input: { contentType: unknown; size: unknown }) {
  if (!ALLOWED_TYPES.has(String(input.contentType ?? ""))) {
    throw new Error("Avatar chỉ nhận định dạng JPEG, PNG hoặc WebP.");
  }
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) throw new Error("Tệp avatar đang trống.");
  if (size > MAX_AVATAR_BYTES) throw new Error("Avatar không được vượt quá 5 MB.");
}

export function createEmployeeAvatarUploadSignature(input: {
  role: EmployeeRole;
  employeeId: string;
  contentType: unknown;
  size: unknown;
}) {
  validateEmployeeAvatarInput(input);
  const config = getCloudinaryConfiguration();
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${avatarPrefix(input.role, input.employeeId)}${randomUUID()}`;
  const allowedFormats = "jpg,jpeg,png,webp";
  const signature = cloudinary.utils.api_sign_request({
    allowed_formats: allowedFormats,
    public_id: publicId,
    timestamp,
    type: "upload"
  }, config.apiSecret);

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    apiKey: config.apiKey,
    allowedFormats,
    publicId,
    timestamp,
    signature,
    deliveryType: "upload" as const
  };
}

export async function verifyEmployeeAvatar(input: {
  publicId: string;
  role: EmployeeRole;
  employeeId: string;
}): Promise<Omit<EmployeeAvatarAsset, "updatedAt">> {
  getCloudinaryConfiguration();
  if (!input.publicId.startsWith(avatarPrefix(input.role, input.employeeId))) {
    throw new Error("Avatar không thuộc hồ sơ nhân viên này.");
  }
  const asset = await cloudinary.api.resource(input.publicId, { resource_type: "image", type: "upload" }) as CloudinaryAsset;
  const format = String(asset.format || "").toLowerCase();
  const bytes = Number(asset.bytes || 0);
  try {
    validateEmployeeAvatarInput({ contentType: contentTypeForFormat(format), size: bytes });
    if (asset.public_id !== input.publicId || asset.resource_type !== "image" || asset.type !== "upload") {
      throw new Error("Cloudinary trả về avatar không hợp lệ.");
    }
  } catch (error) {
    await deleteEmployeeAvatar(input.publicId).catch(() => undefined);
    throw error;
  }
  return { publicId: input.publicId, format, version: Number(asset.version || 0), bytes };
}

export function getEmployeeAvatarUrl(asset: Pick<EmployeeAvatarAsset, "publicId" | "version">) {
  getCloudinaryConfiguration();
  return cloudinary.url(asset.publicId, {
    resource_type: "image",
    type: "upload",
    version: asset.version || undefined,
    secure: true,
    transformation: [
      { width: 240, height: 240, crop: "fill", gravity: "face" },
      { quality: "auto", fetch_format: "auto" }
    ]
  });
}

export async function deleteEmployeeAvatar(publicId: string) {
  getCloudinaryConfiguration();
  await cloudinary.uploader.destroy(publicId, { resource_type: "image", type: "upload", invalidate: true });
}
