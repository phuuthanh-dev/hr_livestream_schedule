import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { findActiveSchedulePerson } from "@/lib/employeeRoster";
import type { AccountType, EmployeeRole } from "@/lib/types";

const SESSION_COOKIE = "hr_schedule_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type DashboardSession = {
  user: string;
  displayName: string;
  accountType: AccountType;
  role?: EmployeeRole;
  employeeId?: string;
  expiresAt: number;
};

export type DashboardSessionIdentity = Omit<DashboardSession, "expiresAt">;

function getAuthSecret() {
  const secret = process.env.DASHBOARD_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("Missing DASHBOARD_AUTH_SECRET.");
  }
  return secret || "local-dev-dashboard-secret";
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSessionToken(identity: DashboardSessionIdentity) {
  const payload: DashboardSession = {
    ...identity,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySessionToken(token?: string) {
  if (!token) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || !safeEqual(sign(encodedPayload), signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as DashboardSession;
    if (!payload.user || !payload.displayName || !payload.accountType || !payload.expiresAt || payload.expiresAt < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getDashboardSession() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session || session.accountType !== "employee") return session;
  if (!session.role || !session.employeeId) return null;

  const person = await findActiveSchedulePerson(session.role, session.employeeId);
  if (!person) return null;
  return {
    ...session,
    user: person.id,
    employeeId: person.id,
    displayName: person.name
  };
}

export async function setDashboardSession(identity: DashboardSessionIdentity) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createSessionToken(identity), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
    path: "/"
  });
}

export async function clearDashboardSession() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/"
  });
}
