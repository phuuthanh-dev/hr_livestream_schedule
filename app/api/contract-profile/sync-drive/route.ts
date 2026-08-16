import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { syncEmployeeBundleToDriveSafely } from "@/lib/contractDriveRealtime";
import { resolveEmployeeContractPerson } from "@/lib/employeeContractAccess";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được sync lại Google Drive." }, { status: 403 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const person = await resolveEmployeeContractPerson({
      session,
      role: body.role,
      employeeId: body.employeeId
    });
    if (!person) {
      return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên cần sync Drive." }, { status: 404 });
    }

    const result = await syncEmployeeBundleToDriveSafely({
      role: person.role,
      employeeId: person.id
    });

    if (!result.success) {
      return NextResponse.json({
        success: false,
        message: `Sync Google Drive lỗi: ${result.message}`
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      folderId: result.folderId,
      message: `Đã sync lại hồ sơ Drive cho ${person.name}.`
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không sync lại được Google Drive."
    }, { status: 400 });
  }
}
