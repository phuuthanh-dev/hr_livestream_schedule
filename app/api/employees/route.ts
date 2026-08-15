import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { employeeContractPersonKey, listEmployeeContractSummaries } from "@/lib/employeeContract";
import { listSupportTrainingSummaries } from "@/lib/supportTraining";
import {
  hardDeleteSchedulePerson,
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
    const [roster, contractSummaries, trainingSummaries] = await Promise.all([
      listSchedulePeopleForAdmin(),
      listEmployeeContractSummaries(),
      listSupportTrainingSummaries()
    ]);
    const employees = roster.map((employee) => {
      const trainingProfile = employee.role === "support"
        ? trainingSummaries.get(employeeContractPersonKey("support", employee.id))
        : undefined;
      return {
        ...employee,
        rating: trainingProfile?.rating || employee.rating,
        cashOffer: trainingProfile?.cashOffer || employee.cashOffer,
        contractProfile: contractSummaries.get(employeeContractPersonKey(employee.role, employee.id)) || {
          completed: false,
          hasFront: false,
          hasBack: false
        },
        trainingProfile
      };
    });
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

  await request.text().catch(() => "");
  return NextResponse.json<EmployeeAdminPayload>(
    {
      success: false,
      message: "Production không cho tạo nhân viên tay từ admin. Hãy dùng form ứng tuyển hoặc sync sheet tuyển dụng."
    },
    { status: 405 }
  );
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

export async function DELETE(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json<EmployeeAdminPayload>({ success: false, message: "Chỉ Admin được quản lý nhân viên." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { role?: "host" | "support"; id?: string };
    if ((body.role !== "host" && body.role !== "support") || !body.id?.trim()) {
      return NextResponse.json<EmployeeAdminPayload>({ success: false, message: "Thiếu mã nhân viên hoặc vai trò." }, { status: 400 });
    }

    const result = await hardDeleteSchedulePerson(body.role, body.id);
    return NextResponse.json<EmployeeAdminPayload>({
      success: true,
      message: `Đã xoá cứng ${result.employee.name}.`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không xoá được nhân viên.";
    return NextResponse.json<EmployeeAdminPayload>({ success: false, message }, { status: errorStatus(message) });
  }
}
