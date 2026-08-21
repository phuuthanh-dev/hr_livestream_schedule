import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { createPayrollManualAdjustment, deletePayrollManualAdjustment } from "@/lib/payrollStore";

export async function POST(request: Request) {
  try {
    const session = await getDashboardSession();
    if (!session || session.accountType !== "admin") {
      return NextResponse.json({ success: false, message: "Bạn không có quyền thao tác payroll." }, { status: 403 });
    }
    const body = (await request.json()) as {
      weekStartKey?: string;
      dateKey?: string;
      employeeId?: string;
      role?: "host" | "support";
      hours?: number;
      note?: string;
    };
    if (!body.weekStartKey || !body.dateKey || !body.employeeId || !body.role) {
      throw new Error("Thiếu thông tin công bù.");
    }
    const payload = await createPayrollManualAdjustment({
      weekStartKey: body.weekStartKey,
      dateKey: body.dateKey,
      employeeId: body.employeeId,
      role: body.role,
      hours: Number(body.hours || 0),
      note: body.note
    }, session.accountKey);
    return NextResponse.json({
      ...payload,
      success: true,
      message: "Đã lưu công bù và cập nhật lại payroll tuần."
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không lưu được công bù."
    }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getDashboardSession();
    if (!session || session.accountType !== "admin") {
      return NextResponse.json({ success: false, message: "Bạn không có quyền thao tác payroll." }, { status: 403 });
    }
    const url = new URL(request.url);
    const adjustmentId = url.searchParams.get("adjustmentId") || "";
    if (!adjustmentId) throw new Error("Thiếu adjustmentId.");
    const payload = await deletePayrollManualAdjustment(adjustmentId, session.accountKey);
    return NextResponse.json({
      ...payload,
      success: true,
      message: "Đã xóa công bù và cập nhật lại payroll tuần."
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không xóa được công bù."
    }, { status: 400 });
  }
}

