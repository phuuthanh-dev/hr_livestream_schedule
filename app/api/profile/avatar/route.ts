import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import { deleteEmployeeAvatar, verifyEmployeeAvatar } from "@/lib/employeeAvatarCloudinary";
import { removeSchedulePersonAvatar, saveSchedulePersonAvatar } from "@/lib/employeeRoster";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (session?.accountType !== "employee" || !session.role || !session.employeeId) {
    return NextResponse.json({ success: false, message: "Chỉ nhân viên được cập nhật avatar của mình." }, { status: 403 });
  }
  let uploadedPublicId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    uploadedPublicId = String(body.publicId ?? "").trim();
    if (!uploadedPublicId) throw new Error("Thiếu avatar đã tải lên.");
    const avatar = await verifyEmployeeAvatar({
      role: session.role,
      employeeId: session.employeeId,
      publicId: uploadedPublicId
    });
    const result = await saveSchedulePersonAvatar({
      role: session.role,
      employeeId: session.employeeId,
      avatar,
      actorAccountKey: session.accountKey
    });
    uploadedPublicId = "";
    if (result.replacedAvatar?.publicId && result.replacedAvatar.publicId !== avatar.publicId) {
      await deleteEmployeeAvatar(result.replacedAvatar.publicId).catch(() => undefined);
    }
    return NextResponse.json({ success: true, employee: result.employee, message: "Đã cập nhật ảnh đại diện." });
  } catch (error) {
    if (uploadedPublicId) await deleteEmployeeAvatar(uploadedPublicId).catch(() => undefined);
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không cập nhật được ảnh đại diện."
    }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await getDashboardSession();
  if (session?.accountType !== "employee" || !session.role || !session.employeeId) {
    return NextResponse.json({ success: false, message: "Chỉ nhân viên được xóa avatar của mình." }, { status: 403 });
  }
  try {
    const result = await removeSchedulePersonAvatar({
      role: session.role,
      employeeId: session.employeeId,
      actorAccountKey: session.accountKey
    });
    if (result.removedAvatar?.publicId) await deleteEmployeeAvatar(result.removedAvatar.publicId).catch(() => undefined);
    return NextResponse.json({ success: true, employee: result.employee, message: "Đã xóa ảnh đại diện." });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "Không xóa được ảnh đại diện."
    }, { status: 400 });
  }
}
