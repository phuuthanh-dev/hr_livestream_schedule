import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { setAvailabilityWeekLock } from "@/lib/availabilityStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được khóa hoặc mở khóa lịch rảnh." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      weekStartKey?: string;
      action?: "lock" | "unlock";
      reason?: string;
    };
    if (!body.weekStartKey) throw new Error("Thiếu tuần cần thao tác.");
    if (body.action !== "lock" && body.action !== "unlock") {
      throw new Error("Thao tác khóa lịch rảnh không hợp lệ.");
    }

    const payload = await setAvailabilityWeekLock({
      weekStartKey: body.weekStartKey,
      locked: body.action === "lock",
      actorAccountKey: session.accountKey,
      reason: body.reason
    });

    return NextResponse.json({
      ...payload,
      message: body.action === "lock"
        ? `Đã khóa lịch rảnh tuần cho ${payload.affectedPeople} nhân sự.`
        : `Đã mở khóa lịch rảnh tuần cho ${payload.affectedPeople} nhân sự.`
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không thao tác được lịch rảnh tuần." },
      { status: 400 }
    );
  }
}
