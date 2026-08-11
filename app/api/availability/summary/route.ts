import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { getAvailabilityAdminDashboard } from "@/lib/availabilityStore";
import { getScheduleWeekStartKey } from "@/lib/scheduleDate";
import type { AvailabilityAdminRoleFilter, AvailabilityAdminStatusFilter } from "@/lib/types";

export const runtime = "nodejs";

function normalizeRoleFilter(value: string | null): AvailabilityAdminRoleFilter {
  return value === "host" || value === "support" ? value : "all";
}

function normalizeStatusFilter(value: string | null): AvailabilityAdminStatusFilter {
  return value === "submitted" || value === "not_submitted" ? value : "all";
}

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json(
      { success: false, message: "Chỉ Admin được xem tổng hợp lịch rảnh." },
      { status: 403 }
    );
  }

  try {
    const url = new URL(request.url);
    const payload = await getAvailabilityAdminDashboard({
      weekStartKey: url.searchParams.get("weekStartKey") || getScheduleWeekStartKey(),
      roleFilter: normalizeRoleFilter(url.searchParams.get("role")),
      statusFilter: normalizeStatusFilter(url.searchParams.get("status"))
    });

    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Không tải được tổng hợp lịch rảnh."
      },
      { status: 400 }
    );
  }
}
