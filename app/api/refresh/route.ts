import { NextResponse } from "next/server";
import { refreshSchedule } from "@/lib/googleSchedule";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleFromMongo, syncSchedulePayloadToMongo } from "@/lib/scheduleStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ admin được cập nhật lịch từ Google Sheet." }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { from?: string; to?: string };
    const startedAt = new Date();
    const googlePayload = await refreshSchedule();
    const syncResult = await syncSchedulePayloadToMongo(googlePayload, {
      requestedBy: "admin:admin",
      startedAt
    });
    const payload = await getScheduleFromMongo({ from: body.from, to: body.to });
    payload.sync = {
      success: true,
      message: googlePayload.sync?.message || "Đã cập nhật lịch từ Google Sheets và lưu vào MongoDB.",
      ...syncResult
    };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không cập nhật được lịch." },
      { status: 502 }
    );
  }
}
