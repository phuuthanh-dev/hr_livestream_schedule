import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { generatePayrollWeek } from "@/lib/payrollStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được tính lương." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { weekStartKey?: string };
    if (!body.weekStartKey) throw new Error("Thiếu tuần cần tính lương.");
    const payload = await generatePayrollWeek(body.weekStartKey, session.accountKey);
    return NextResponse.json({ ...payload, message: "Đã tính lại bảng lương từ ca xác nhận và báo cáo TikTok." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tính được bảng lương.";
    return NextResponse.json({ success: false, message }, { status: message.includes("đã khóa") ? 409 : 400 });
  }
}
