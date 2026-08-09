import { NextResponse } from "next/server";
import { getDashboardSession, setDashboardSession } from "@/lib/auth";
import { changeOwnPassword } from "@/lib/userAccounts";

export const runtime = "nodejs";

function getPasswordErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("hiện tại không đúng")) return 401;
  if (message.includes("nơi khác")) return 409;
  if (message.includes("bị khóa")) return 403;
  return 400;
}

export async function POST(request: Request) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };
    const account = await changeOwnPassword({
      accountKey: session.accountKey,
      currentPassword: body.currentPassword || "",
      newPassword: body.newPassword || "",
      confirmPassword: body.confirmPassword || ""
    });
    await setDashboardSession(account);
    return NextResponse.json({
      success: true,
      message: "Đã đổi mật khẩu và thu hồi các phiên đăng nhập cũ."
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không đổi được mật khẩu." },
      { status: getPasswordErrorStatus(error) }
    );
  }
}
