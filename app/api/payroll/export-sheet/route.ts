import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { exportPayrollWeekToSheet } from "@/lib/payrollSheetExport";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được xuất bảng lương ra Google Sheet." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { weekStartKey?: string; dryRun?: boolean };
    if (!body.weekStartKey) throw new Error("Thiếu tuần cần xuất.");
    const result = await exportPayrollWeekToSheet(body.weekStartKey, session.accountKey, { dryRun: Boolean(body.dryRun) });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không xuất được bảng lương ra Google Sheet.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
