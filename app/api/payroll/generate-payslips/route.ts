import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { generatePayrollPayslipsForRange, generatePayrollPayslipsForWeek } from "@/lib/payrollPayslip";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được tạo phiếu lương." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { weekStartKey?: string; fromDate?: string; toDate?: string };
    const result = body.fromDate && body.toDate
      ? await generatePayrollPayslipsForRange(body.fromDate, body.toDate, session.accountKey)
      : body.weekStartKey
        ? await generatePayrollPayslipsForWeek(body.weekStartKey, session.accountKey)
        : (() => { throw new Error("Thiếu khoảng ngày hoặc tuần cần tạo phiếu lương."); })();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tạo được phiếu lương.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
