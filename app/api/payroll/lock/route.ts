import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { lockPayrollWeek } from "@/lib/payrollStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được khóa bảng lương." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { weekStartKey?: string };
    if (!body.weekStartKey) throw new Error("Thiếu tuần cần khóa.");
    const payload = await lockPayrollWeek(body.weekStartKey, session.accountKey);
    return NextResponse.json({ ...payload, message: "Đã khóa bảng lương tuần." });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không khóa được bảng lương." },
      { status: 400 }
    );
  }
}
