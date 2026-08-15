import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { employeeContractPersonKey, listEmployeeContractSummaries } from "@/lib/employeeContract";
import { importRecruitmentProfilesFromSheets, importRecruitmentProfilesFromSheetsWithMode } from "@/lib/recruitmentSheetImport";
import { listPeopleApplications } from "@/lib/peopleApplication";
import { listRecruitmentProfiles, saveRecruitmentProfile } from "@/lib/recruitmentProfile";
import type { EmployeeRole } from "@/lib/types";

export const runtime = "nodejs";

function isEmployeeRole(value: string | undefined): value is EmployeeRole {
  return value === "host" || value === "support";
}

async function requireAdmin() {
  const session = await getDashboardSession();
  return session?.accountType === "admin" ? session : null;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ success: false, message: "Chỉ Admin được xem hồ sơ tuyển dụng." }, { status: 403 });
  }

  try {
    const [applications, profiles, contractSummaries] = await Promise.all([
      listPeopleApplications(),
      listRecruitmentProfiles(),
      listEmployeeContractSummaries()
    ]);
    type JoinedRecord = {
      application: (typeof applications)[number] | null;
      profile: (typeof profiles)[number] | null;
      contractSummary: ReturnType<typeof contractSummaries.get> | null;
    };
    const profileMap = new Map<string, (typeof profiles)[number]>(
      profiles.map((profile) => [`${profile.role}:${profile.employeeId}`, profile] as const)
    );
    const applicationMap = new Map<string, (typeof applications)[number]>(
      applications.map((application) => [`${application.role}:${application.employeeId || application.applicationId}`, application] as const)
    );
    const records: JoinedRecord[] = applications.map((application) => {
      const key = application.employeeId ? `${application.role}:${application.employeeId}` : "";
      return {
        application,
        profile: key ? profileMap.get(key) || null : null,
        contractSummary: application.employeeId
          ? contractSummaries.get(employeeContractPersonKey(application.role, application.employeeId)) || null
          : null
      };
    });
    profiles.forEach((profile) => {
      const key = `${profile.role}:${profile.employeeId}`;
      if (applicationMap.has(key)) return;
      records.push({
        application: null,
        profile,
        contractSummary: contractSummaries.get(employeeContractPersonKey(profile.role, profile.employeeId)) || null
      });
    });
    return NextResponse.json({
      success: true,
      records,
      total: records.length
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được hồ sơ tuyển dụng." },
      { status: 503 }
    );
  }
}

export async function PUT(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ success: false, message: "Chỉ Admin được cập nhật hồ sơ tuyển dụng." }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      role?: EmployeeRole;
      employeeId?: string;
      values?: Record<string, unknown>;
    };
    if (!isEmployeeRole(body.role) || !body.employeeId?.trim()) {
      return NextResponse.json({ success: false, message: "Thiếu vai trò hoặc mã nhân viên." }, { status: 400 });
    }
    const profile = await saveRecruitmentProfile({
      role: body.role,
      employeeId: body.employeeId.trim(),
      actorAccountKey: session.accountKey,
      values: (body.values || {}) as never
    });
    return NextResponse.json({
      success: true,
      profile,
      message: `Đã cập nhật hồ sơ tuyển dụng ${profile.employeeId}.`
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không cập nhật được hồ sơ tuyển dụng." },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ success: false, message: "Chỉ Admin được import từ sheet nguồn." }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const payload = dryRun
      ? await importRecruitmentProfilesFromSheetsWithMode(session.accountKey, { dryRun: true })
      : await importRecruitmentProfilesFromSheets(session.accountKey);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không import được hồ sơ tuyển dụng từ sheet." },
      { status: 400 }
    );
  }
}
