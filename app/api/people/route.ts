import { NextResponse } from "next/server";
import { fetchSchedulePeople } from "@/lib/googleSchedule";

export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await fetchSchedulePeople();
    return NextResponse.json(payload, {
      headers: { "cache-control": "private, max-age=300" }
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được danh sách nhân viên." },
      { status: 502 }
    );
  }
}
