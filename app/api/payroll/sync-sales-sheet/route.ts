import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { syncTikTokSalesImportSheet } from "@/lib/tiktokSalesImportSheetSync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "admin") {
    return NextResponse.json(
      { success: false, message: "Chỉ Admin được sync TikTok_Sales_Import ra sheet." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      from?: string;
      to?: string;
      spreadsheetId?: string;
      sheetName?: string;
    };

    const result = await syncTikTokSalesImportSheet({
      actorAccountKey: session.accountKey,
      from: body.from || "",
      to: body.to || body.from || "",
      spreadsheetId: body.spreadsheetId,
      sheetName: body.sheetName
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Không sync được TikTok_Sales_Import."
      },
      { status: 400 }
    );
  }
}
