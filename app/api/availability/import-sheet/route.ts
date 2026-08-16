import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { importAvailabilityFromCollectSheets } from "@/lib/availabilitySheetImport";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được import lịch từ Google Sheet." }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({})) as { weekStartKey?: string; force?: boolean };
    const payload = await importAvailabilityFromCollectSheets(session.accountKey, body.weekStartKey, {
      force: body.force === true
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không import được lịch từ Google Sheet." },
      { status: 400 }
    );
  }
}
