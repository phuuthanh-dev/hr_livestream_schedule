import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { syncAvailabilityWeekToCollectSheets } from "@/lib/availabilitySheetImport";
import { hasEditableAvailabilitySlots, saveAvailabilityWeek, submitAvailabilityWeek } from "@/lib/availabilityStore";
import { getScheduleWeekStartKey } from "@/lib/scheduleDate";
import type { AvailabilitySlot, EmployeeRole } from "@/lib/types";

export const runtime = "nodejs";

function isEmployeeRole(value: string | undefined): value is EmployeeRole {
  return value === "host" || value === "support";
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function resolveTarget(
  session: NonNullable<Awaited<ReturnType<typeof getDashboardSession>>>,
  roleInput?: string,
  employeeIdInput?: string
) {
  if (session.accountType === "employee") {
    if (!session.role || !session.employeeId) {
      throw new Error("Phiên đăng nhập nhân viên không hợp lệ.");
    }
    return {
      role: session.role,
      employeeId: session.employeeId
    };
  }

  if (!isEmployeeRole(roleInput) || !normalizeText(employeeIdInput)) {
    throw new Error("Admin cần chọn đúng vai trò và mã nhân viên.");
  }

  return {
    role: roleInput,
    employeeId: normalizeText(employeeIdInput)
  };
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "employee") {
    return NextResponse.json(
      { success: false, message: "Chỉ nhân viên được gửi lịch rảnh. Admin chỉ có thể lưu thay đổi." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      role?: EmployeeRole;
      employeeId?: string;
      weekStartKey?: string;
      slots?: AvailabilitySlot[];
    };

    const target = resolveTarget(session, body.role, body.employeeId);
    if (Array.isArray(body.slots)) {
      await saveAvailabilityWeek({
        role: target.role,
        employeeId: target.employeeId,
        weekStartKey: body.weekStartKey || getScheduleWeekStartKey(),
        slots: body.slots,
        actorAccountKey: session.accountKey,
        allowLockedOverwrite: false,
        allowLocationOverride: false
      });
    }
    const payload = await submitAvailabilityWeek({
      role: target.role,
      employeeId: target.employeeId,
      weekStartKey: body.weekStartKey || getScheduleWeekStartKey(),
      actorAccountKey: session.accountKey,
      allowLockedOverwrite: false
    });
    const weekStartKey = body.weekStartKey || getScheduleWeekStartKey();
    let syncWarning = "";
    try {
      await syncAvailabilityWeekToCollectSheets(weekStartKey, session.accountKey);
    } catch (error) {
      syncWarning = error instanceof Error ? ` Tuy nhiên chưa đẩy được sang Google Sheet: ${error.message}` : " Tuy nhiên chưa đẩy được sang Google Sheet.";
    }

    return NextResponse.json({
      ...payload,
      canEdit: hasEditableAvailabilitySlots(body.weekStartKey || getScheduleWeekStartKey()) &&
        (payload.target?.role !== "host" || Boolean(payload.target.workLocation)) &&
        payload.target?.workLocationActive !== false &&
        payload.week?.status !== "locked",
      message: `Đã gửi lịch rảnh cho admin.${syncWarning}`
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không gửi được lịch rảnh." },
      { status: 400 }
    );
  }
}
