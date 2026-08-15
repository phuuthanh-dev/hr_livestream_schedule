import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { listAvailabilitySheetSyncLogs } from "@/lib/availabilitySheetImport";
import { getScheduleWeekStartKey } from "@/lib/scheduleDate";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được xem log sync sheet." }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const weekStartKey = url.searchParams.get("weekStartKey") || getScheduleWeekStartKey();
    return NextResponse.json(await listAvailabilitySheetSyncLogs(weekStartKey), {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được log sync sheet." },
      { status: 400 }
    );
  }
}
