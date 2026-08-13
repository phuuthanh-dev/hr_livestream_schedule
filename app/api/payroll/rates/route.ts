import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { updatePayrollConfiguration } from "@/lib/payrollStore";
import type { PayrollRateCard, PayrollSettings } from "@/lib/types";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được sửa bảng giá." }, { status: 403 });
  }
  try {
    const input = (await request.json()) as { rates: PayrollRateCard[]; settings: PayrollSettings };
    const result = await updatePayrollConfiguration(input, session.accountKey);
    return NextResponse.json({ success: true, ...result, message: "Đã lưu bảng giá và quy tắc tính lương." });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không lưu được bảng giá." },
      { status: 400 }
    );
  }
}
