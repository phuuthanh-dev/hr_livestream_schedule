import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { generateAndPublishScheduleWeek } from "@/lib/scheduleGeneration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json(
      { success: false, message: "Chỉ Admin được chạy lịch tuần." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { weekStartKey?: string };
    const payload = await generateAndPublishScheduleWeek({
      weekStartKey: body.weekStartKey,
      requestedBy: session.accountKey
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Không chạy được lịch tuần."
      },
      { status: 409 }
    );
  }
}
