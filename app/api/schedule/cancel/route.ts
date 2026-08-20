import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleTodayKey } from "@/lib/scheduleDate";
import { cancelScheduleParticipation, findScheduleSessionById, getScheduleFromMongo } from "@/lib/scheduleStore";
import { syncLiveSessionMasterFromWebsite } from "@/lib/liveSessionMasterSync";
import type { EmployeeRole, SchedulePayload } from "@/lib/types";

export const runtime = "nodejs";

function getErrorStatus(message: string) {
  if (message.includes("Không tìm thấy")) return 404;
  if (message.includes("đã thay đổi") || message.includes("đã đổi người")) return 409;
  if (message.includes("không thể") || message.includes("không khớp")) return 403;
  return 400;
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json<SchedulePayload>({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      sessionId?: string;
      role?: EmployeeRole;
      from?: string;
      to?: string;
    };
    if (!body.sessionId || (body.role !== "host" && body.role !== "support")) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Thiếu sessionId hoặc vai trò hủy tham gia." },
        { status: 400 }
      );
    }

    const current = await findScheduleSessionById(body.sessionId);
    if (!current) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Không tìm thấy ca này trong MongoDB." },
        { status: 404 }
      );
    }

    if (session.accountType === "employee") {
      if (!session.role || !session.employeeId || session.role !== body.role) {
        return NextResponse.json<SchedulePayload>(
          { success: false, message: "Bạn không có quyền hủy vai trò này." },
          { status: 403 }
        );
      }
      if (current.dateKey < getScheduleTodayKey()) {
        return NextResponse.json<SchedulePayload>(
          { success: false, message: `Bạn không thể hủy tham gia ca đã qua ngày (${current.dateLabel}).` },
          { status: 403 }
        );
      }
    } else if (session.accountType !== "admin") {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Chỉ Admin hoặc nhân viên được phân công mới có thể hủy tham gia." },
        { status: 403 }
      );
    }

    const updated = await cancelScheduleParticipation({
      sessionId: body.sessionId,
      role: body.role,
      actorAccountKey: session.accountKey,
      actorType: session.accountType,
      actorRole: session.role,
      actorEmployeeId: session.employeeId,
      expectedDateKey: current.dateKey
    });

    const payload = await getScheduleFromMongo({ from: body.from, to: body.to });
    payload.updatedSessionId = updated.sessionId;

    try {
      const syncResult = await syncLiveSessionMasterFromWebsite({
        actorAccountKey: session.accountKey,
        from: body.from || updated.dateKey,
        to: body.to || updated.dateKey
      });
      payload.message = `Đã hủy tham gia vai trò ${body.role === "host" ? "Host" : "Support"} ở ca ${updated.slot} ngày ${updated.dateLabel}. Đã sync sang ${syncResult.sheetName}.`;
    } catch (syncError) {
      const syncMessage = syncError instanceof Error ? syncError.message : "Không sync được Live_Session_Master_Web.";
      payload.message = `Đã hủy tham gia vai trò ${body.role === "host" ? "Host" : "Support"} ở ca ${updated.slot} ngày ${updated.dateLabel}. Nhưng sync master lỗi: ${syncMessage}`;
    }

    return NextResponse.json<SchedulePayload>(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không hủy tham gia được ca.";
    return NextResponse.json<SchedulePayload>(
      { success: false, message },
      { status: getErrorStatus(message) }
    );
  }
}
