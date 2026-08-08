import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { syncSchedulePeopleToMongo } from "@/lib/employeeRoster";
import { fetchSchedulePeopleFromGoogle } from "@/lib/googleSchedule";

export const runtime = "nodejs";

export async function POST() {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được cập nhật danh sách nhân viên." }, { status: 403 });
  }

  try {
    const googlePeople = await fetchSchedulePeopleFromGoogle();
    const payload = await syncSchedulePeopleToMongo(googlePeople);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không cập nhật được danh sách nhân viên." },
      { status: 502 }
    );
  }
}
