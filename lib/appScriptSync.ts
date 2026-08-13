type AppScriptSyncPayload = Record<string, unknown>;

function getAppScriptApiUrl() {
  const url = process.env.GOOGLE_SOURCE_APPS_SCRIPT_API_URL?.trim()
    || process.env.GOOGLE_APPS_SCRIPT_API_URL?.trim();
  if (!url) throw new Error("Thiếu GOOGLE_SOURCE_APPS_SCRIPT_API_URL.");
  return url;
}

function getAppScriptApiToken() {
  const token = process.env.GOOGLE_SOURCE_APPS_SCRIPT_API_TOKEN?.trim()
    || process.env.GOOGLE_APPS_SCRIPT_API_TOKEN?.trim();
  if (!token) throw new Error("Thiếu GOOGLE_SOURCE_APPS_SCRIPT_API_TOKEN.");
  return token;
}

export async function postToAppScript(payload: AppScriptSyncPayload) {
  const response = await fetch(getAppScriptApiUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, token: getAppScriptApiToken() }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store"
  });

  let body: Record<string, unknown> = {};
  try {
    body = await response.json();
  } catch {
    throw new Error("Apps Script trả về dữ liệu không hợp lệ.");
  }

  if (!response.ok || body.success !== true) {
    const message = typeof body.error === "string"
      ? body.error
      : typeof body.message === "string"
        ? body.message
        : "Không đồng bộ được dữ liệu sang Google Sheet.";
    throw new Error(message);
  }

  return body;
}
