import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { createEmployeeAvatarUploadSignature } from "@/lib/employeeAvatarCloudinary";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "employee" || !session.role || !session.employeeId) {
    return NextResponse.json({ success: false, message: "Chỉ nhân viên được cập nhật avatar của mình." }, { status: 403 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const upload = createEmployeeAvatarUploadSignature({
      role: session.role,
      employeeId: session.employeeId,
      contentType: body.contentType,
      size: body.size
    });
    return NextResponse.json({ success: true, upload }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không tạo được phiên tải avatar."
    }, { status: 400 });
  }
}
