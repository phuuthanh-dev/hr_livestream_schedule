import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { getAvailabilityWeekForPerson, saveAvailabilityWeek } from "@/lib/availabilityStore";
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

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") || undefined;
    const employeeId = url.searchParams.get("employeeId") || undefined;
    const weekStartKey = url.searchParams.get("weekStartKey") || getScheduleWeekStartKey();
    const target = resolveTarget(session, role, employeeId);
    const payload = await getAvailabilityWeekForPerson(target.role, target.employeeId, weekStartKey);

    return NextResponse.json(
      {
        ...payload,
        canEdit: session.accountType === "admin" || payload.week?.status !== "locked"
      },
      {
        headers: { "cache-control": "no-store" }
      }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được lịch rảnh." },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      role?: EmployeeRole;
      employeeId?: string;
      weekStartKey?: string;
      slots?: AvailabilitySlot[];
    };

    const target = resolveTarget(session, body.role, body.employeeId);
    const payload = await saveAvailabilityWeek({
      role: target.role,
      employeeId: target.employeeId,
      weekStartKey: body.weekStartKey || getScheduleWeekStartKey(),
      slots: Array.isArray(body.slots) ? body.slots : [],
      actorAccountKey: session.accountKey,
      allowLockedOverwrite: session.accountType === "admin"
    });

    return NextResponse.json({
      ...payload,
      canEdit: session.accountType === "admin" || payload.week?.status !== "locked",
      message: "Đã lưu lịch rảnh cho tuần này."
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không lưu được lịch rảnh." },
      { status: 400 }
    );
  }
}
