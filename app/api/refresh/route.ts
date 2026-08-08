import { NextResponse } from "next/server";
import { refreshSchedule } from "@/lib/googleSchedule";
import { getDashboardSession } from "@/lib/auth";

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
    const payload = await refreshSchedule({
      from: body.from,
      to: body.to
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không cập nhật được lịch." },
      { status: 502 }
    );
  }
}
