import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import {
  deleteContractImage,
  uploadContractImage
} from "@/lib/contractCloudinary";
import {
  getEmployeeContractProfile,
  saveEmployeeContractFile,
  type EmployeeContractDocumentSide
} from "@/lib/employeeContract";
import { resolveEmployeeContractPerson } from "@/lib/employeeContractAccess";

export const runtime = "nodejs";

function readSide(value: FormDataEntryValue | null): EmployeeContractDocumentSide | null {
  return value === "front" || value === "back" ? value : null;
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });
  }

  let uploadedPublicId = "";
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const side = readSide(formData.get("side"));
    if (!(file instanceof File) || !side) {
      return NextResponse.json({ success: false, message: "Thiếu ảnh hoặc mặt CCCD cần tải." }, { status: 400 });
    }

    const person = await resolveEmployeeContractPerson({
      session,
      role: formData.get("role"),
      employeeId: formData.get("employeeId")
    });
    if (!person) {
      return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên cần cập nhật." }, { status: 404 });
    }

    const existing = await getEmployeeContractProfile(person.role, person.id);
    if (!existing) {
      return NextResponse.json({ success: false, message: "Hãy lưu thông tin hợp đồng trước khi tải CCCD." }, { status: 409 });
    }

    const uploaded = await uploadContractImage({ file, side, role: person.role, employeeId: person.id });
    uploadedPublicId = uploaded.publicId;
    const result = await saveEmployeeContractFile({
      role: person.role,
      employeeId: person.id,
      side,
      file: uploaded,
      actorAccountKey: session.accountKey
    });
    uploadedPublicId = "";

    if (result.replacedFile?.publicId) {
      void deleteContractImage(result.replacedFile.publicId).catch((error) => {
        console.error("Could not remove replaced contract image", error);
      });
    }

    return NextResponse.json({
      success: true,
      profile: result.profile,
      message: `Đã tải ${side === "front" ? "mặt trước" : "mặt sau"} CCCD.`
    });
  } catch (error) {
    if (uploadedPublicId) {
      await deleteContractImage(uploadedPublicId).catch(() => undefined);
    }
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không tải được ảnh CCCD."
    }, { status: 400 });
  }
}
