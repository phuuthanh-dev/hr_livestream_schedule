import { NextResponse } from "next/server";
import { fetchSchedule } from "@/lib/googleSchedule";
import { getDashboardSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const payload = await fetchSchedule({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được lịch." },
      { status: 502 }
    );
  }
}
