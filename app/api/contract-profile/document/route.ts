import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { getContractImageDownloadUrl } from "@/lib/contractCloudinary";
import { getEmployeeContractProfile, type EmployeeContractDocumentSide } from "@/lib/employeeContract";
import { resolveEmployeeContractPerson } from "@/lib/employeeContractAccess";

export const runtime = "nodejs";

function readSide(value: string | null): EmployeeContractDocumentSide | null {
  return value === "front" || value === "back" ? value : null;
}

export async function GET(request: Request) {
  const session = await getDashboardSession();
  if (!session) return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });

  const url = new URL(request.url);
  const side = readSide(url.searchParams.get("side"));
  if (!side) return NextResponse.json({ success: false, message: "Mặt CCCD không hợp lệ." }, { status: 400 });

  const person = await resolveEmployeeContractPerson({
    session,
    role: url.searchParams.get("role"),
    employeeId: url.searchParams.get("employeeId")
  });
  if (!person) return NextResponse.json({ success: false, message: "Không tìm thấy nhân viên." }, { status: 404 });

  const profile = await getEmployeeContractProfile(person.role, person.id);
  const file = side === "front" ? profile?.citizenIdFront : profile?.citizenIdBack;
  if (!file) return NextResponse.json({ success: false, message: "Chưa có ảnh CCCD này." }, { status: 404 });

  return NextResponse.redirect(getContractImageDownloadUrl(file));
}
