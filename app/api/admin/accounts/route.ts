import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/auth";
import {
  listManagedEmployeeAccounts,
  resetEmployeePassword,
  revokeEmployeeSessions,
  setEmployeeAccountLocked
} from "@/lib/userAccounts";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await getDashboardSession();
  return session?.accountType === "admin" ? session : null;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ success: false, message: "Chỉ Admin được quản lý tài khoản." }, { status: 403 });
  }

  try {
    const accounts = await listManagedEmployeeAccounts();
    return NextResponse.json({ success: true, accounts }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không tải được tài khoản." },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ success: false, message: "Chỉ Admin được quản lý tài khoản." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      action?: "reset_password" | "lock" | "unlock" | "revoke_sessions";
      accountKey?: string;
      newPassword?: string;
      confirmPassword?: string;
    };
    if (!body.accountKey || !body.action) {
      return NextResponse.json({ success: false, message: "Thiếu tài khoản hoặc thao tác." }, { status: 400 });
    }

    if (body.action === "reset_password") {
      await resetEmployeePassword({
        accountKey: body.accountKey,
        newPassword: body.newPassword || "",
        confirmPassword: body.confirmPassword || "",
        actorAccountKey: session.accountKey
      });
      return NextResponse.json({ success: true, message: "Đã đặt mật khẩu mới và đăng xuất tài khoản khỏi mọi thiết bị." });
    }
    if (body.action === "lock" || body.action === "unlock") {
      await setEmployeeAccountLocked({
        accountKey: body.accountKey,
        locked: body.action === "lock",
        actorAccountKey: session.accountKey
      });
      return NextResponse.json({
        success: true,
        message: body.action === "lock"
          ? "Đã khóa tài khoản và thu hồi mọi phiên đăng nhập."
          : "Đã mở khóa tài khoản. Nhân viên có thể đăng nhập lại."
      });
    }
    if (body.action === "revoke_sessions") {
      await revokeEmployeeSessions({ accountKey: body.accountKey, actorAccountKey: session.accountKey });
      return NextResponse.json({ success: true, message: "Đã đăng xuất tài khoản khỏi mọi thiết bị." });
    }

    return NextResponse.json({ success: false, message: "Thao tác không hợp lệ." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không cập nhật được tài khoản.";
    const status = message.includes("không tìm thấy") ? 404 : message.includes("nơi khác") ? 409 : 400;
    return NextResponse.json({ success: false, message }, { status });
  }
}
