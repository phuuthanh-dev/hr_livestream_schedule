import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { importTikTokPayrollReport } from "@/lib/payrollStore";
import { syncTikTokSalesImportSheet } from "@/lib/tiktokSalesImportSheetSync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được import báo cáo TikTok." }, { status: 403 });
  }
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("Chưa chọn file báo cáo.");
    const result = await importTikTokPayrollReport(Buffer.from(await file.arrayBuffer()), file.name, session.accountKey);
    let syncMessage = "";
    if (result.dateFrom && result.dateTo) {
      const syncResult = await syncTikTokSalesImportSheet({
        actorAccountKey: session.accountKey,
        from: result.dateFrom,
        to: result.dateTo
      });
      syncMessage = ` ${syncResult.message}`;
    }
    return NextResponse.json({
      success: true,
      import: result,
      message: result.alreadyImported
        ? `File này đã được import trước đó; không tạo dữ liệu trùng.${syncMessage}`
        : `Đã nhận ${result.totalRows} dòng báo cáo; thêm mới ${result.inserted}, trùng/cập nhật ${result.duplicates}.${syncMessage}`
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không import được báo cáo TikTok." },
      { status: 400 }
    );
  }
}
