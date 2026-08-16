import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { createContractUploadSignature } from "@/lib/contractCloudinary";
import { getEmployeeContractProfile, type EmployeeContractDocumentSide } from "@/lib/employeeContract";
import { resolveEmployeeContractPerson } from "@/lib/employeeContractAccess";

export const runtime = "nodejs";

function readSide(value: unknown): EmployeeContractDocumentSide | null {
  return value === "front" || value === "back" ? value : null;
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const side = readSide(body.side);
    if (!side) {
      return NextResponse.json({ success: false, message: "Mặt CCCD không hợp lệ." }, { status: 400 });
    }

    const person = await resolveEmployeeContractPerson({ session, role: body.role, employeeId: body.employeeId });
    if (!person) {
      return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên." }, { status: 404 });
    }

    const profile = await getEmployeeContractProfile(person.role, person.id);
    if (!profile) {
      return NextResponse.json({ success: false, message: "Hãy lưu thông tin hợp đồng trước khi tải CCCD." }, { status: 409 });
    }
    if (session.accountType === "employee" && profile.completed) {
      return NextResponse.json({
        success: false,
        message: "Hồ sơ hợp đồng đã hoàn tất. Nhân viên không thể tải thêm CCCD."
      }, { status: 403 });
    }

    const upload = createContractUploadSignature({
      role: person.role,
      employeeId: person.id,
      side,
      contentType: body.contentType,
      size: body.size
    });
    return NextResponse.json({ success: true, upload }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không tạo được phiên tải CCCD."
    }, { status: 400 });
  }
}
