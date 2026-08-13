import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import {
  getEmployeeContractProfile,
  saveEmployeeContractProfile
} from "@/lib/employeeContract";
import { findActiveSchedulePerson, findSchedulePerson } from "@/lib/employeeRoster";
import type { EmployeeRole } from "@/lib/types";

export const runtime = "nodejs";

function readRole(value: unknown): EmployeeRole | null {
  return value === "host" || value === "support" ? value : null;
}

async function resolvePerson(input: {
  session: NonNullable<Awaited<ReturnType<typeof getDashboardSession>>>;
  role?: unknown;
  employeeId?: unknown;
}) {
  if (input.session.accountType === "employee") {
    if (!input.session.role || !input.session.employeeId) return null;
    return findActiveSchedulePerson(input.session.role, input.session.employeeId);
  }

  const role = readRole(input.role);
  const employeeId = String(input.employeeId ?? "").trim();
  if (!role || !employeeId) return null;
  return findSchedulePerson(role, employeeId);
}

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });
  }

  const url = new URL(request.url);
  const person = await resolvePerson({
    session,
    role: url.searchParams.get("role"),
    employeeId: url.searchParams.get("employeeId")
  });
  if (!person) {
    return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên cần xem." }, { status: 404 });
  }

  try {
    const profile = await getEmployeeContractProfile(person.role, person.id);
    return NextResponse.json({
      success: true,
      target: { role: person.role, employeeId: person.id, employeeName: person.name },
      profile
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không tải được thông tin hợp đồng."
    }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const person = await resolvePerson({
      session,
      role: body.role,
      employeeId: body.employeeId
    });
    if (!person) {
      return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên cần cập nhật." }, { status: 404 });
    }

    const profile = await saveEmployeeContractProfile({
      person,
      values: body,
      actorAccountKey: session.accountKey
    });
    return NextResponse.json({
      success: true,
      target: { role: person.role, employeeId: person.id, employeeName: person.name },
      profile,
      message: "Đã lưu thông tin hợp đồng."
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không lưu được thông tin hợp đồng."
    }, { status: 400 });
  }
}
