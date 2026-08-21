import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { exportPayrollRangeToSheet, exportPayrollWeekToSheet } from "@/lib/payrollSheetExport";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được xuất bảng lương ra Google Sheet." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { weekStartKey?: string; fromDate?: string; toDate?: string; dryRun?: boolean };
    const result = body.fromDate && body.toDate
      ? await exportPayrollRangeToSheet(body.fromDate, body.toDate, session.accountKey, { dryRun: Boolean(body.dryRun) })
      : body.weekStartKey
        ? await exportPayrollWeekToSheet(body.weekStartKey, session.accountKey, { dryRun: Boolean(body.dryRun) })
        : (() => { throw new Error("Thiếu tuần hoặc khoảng ngày cần xuất."); })();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không xuất được bảng lương ra Google Sheet.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
