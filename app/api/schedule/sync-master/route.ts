import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { syncLiveSessionMasterFromWebsite } from "@/lib/liveSessionMasterSync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "admin") {
    return NextResponse.json(
      { success: false, message: "Chỉ Admin được đồng bộ lịch sang Live_Session_Master_Web." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      from?: string;
      to?: string;
      weekStartKey?: string;
      targetSheetName?: string;
    };

    const result = await syncLiveSessionMasterFromWebsite({
      actorAccountKey: session.accountKey,
      from: body.from,
      to: body.to,
      weekStartKey: body.weekStartKey,
      targetSheetName: body.targetSheetName
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Không sync được Live_Session_Master_Web."
      },
      { status: 400 }
    );
  }
}
