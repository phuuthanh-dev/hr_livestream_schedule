import { NextResponse } from "next/server";
import { getSchedulePeopleFromMongo } from "@/lib/employeeRoster";

export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getSchedulePeopleFromMongo();
    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được danh sách nhân viên." },
      { status: 503 }
    );
  }
}
