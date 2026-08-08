import type { ConfirmRole, PeoplePayload, SchedulePayload } from "@/lib/types";

type ScheduleRange = {
  from?: string;
  to?: string;
};

type ConfirmScheduleInput = ScheduleRange & {
  sessionId: string;
  role: ConfirmRole;
  confirmed: boolean;
  actorType: "admin" | "employee";
  actorRole?: "host" | "support";
  actorEmployeeId?: string;
};

type GoogleApiPayload = {
  success: boolean;
  error?: string;
  message?: string;
};

function getGoogleScheduleConfig() {
  const apiUrl = process.env.GOOGLE_SCHEDULE_API_URL;
  const token = process.env.GOOGLE_SCHEDULE_API_TOKEN;

  if (!apiUrl || !token) {
    throw new Error("Missing GOOGLE_SCHEDULE_API_URL or GOOGLE_SCHEDULE_API_TOKEN.");
  }

  return { apiUrl, token };
}

async function parseGoogleResponse<T extends GoogleApiPayload>(response: Response) {
  const text = await response.text();
  let payload: T;

  try {
    payload = JSON.parse(text) as T;
  } catch {
    const looksLikeHtml = text.trim().startsWith("<!doctype html") || text.includes("accounts.google.com");
    if (looksLikeHtml) {
      throw new Error(
        "Apps Script returned HTML instead of JSON. Check that GOOGLE_SCHEDULE_API_URL is the Web app /exec URL and the deployment access is Anyone."
      );
    }

    throw new Error("Google Schedule API returned invalid JSON.");
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || payload.message || "Google Schedule API request failed.");
  }

  return payload;
}

export async function fetchSchedule(range: ScheduleRange = {}) {
  const { apiUrl, token } = getGoogleScheduleConfig();
  const url = new URL(apiUrl);
  url.searchParams.set("action", "schedule");
  url.searchParams.set("token", token);
  if (range.from) url.searchParams.set("from", range.from);
  if (range.to) url.searchParams.set("to", range.to);

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  return parseGoogleResponse<SchedulePayload>(response);
}

export async function fetchSchedulePeopleFromGoogle() {
  const { apiUrl, token } = getGoogleScheduleConfig();
  const url = new URL(apiUrl);
  url.searchParams.set("action", "people");
  url.searchParams.set("token", token);
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  const payload = await parseGoogleResponse<PeoplePayload & SchedulePayload>(response);
  if (!Array.isArray(payload.hosts) || !Array.isArray(payload.supports) || payload.fallback) {
    throw new Error("Apps Script deployment chưa hỗ trợ roster master. Hãy deploy WebApi.gs phiên bản mới rồi thử lại.");
  }
  return payload;
}

export async function refreshSchedule(range: ScheduleRange = {}) {
  const { apiUrl, token } = getGoogleScheduleConfig();
  const response = await fetch(apiUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action: "refresh",
      token,
      from: range.from,
      to: range.to
    })
  });

  const payload = await parseGoogleResponse<SchedulePayload>(response);
  return payload;
}

export async function confirmSchedule(input: ConfirmScheduleInput) {
  const { apiUrl, token } = getGoogleScheduleConfig();
  const response = await fetch(apiUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action: "confirm",
      token,
      sessionId: input.sessionId,
      role: input.role,
      confirmed: input.confirmed,
      actorType: input.actorType,
      actorRole: input.actorRole,
      actorEmployeeId: input.actorEmployeeId,
      from: input.from,
      to: input.to
    })
  });

  return parseGoogleResponse<SchedulePayload>(response);
}
