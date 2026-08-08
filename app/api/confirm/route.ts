import { NextResponse } from "next/server";
import { confirmSchedule, fetchSchedule } from "@/lib/googleSchedule";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleTodayKey } from "@/lib/scheduleDate";
import type { ConfirmRole } from "@/lib/types";

export const runtime = "nodejs";

const VALID_ROLES = new Set<ConfirmRole>(["host", "support", "both"]);

class ConfirmRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function normalizeEmployeeId(value: string | undefined) {
  return value?.trim().toLowerCase() || "";
}

function getConfirmErrorStatus(error: unknown) {
  if (error instanceof ConfirmRequestError) return error.status;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("không thể confirm") || message.includes("không có quyền") || message.includes("không thể thay đổi")) {
    return 403;
  }
  if (message.includes("trùng") || message.includes("duplicate")) return 409;
  return 502;
}

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
    if (session.accountType === "employee") {
      if (!session.role || !session.employeeId || body.role !== session.role) {
        return NextResponse.json({ success: false, message: "Bạn không có quyền xác nhận vai trò này." }, { status: 403 });
      }

      if (!body.from || !body.to) {
        throw new ConfirmRequestError("Thiếu phạm vi tuần để kiểm tra ca được phân công.", 400);
      }

      const schedule = await fetchSchedule({ from: body.from, to: body.to });
      const matchingSessions = (schedule.rows || []).filter((row) => row.sessionId === body.sessionId);
      if (matchingSessions.length === 0) {
        throw new ConfirmRequestError("Không tìm thấy ca này trong tuần đang xem. Vui lòng tải lại lịch.", 404);
      }
      if (matchingSessions.length > 1) {
        throw new ConfirmRequestError(`Session_ID ${body.sessionId} đang bị trùng. Không thể cập nhật an toàn.`, 409);
      }

      const target = matchingSessions[0];
      if (!target.dateKey) {
        throw new ConfirmRequestError("Ca này không có ngày hợp lệ nên nhân viên không thể thay đổi xác nhận.", 409);
      }
      if (target.dateKey < getScheduleTodayKey(schedule.timezone)) {
        throw new ConfirmRequestError(
          `Bạn không thể thay đổi xác nhận của ngày đã qua (${target.dateLabel}). Chỉ Admin được xử lý lịch sử.`,
          403
        );
      }

      const assignedEmployeeId = body.role === "host" ? target.hostId : target.supportId;
      if (normalizeEmployeeId(assignedEmployeeId) !== normalizeEmployeeId(session.employeeId)) {
        const roleLabel = body.role === "host" ? "Host" : "Support Live";
        throw new ConfirmRequestError(
          `Bạn không thể xác nhận hoặc huỷ xác nhận ca của người khác. ${roleLabel} ca ${target.slot} ngày ${target.dateLabel} không thuộc mã nhân viên của bạn.`,
          403
        );
      }
    }

    const payload = await confirmSchedule({
      sessionId: body.sessionId,
      role: body.role,
      confirmed: body.confirmed !== false,
      actorType: session.accountType,
      actorRole: session.role,
      actorEmployeeId: session.employeeId,
      from: body.from,
      to: body.to
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không xác nhận được ca." },
      { status: getConfirmErrorStatus(error) }
    );
  }
}
