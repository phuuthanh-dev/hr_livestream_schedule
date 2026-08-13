import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { employeeContractPersonKey, listEmployeeContractSummaries } from "@/lib/employeeContract";
import {
  createSchedulePerson,
  listSchedulePeopleForAdmin,
  updateSchedulePerson,
  type SchedulePersonMutation
} from "@/lib/employeeRoster";
import type { EmployeeAdminPayload } from "@/lib/types";

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
    return NextResponse.json<EmployeeAdminPayload>({ success: false, message: "Chỉ Admin được quản lý nhân viên." }, { status: 403 });
  }

  try {
    const [roster, contractSummaries] = await Promise.all([
      listSchedulePeopleForAdmin(),
      listEmployeeContractSummaries()
    ]);
    const employees = roster.map((employee) => ({
      ...employee,
      contractProfile: contractSummaries.get(employeeContractPersonKey(employee.role, employee.id)) || {
        completed: false,
        hasFront: false,
        hasBack: false
      }
    }));
    const activeEmployees = employees.filter((employee) => employee.active !== false);
    const incomplete = activeEmployees.filter((employee) =>
      !employee.name || !employee.phone || !employee.level || (employee.role === "host" && !employee.workLocation)
    ).length;
    return NextResponse.json<EmployeeAdminPayload>({
      success: true,
      employees,
      total: employees.length,
      activeTotal: activeEmployees.length,
      hosts: activeEmployees.filter((employee) => employee.role === "host").length,
      supports: activeEmployees.filter((employee) => employee.role === "support").length,
      incomplete
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json<EmployeeAdminPayload>(
      { success: false, message: error instanceof Error ? error.message : "Không tải được danh sách nhân viên." },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json<EmployeeAdminPayload>({ success: false, message: "Chỉ Admin được quản lý nhân viên." }, { status: 403 });
  }

  try {
    const input = (await request.json()) as SchedulePersonMutation;
    const employee = await createSchedulePerson(input, session.accountKey);
    return NextResponse.json<EmployeeAdminPayload>(
      { success: true, employee, message: `Đã thêm nhân viên ${employee.name}.` },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thêm được nhân viên.";
    return NextResponse.json<EmployeeAdminPayload>({ success: false, message }, { status: errorStatus(message) });
  }
}

export async function PUT(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json<EmployeeAdminPayload>({ success: false, message: "Chỉ Admin được quản lý nhân viên." }, { status: 403 });
  }

  try {
    const input = (await request.json()) as SchedulePersonMutation;
    const employee = await updateSchedulePerson(input, session.accountKey);
    return NextResponse.json<EmployeeAdminPayload>({
      success: true,
      employee,
      message: `Đã cập nhật hồ sơ ${employee.name}.`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không cập nhật được nhân viên.";
    return NextResponse.json<EmployeeAdminPayload>({ success: false, message }, { status: errorStatus(message) });
  }
}
