import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { bootstrapSchedulePeople } from "@/lib/employeeRoster";

export const runtime = "nodejs";

export async function POST() {
  const session = await getDashboardSession();
  if (!session) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  if (session.accountType !== "admin") {
    return NextResponse.json({ success: false, message: "Chỉ Admin được nạp dữ liệu nhân viên mặc định." }, { status: 403 });
  }

  try {
    return NextResponse.json(await bootstrapSchedulePeople());
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không nạp được dữ liệu nhân viên mặc định." },
      { status: 503 }
    );
  }
}
