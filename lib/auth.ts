import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "hr_schedule_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type DashboardSession = {
  user: string;
  expiresAt: number;
};

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

export function verifyDashboardLogin(username: string, password: string) {
  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    throw new Error("Missing DASHBOARD_USERNAME or DASHBOARD_PASSWORD.");
  }

  return safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
}

export function createSessionToken(username: string) {
  const payload: DashboardSession = {
    user: username,
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
    if (!payload.user || !payload.expiresAt || payload.expiresAt < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getDashboardSession() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function setDashboardSession(username: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createSessionToken(username), {
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
