import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { findSchedulePerson, updateSchedulePerson } from "@/lib/employeeRoster";
import { syncRecruitmentProfilesToSheets } from "@/lib/recruitmentSheetImport";

export const runtime = "nodejs";

async function requireEmployee() {
  const session = await getDashboardSession();
  return session?.accountType === "employee" && session.role && session.employeeId ? session : null;
}

export async function GET() {
  const session = await requireEmployee();
  if (!session?.role || !session.employeeId) {
    return NextResponse.json({ success: false, message: "Trang hồ sơ chỉ dành cho nhân viên." }, { status: 403 });
  }
  const employee = await findSchedulePerson(session.role, session.employeeId);
  if (!employee) return NextResponse.json({ success: false, message: "Không tìm thấy hồ sơ nhân viên." }, { status: 404 });
  return NextResponse.json({ success: true, employee }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const session = await requireEmployee();
  if (!session?.role || !session.employeeId) {
    return NextResponse.json({ success: false, message: "Trang hồ sơ chỉ dành cho nhân viên." }, { status: 403 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) throw new Error("Họ và tên không được để trống.");
    const employee = await updateSchedulePerson({
      id: session.employeeId,
      role: session.role,
      name,
      aliasName: String(body.aliasName ?? "").trim().replace(/\s+/g, " ").slice(0, 120),
      phone: String(body.phone ?? "").trim(),
      email: String(body.email ?? "").trim().slice(0, 180)
    }, session.accountKey);

    let sheetSynced = true;
    let sheetMessage = "";
    try {
      await syncRecruitmentProfilesToSheets(session.accountKey, { role: session.role, employeeId: session.employeeId });
    } catch (error) {
      sheetSynced = false;
      sheetMessage = error instanceof Error ? error.message : "Không đồng bộ được Google Sheet.";
    }

    return NextResponse.json({
      success: true,
      employee,
      sheetSynced,
      message: sheetSynced
        ? "Đã lưu hồ sơ và đồng bộ Google Sheet."
        : `Đã lưu hồ sơ trên ứng dụng; Google Sheet chưa đồng bộ: ${sheetMessage}`
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không cập nhật được hồ sơ cá nhân."
    }, { status: 400 });
  }
}
