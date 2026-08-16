import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { syncEmployeeBundleToDriveSafely } from "@/lib/contractDriveRealtime";
import { resolveEmployeeContractPerson } from "@/lib/employeeContractAccess";
import {
  getEmployeeContractProfile,
  saveEmployeeContractProfile
} from "@/lib/employeeContract";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });
  }

  const url = new URL(request.url);
  const person = await resolveEmployeeContractPerson({
    session,
    role: url.searchParams.get("role"),
    employeeId: url.searchParams.get("employeeId")
  });
  if (!person) {
    return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên cần xem." }, { status: 404 });
  }

  try {
    const profile = await getEmployeeContractProfile(person.role, person.id);
    return NextResponse.json({
      success: true,
      target: { role: person.role, employeeId: person.id, employeeName: person.name },
      profile
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không tải được thông tin hợp đồng."
    }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const person = await resolveEmployeeContractPerson({
      session,
      role: body.role,
      employeeId: body.employeeId
    });
    if (!person) {
      return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên cần cập nhật." }, { status: 404 });
    }

    const profile = await saveEmployeeContractProfile({
      person,
      values: body,
      actorAccountKey: session.accountKey
    });
    const driveSync = await syncEmployeeBundleToDriveSafely({
      role: person.role,
      employeeId: person.id
    });

    return NextResponse.json({
      success: true,
      target: { role: person.role, employeeId: person.id, employeeName: person.name },
      profile,
      message: driveSync.success
        ? "Đã lưu thông tin hợp đồng và sync Google Drive."
        : `Đã lưu thông tin hợp đồng nhưng sync Google Drive lỗi: ${driveSync.message}`
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không lưu được thông tin hợp đồng."
    }, { status: 400 });
  }
}
