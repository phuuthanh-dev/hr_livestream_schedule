import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { syncRecruitmentProfilesToSheets } from "@/lib/recruitmentSheetImport";

export const runtime = "nodejs";

export async function POST() {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được đẩy dữ liệu lên sheet." }, { status: 403 });
  }

  try {
    return NextResponse.json(await syncRecruitmentProfilesToSheets(session.accountKey));
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không sync được hồ sơ tuyển dụng lên sheet." },
      { status: 400 }
    );
  }
}
