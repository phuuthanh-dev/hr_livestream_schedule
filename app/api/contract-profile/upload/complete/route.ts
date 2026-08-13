import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { deleteContractImage, verifyUploadedContractImage } from "@/lib/contractCloudinary";
import {
  getEmployeeContractProfile,
  saveEmployeeContractFile,
  type EmployeeContractDocumentSide
} from "@/lib/employeeContract";
import { resolveEmployeeContractPerson } from "@/lib/employeeContractAccess";

export const runtime = "nodejs";

function readSide(value: unknown): EmployeeContractDocumentSide | null {
  return value === "front" || value === "back" ? value : null;
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });

  let uploadedPublicId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    const side = readSide(body.side);
    const publicId = String(body.publicId ?? "").trim();
    if (!side || !publicId) {
      return NextResponse.json({ success: false, message: "Thiếu thông tin ảnh CCCD đã tải." }, { status: 400 });
    }

    const person = await resolveEmployeeContractPerson({ session, role: body.role, employeeId: body.employeeId });
    if (!person) return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên." }, { status: 404 });

    const existing = await getEmployeeContractProfile(person.role, person.id);
    if (!existing) {
      return NextResponse.json({ success: false, message: "Hãy lưu thông tin hợp đồng trước khi tải CCCD." }, { status: 409 });
    }
    const currentFile = side === "front" ? existing.citizenIdFront : existing.citizenIdBack;
    if (currentFile?.publicId === publicId) {
      return NextResponse.json({ success: true, profile: existing, message: "Ảnh CCCD đã được ghi nhận." });
    }

    const file = await verifyUploadedContractImage({
      publicId,
      role: person.role,
      employeeId: person.id,
      side,
      originalFilename: String(body.originalFilename ?? "")
    });
    uploadedPublicId = file.publicId;
    const result = await saveEmployeeContractFile({
      role: person.role,
      employeeId: person.id,
      side,
      file,
      actorAccountKey: session.accountKey
    });
    uploadedPublicId = "";

    if (result.replacedFile?.publicId && result.replacedFile.publicId !== file.publicId) {
      await deleteContractImage(result.replacedFile.publicId).catch((error) => {
        console.error("Could not remove replaced contract image", error instanceof Error ? error.message : "Unknown error");
      });
    }

    return NextResponse.json({
      success: true,
      profile: result.profile,
      message: `Đã tải ${side === "front" ? "mặt trước" : "mặt sau"} CCCD.`
    });
  } catch (error) {
    if (uploadedPublicId) await deleteContractImage(uploadedPublicId).catch(() => undefined);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không xác nhận được ảnh CCCD."
    }, { status: 400 });
  }
}
