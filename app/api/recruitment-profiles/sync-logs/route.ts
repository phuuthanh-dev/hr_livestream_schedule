import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { listRecruitmentSheetSyncLogs } from "@/lib/recruitmentSheetImport";

export const runtime = "nodejs";

export async function GET() {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được xem log sync tuyển dụng." }, { status: 403 });
  }

  try {
    return NextResponse.json(await listRecruitmentSheetSyncLogs(), {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được log sync tuyển dụng." },
      { status: 400 }
    );
  }
}
