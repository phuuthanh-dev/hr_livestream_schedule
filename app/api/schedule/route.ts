import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleFromMongo } from "@/lib/scheduleStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const payload = await getScheduleFromMongo({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được lịch." },
      { status: 503 }
    );
  }
}
