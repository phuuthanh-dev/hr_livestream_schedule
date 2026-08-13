import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleWeekStartKey } from "@/lib/scheduleDate";
import { getPayrollDashboard } from "@/lib/payrollStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được xem bảng lương." }, { status: 403 });
  }
  try {
    const weekStartKey = new URL(request.url).searchParams.get("weekStartKey") || getScheduleWeekStartKey();
    return NextResponse.json(await getPayrollDashboard(weekStartKey), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được bảng lương." },
      { status: 400 }
    );
  }
}
