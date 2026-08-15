import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { syncAvailabilityWeekToCollectSheets } from "@/lib/availabilitySheetImport";
import { getScheduleWeekStartKey } from "@/lib/scheduleDate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được đẩy lịch sang Google Sheet." }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({})) as { weekStartKey?: string };
    const weekStartKey = getScheduleWeekStartKey(body.weekStartKey || getScheduleWeekStartKey());
    const payload = await syncAvailabilityWeekToCollectSheets(weekStartKey, session.accountKey);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không đẩy được lịch sang Google Sheet." },
      { status: 400 }
    );
  }
}
