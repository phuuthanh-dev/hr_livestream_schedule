import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { readScheduleSnapshot } from "@/lib/googleSchedule";
import { getScheduleFromMongo, syncSchedulePayloadToMongo } from "@/lib/scheduleStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json(
      { success: false, message: "Chỉ Admin được đọc lại dữ liệu lịch từ Google Sheet." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { from?: string; to?: string };
    const startedAt = new Date();
    const googlePayload = await readScheduleSnapshot();
    const syncResult = await syncSchedulePayloadToMongo(googlePayload, {
      requestedBy: "admin:admin",
      mode: "sheet_snapshot",
      startedAt
    });
    const payload = await getScheduleFromMongo({ from: body.from, to: body.to });
    payload.sync = {
      success: true,
      message: "Đã đọc nguyên trạng Live_Session_Master và cập nhật MongoDB, không chạy lại logic xếp lịch.",
      ...syncResult
    };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Không đọc được dữ liệu lịch từ Google Sheet."
      },
      { status: 502 }
    );
  }
}
