import type { ConfirmRole, SchedulePayload } from "@/lib/types";

type ScheduleRange = {
  from?: string;
  to?: string;
};

type ConfirmScheduleInput = ScheduleRange & {
  sessionId: string;
  role: ConfirmRole;
  confirmed: boolean;
};

function getGoogleScheduleConfig() {
  const apiUrl = process.env.GOOGLE_SCHEDULE_API_URL;
  const token = process.env.GOOGLE_SCHEDULE_API_TOKEN;

  if (!apiUrl || !token) {
    throw new Error("Missing GOOGLE_SCHEDULE_API_URL or GOOGLE_SCHEDULE_API_TOKEN.");
  }

  return { apiUrl, token };
}

async function parseScheduleResponse(response: Response) {
  const text = await response.text();
  let payload: SchedulePayload;

  try {
    payload = JSON.parse(text) as SchedulePayload;
  } catch {
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

  return parseScheduleResponse(response);
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

  return parseScheduleResponse(response);
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
      from: input.from,
      to: input.to
    })
  });

  return parseScheduleResponse(response);
}
