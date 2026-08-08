import type { ConfirmRole, PeoplePayload, SchedulePayload, SchedulePerson } from "@/lib/types";

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

function buildPeopleFromSchedule(rows: SchedulePayload["rows"]): PeoplePayload {
  const hosts = new Map<string, SchedulePerson>();
  const supports = new Map<string, SchedulePerson>();
  (rows || []).forEach((row) => {
    if (row.hostId) {
      hosts.set(row.hostId.toLowerCase(), {
        id: row.hostId,
        name: row.hostName || row.hostId,
        role: "host"
      });
    }
    if (row.supportId) {
      supports.set(row.supportId.toLowerCase(), {
        id: row.supportId,
        name: row.supportName || row.supportId,
        role: "support"
      });
    }
  });
  const byName = (left: SchedulePerson, right: SchedulePerson) => left.name.localeCompare(right.name, "vi");
  return {
    success: true,
    source: "Live_Session_Master fallback",
    fallback: true,
    hosts: Array.from(hosts.values()).sort(byName),
    supports: Array.from(supports.values()).sort(byName)
  };
}

let peopleCache: { expiresAt: number; payload: PeoplePayload } | null = null;

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

export async function fetchSchedulePeople() {
  if (peopleCache && peopleCache.expiresAt > Date.now()) {
    return peopleCache.payload;
  }

  const { apiUrl, token } = getGoogleScheduleConfig();
  const url = new URL(apiUrl);
  url.searchParams.set("action", "people");
  url.searchParams.set("token", token);
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  const payload = await parseGoogleResponse<PeoplePayload & SchedulePayload>(response);
  const peoplePayload = payload.hosts && payload.supports
    ? payload
    : buildPeopleFromSchedule(payload.rows);
  peopleCache = { expiresAt: Date.now() + 5 * 60 * 1000, payload: peoplePayload };
  return peoplePayload;
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
  peopleCache = null;
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
