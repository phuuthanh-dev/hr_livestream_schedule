import { NextResponse } from "next/server";
import { setDashboardSession, verifyDashboardLogin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const username = body.username?.trim() || "";
    const password = body.password || "";

    if (!verifyDashboardLogin(username, password)) {
      return NextResponse.json({ success: false, message: "Sai tài khoản hoặc mật khẩu." }, { status: 401 });
    }

    await setDashboardSession(username);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Không đăng nhập được." },
      { status: 500 }
    );
  }
}
