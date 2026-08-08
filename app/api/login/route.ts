import { NextResponse } from "next/server";
import { setDashboardSession } from "@/lib/auth";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "@/lib/loginRateLimit";
import { findSchedulePerson } from "@/lib/schedulePeople";
import { authenticateAdmin, authenticateEmployee } from "@/lib/userAccounts";
import type { EmployeeRole } from "@/lib/types";

export const runtime = "nodejs";

type LoginBody = {
  loginType?: "admin" | "employee";
  role?: EmployeeRole;
  employeeId?: string;
  password?: string;
  confirmPassword?: string;
  createPassword?: boolean;
};

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function isAccountStoreUnavailable(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.includes("Missing MONGODB_URI") || error.name.startsWith("Mongo");
}

export async function POST(request: Request) {
  let rateLimitKey = `unknown:${getClientIp(request)}`;
  try {
    const body = (await request.json()) as LoginBody;
    if (body.loginType !== "admin" && body.loginType !== "employee") {
      return NextResponse.json({ success: false, message: "Loại đăng nhập không hợp lệ." }, { status: 400 });
    }

    const loginType = body.loginType;
    const password = body.password || "";
    const identity = loginType === "admin" ? "admin" : `${body.role || "unknown"}:${body.employeeId || "unknown"}`;
    rateLimitKey = `${getClientIp(request)}:${identity.toLowerCase()}`;
    const rateLimit = checkLoginRateLimit(rateLimitKey);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau." },
        { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
      );
    }

    if (!password) {
      return NextResponse.json({ success: false, message: "Vui lòng nhập mật khẩu." }, { status: 400 });
    }

    if (loginType === "admin") {
      const result = await authenticateAdmin(password);
      await setDashboardSession(result.account);
      clearLoginFailures(rateLimitKey);
      return NextResponse.json({ success: true, created: result.created });
    }

    if ((body.role !== "host" && body.role !== "support") || !body.employeeId) {
      return NextResponse.json({ success: false, message: "Vui lòng chọn vai trò và nhân viên." }, { status: 400 });
    }

    const person = await findSchedulePerson(body.role, body.employeeId);
    if (!person) {
      return NextResponse.json({ success: false, message: "Nhân viên không còn tồn tại trong master." }, { status: 403 });
    }

    const result = await authenticateEmployee({
      person,
      password,
      confirmPassword: body.confirmPassword,
      createPassword: body.createPassword
    });
    await setDashboardSession(result.account);
    clearLoginFailures(rateLimitKey);
    return NextResponse.json({ success: true, created: result.created });
  } catch (error) {
    if (isAccountStoreUnavailable(error)) {
      console.error("Account store is unavailable during login.", error);
      return NextResponse.json(
        { success: false, message: "Hệ thống tài khoản đang chưa kết nối được MongoDB. Vui lòng báo Admin hoặc thử lại sau." },
        { status: 503 }
      );
    }
    recordLoginFailure(rateLimitKey);
    const message = error instanceof Error ? error.message : "Không đăng nhập được.";
    const status = message.includes("ít nhất 8") || message.includes("72 byte") || message.includes("nhập lại") ? 400 : 401;
    return NextResponse.json(
      { success: false, message },
      { status }
    );
  }
}
