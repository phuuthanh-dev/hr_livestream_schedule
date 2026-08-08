import { NextResponse } from "next/server";
import { confirmSchedule } from "@/lib/googleSchedule";
import { getDashboardSession } from "@/lib/auth";
import type { ConfirmRole } from "@/lib/types";

export const runtime = "nodejs";

const VALID_ROLES = new Set<ConfirmRole>(["host", "support", "both"]);

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      sessionId?: string;
      role?: ConfirmRole;
      confirmed?: boolean;
      from?: string;
      to?: string;
    };

    if (!body.sessionId || !body.role || !VALID_ROLES.has(body.role)) {
      return NextResponse.json({ success: false, message: "Thiếu sessionId hoặc role." }, { status: 400 });
    }

    const payload = await confirmSchedule({
      sessionId: body.sessionId,
      role: body.role,
      confirmed: body.confirmed !== false,
      from: body.from,
      to: body.to
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không xác nhận được ca." },
      { status: 502 }
    );
  }
}
