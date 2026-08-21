import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { createScheduleSession, deleteScheduleSession, getScheduleFromMongo, updateScheduleSessionAssignment } from "@/lib/scheduleStore";
import { syncLiveSessionMasterFromWebsite } from "@/lib/liveSessionMasterSync";
import type { AvailabilityLocationPreference, SchedulePayload } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const payload = await getScheduleFromMongo({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được lịch." },
      { status: 503 }
    );
  }
}

function updateErrorStatus(message: string) {
  if (message.includes("Không tìm thấy")) return 404;
  if (message.includes("đã thay đổi")) return 409;
  return 400;
}

async function appendAutoSyncMessage(
  payload: SchedulePayload,
  input: {
    actorAccountKey: string;
    from?: string;
    to?: string;
    fallbackDateKey?: string;
    actionMessage: string;
  }
) {
  try {
    const syncResult = await syncLiveSessionMasterFromWebsite({
      actorAccountKey: input.actorAccountKey,
      from: input.from || input.fallbackDateKey,
      to: input.to || input.fallbackDateKey
    });
    payload.message = `${input.actionMessage} Đã sync sang ${syncResult.sheetName}.`;
  } catch (syncError) {
    const syncMessage = syncError instanceof Error ? syncError.message : "Không sync được Live_Session_Master_Web.";
    payload.message = `${input.actionMessage} Nhưng sync master lỗi: ${syncMessage}`;
  }
}

export async function PATCH(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "admin") {
    return NextResponse.json<SchedulePayload>(
      { success: false, message: "Chỉ Admin được chỉnh phân công ca." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as {
      sessionId?: string;
      hostId?: string;
      supportId?: string;
      locationMode?: AvailabilityLocationPreference;
      rerankRole?: "host" | "support";
      from?: string;
      to?: string;
    };
    if (!body.sessionId) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Thiếu Session ID cần cập nhật." },
        { status: 400 }
      );
    }
    if (body.hostId === undefined && body.supportId === undefined && body.locationMode === undefined && !body.rerankRole) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Chưa có nội dung phân công cần cập nhật." },
        { status: 400 }
      );
    }

    const updated = await updateScheduleSessionAssignment({
      sessionId: body.sessionId,
      ...(body.hostId !== undefined ? { hostId: body.hostId } : {}),
      ...(body.supportId !== undefined ? { supportId: body.supportId } : {}),
      ...(body.locationMode !== undefined ? { locationMode: body.locationMode } : {}),
      ...(body.rerankRole ? { rerankRole: body.rerankRole } : {}),
      actorAccountKey: session.accountKey
    });
    const payload = await getScheduleFromMongo({ from: body.from, to: body.to });
    payload.updatedSessionId = updated.sessionId;
    await appendAutoSyncMessage(payload, {
      actorAccountKey: session.accountKey,
      from: body.from,
      to: body.to,
      fallbackDateKey: updated.dateKey,
      actionMessage: `Đã cập nhật ca ${updated.slot} ngày ${updated.dateLabel}.`
    });
    return NextResponse.json<SchedulePayload>(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không cập nhật được ca.";
    return NextResponse.json<SchedulePayload>(
      { success: false, message },
      { status: updateErrorStatus(message) }
    );
  }
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "admin") {
    return NextResponse.json<SchedulePayload>(
      { success: false, message: "Chỉ Admin được tạo ca live." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as {
      dateKey?: string;
      slot?: string;
      locationMode?: AvailabilityLocationPreference;
      from?: string;
      to?: string;
    };
    if (!body.dateKey || !body.slot || !body.locationMode) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Cần chọn đủ ngày, khung giờ và địa điểm để tạo ca." },
        { status: 400 }
      );
    }

    const created = await createScheduleSession({
      dateKey: body.dateKey,
      slot: body.slot,
      locationMode: body.locationMode,
      actorAccountKey: session.accountKey
    });
    const payload = await getScheduleFromMongo({ from: body.from, to: body.to });
    payload.updatedSessionId = created.sessionId;
    await appendAutoSyncMessage(payload, {
      actorAccountKey: session.accountKey,
      from: body.from,
      to: body.to,
      fallbackDateKey: created.dateKey,
      actionMessage: `Đã tạo ca ${created.slot} ngày ${created.dateLabel} tại ${created.format}.`
    });
    return NextResponse.json<SchedulePayload>(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tạo được ca live.";
    return NextResponse.json<SchedulePayload>(
      { success: false, message },
      { status: updateErrorStatus(message) }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getDashboardSession();
  if (!session || session.accountType !== "admin") {
    return NextResponse.json<SchedulePayload>(
      { success: false, message: "Chỉ Admin được xóa ca live." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as {
      sessionId?: string;
      from?: string;
      to?: string;
    };
    if (!body.sessionId) {
      return NextResponse.json<SchedulePayload>(
        { success: false, message: "Thiếu Session ID cần xóa." },
        { status: 400 }
      );
    }

    const deleted = await deleteScheduleSession({
      sessionId: body.sessionId,
      actorAccountKey: session.accountKey
    });
    const payload = await getScheduleFromMongo({ from: body.from, to: body.to });
    payload.updatedSessionId = deleted.sessionId;
    await appendAutoSyncMessage(payload, {
      actorAccountKey: session.accountKey,
      from: body.from,
      to: body.to,
      fallbackDateKey: deleted.dateKey,
      actionMessage: `Đã xóa ca ${deleted.slot} ngày ${deleted.dateLabel} khỏi lịch hiển thị.`
    });
    return NextResponse.json<SchedulePayload>(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không xóa được ca live.";
    return NextResponse.json<SchedulePayload>(
      { success: false, message },
      { status: updateErrorStatus(message) }
    );
  }
}
