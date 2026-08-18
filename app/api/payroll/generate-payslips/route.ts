import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { generatePayrollPayslipsForWeek } from "@/lib/payrollPayslip";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được tạo phiếu lương." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { weekStartKey?: string };
    if (!body.weekStartKey) throw new Error("Thiếu tuần cần tạo phiếu lương.");
    const result = await generatePayrollPayslipsForWeek(body.weekStartKey, session.accountKey);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tạo được phiếu lương.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
