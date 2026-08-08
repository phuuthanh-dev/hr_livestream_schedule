import { NextResponse } from "next/server";
import { findSchedulePerson } from "@/lib/schedulePeople";
import { employeeHasPassword } from "@/lib/userAccounts";
import type { EmployeeRole } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { role?: EmployeeRole; employeeId?: string };
    if ((body.role !== "host" && body.role !== "support") || !body.employeeId) {
      return NextResponse.json({ success: false, message: "Thiếu vai trò hoặc mã nhân viên." }, { status: 400 });
    }

    const person = await findSchedulePerson(body.role, body.employeeId);
    if (!person) {
      return NextResponse.json({ success: false, message: "Nhân viên không tồn tại trong master." }, { status: 404 });
    }

    const hasPassword = await employeeHasPassword(body.role, body.employeeId);
    return NextResponse.json({ success: true, hasPassword });
  } catch (error) {
    console.error("Could not read employee account status.", error);
    return NextResponse.json(
      { success: false, message: "Hệ thống tài khoản đang chưa kết nối được MongoDB. Vui lòng báo Admin hoặc thử lại sau." },
      { status: 503 }
    );
  }
}
