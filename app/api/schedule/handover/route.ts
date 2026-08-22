import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { getScheduleTodayKey } from "@/lib/scheduleDate";
import {
  createScheduleHandoverRequest,
  findScheduleSessionById,
  getScheduleFromMongo,
  listScheduleHandoverRequestsForEmployee,
  respondScheduleHandoverRequest
} from "@/lib/scheduleStore";
import { syncLiveSessionMasterFromWebsite } from "@/lib/liveSessionMasterSync";
import type { EmployeeRole, SchedulePayload } from "@/lib/types";

export const runtime = "nodejs";

function getErrorStatus(message: string) {
  if (message.includes("Không tìm thấy")) return 404;
  if (message.includes("đã đổi người") || message.includes("đang có một yêu cầu") || message.includes("không còn")) return 409;
  if (message.includes("không có quyền") || message.includes("không thể")) return 403;
  return 400;
}

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "employee" || !session.employeeId) {
    return NextResponse.json({ success: false, message: "Chỉ nhân viên mới xem được yêu cầu nhường ca." }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const requests = await listScheduleHandoverRequestsForEmployee({
      employeeId: session.employeeId,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined
    });
    return NextResponse.json({ success: true, handoverRequests: requests });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được yêu cầu nhường ca." },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "employee" || !session.role || !session.employeeId) {
    return NextResponse.json<SchedulePayload>(
      { success: false, message: "Chỉ nhân viên mới tạo được yêu cầu nhường ca." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as {
      sessionId?: string;
      role?: EmployeeRole;
      toEmployeeId?: string;
      note?: string;
      from?: string;
      to?: string;
    };
    if (!body.sessionId || (body.role !== "host" && body.role !== "support") || !body.toEmployeeId) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Thiếu sessionId, vai trò hoặc người nhận ca." },
        { status: 400 }
      );
    }
    if (body.role !== session.role) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Bạn chỉ có thể nhường đúng vai trò đang đăng nhập." },
        { status: 403 }
      );
    }

    const current = await findScheduleSessionById(body.sessionId);
    if (!current) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Không tìm thấy ca này trong MongoDB." },
        { status: 404 }
      );
    }
    if (current.dateKey < getScheduleTodayKey()) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: `Bạn không thể nhường ca đã qua ngày (${current.dateLabel}).` },
        { status: 403 }
      );
    }

    const requestResult = await createScheduleHandoverRequest({
      sessionId: body.sessionId,
      role: body.role,
      fromEmployeeId: session.employeeId,
      toEmployeeId: body.toEmployeeId,
      actorAccountKey: session.accountKey,
      note: body.note
    });

    const payload = await getScheduleFromMongo({ from: body.from, to: body.to });
    payload.handoverRequests = await listScheduleHandoverRequestsForEmployee({
      employeeId: session.employeeId,
      from: body.from,
      to: body.to
    });
    payload.updatedSessionId = requestResult.sessionId;
    payload.message = `Đã gửi yêu cầu nhường ca ${requestResult.slot} ngày ${requestResult.dateLabel} cho ${requestResult.toEmployeeName}.`;
    return NextResponse.json<SchedulePayload>(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tạo được yêu cầu nhường ca.";
    return NextResponse.json<SchedulePayload>({ success: false, message }, { status: getErrorStatus(message) });
  }
}

export async function PATCH(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "employee" || !session.employeeId) {
    return NextResponse.json<SchedulePayload>(
      { success: false, message: "Chỉ nhân viên mới phản hồi yêu cầu nhường ca." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as {
      requestId?: string;
      action?: "accept" | "reject";
      responseNote?: string;
      from?: string;
      to?: string;
    };
    if (!body.requestId || (body.action !== "accept" && body.action !== "reject")) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Thiếu requestId hoặc action hợp lệ." },
        { status: 400 }
      );
    }

    const result = await respondScheduleHandoverRequest({
      requestId: body.requestId,
      action: body.action,
      responseNote: body.responseNote,
      actorAccountKey: session.accountKey,
      actorEmployeeId: session.employeeId
    });

    const payload = await getScheduleFromMongo({ from: body.from, to: body.to });
    payload.handoverRequests = await listScheduleHandoverRequestsForEmployee({
      employeeId: session.employeeId,
      from: body.from,
      to: body.to
    });
    payload.updatedSessionId = result.session?.sessionId || result.request.sessionId;

    if (body.action === "accept" && result.session) {
      try {
        const syncResult = await syncLiveSessionMasterFromWebsite({
          actorAccountKey: session.accountKey,
          from: body.from || result.session.dateKey,
          to: body.to || result.session.dateKey
        });
        payload.message = `Đã nhận ca ${result.session.slot} ngày ${result.session.dateLabel}. Đã sync sang ${syncResult.sheetName}.`;
      } catch (syncError) {
        const syncMessage = syncError instanceof Error ? syncError.message : "Không sync được Live_Session_Master_Web.";
        payload.message = `Đã nhận ca ${result.session.slot} ngày ${result.session.dateLabel}. Nhưng sync master lỗi: ${syncMessage}`;
      }
    } else {
      payload.message = `Đã từ chối yêu cầu nhường ca ${result.request.slot} ngày ${result.request.dateLabel}.`;
    }

    return NextResponse.json<SchedulePayload>(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không phản hồi được yêu cầu nhường ca.";
    return NextResponse.json<SchedulePayload>({ success: false, message }, { status: getErrorStatus(message) });
  }
}
