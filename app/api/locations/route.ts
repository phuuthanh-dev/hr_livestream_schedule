import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { createScheduleLocation, listScheduleLocations, updateScheduleLocation } from "@/lib/locationStore";
import type { ScheduleLocationsPayload } from "@/lib/types";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await getDashboardSession();
  return session?.accountType === "admin" ? session : null;
}

function errorStatus(message: string) {
  if (message.includes("đã tồn tại")) return 409;
  if (message.includes("Không tìm thấy")) return 404;
  return 400;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json<ScheduleLocationsPayload>(
      { success: false, message: "Chỉ Admin được quản lý địa điểm." },
      { status: 403 }
    );
  }

  try {
    const locations = await listScheduleLocations(true);
    return NextResponse.json<ScheduleLocationsPayload>(
      { success: true, locations },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json<ScheduleLocationsPayload>(
      { success: false, message: error instanceof Error ? error.message : "Không tải được danh mục địa điểm." },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json<ScheduleLocationsPayload>(
      { success: false, message: "Chỉ Admin được quản lý địa điểm." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as { code?: string; name?: string; sortOrder?: number };
    const location = await createScheduleLocation({
      code: body.code,
      name: body.name || "",
      sortOrder: body.sortOrder,
      actorAccountKey: session.accountKey
    });
    return NextResponse.json<ScheduleLocationsPayload>(
      { success: true, location, message: `Đã thêm địa điểm ${location.name}.` },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thêm được địa điểm.";
    return NextResponse.json<ScheduleLocationsPayload>({ success: false, message }, { status: errorStatus(message) });
  }
}

export async function PUT(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json<ScheduleLocationsPayload>(
      { success: false, message: "Chỉ Admin được quản lý địa điểm." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as {
      code?: string;
      name?: string;
      active?: boolean;
      sortOrder?: number;
    };
    const location = await updateScheduleLocation({
      code: body.code || "",
      name: body.name,
      active: body.active,
      sortOrder: body.sortOrder,
      actorAccountKey: session.accountKey
    });
    return NextResponse.json<ScheduleLocationsPayload>({
      success: true,
      location,
      message: `Đã cập nhật địa điểm ${location.name}.`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không cập nhật được địa điểm.";
    return NextResponse.json<ScheduleLocationsPayload>({ success: false, message }, { status: errorStatus(message) });
  }
}
