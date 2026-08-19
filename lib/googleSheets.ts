import { google } from "googleapis";
import { createGoogleJwt } from "@/lib/googleAuth";

const GOOGLE_SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];
const DEFAULT_HR_MASTER_SPREADSHEET_ID = "1x6nVWbe1v80Px4UVRYciOwFJYNdEF8f6LC4gKGbgclw";
const DEFAULT_LIVE_SESSION_MASTER_SHEET_NAME = "Live_Session_Master";

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}.`);
  }
  return value;
}

export function getGoogleSheetsSpreadsheetId() {
  return readRequiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
}

export function getGoogleHrMasterSpreadsheetId() {
  return process.env.GOOGLE_HR_MASTER_SPREADSHEET_ID?.trim() || DEFAULT_HR_MASTER_SPREADSHEET_ID;
}

export function getGoogleLiveSessionMasterSheetName() {
  return process.env.GOOGLE_LIVE_SESSION_MASTER_SHEET_NAME?.trim() || DEFAULT_LIVE_SESSION_MASTER_SHEET_NAME;
}

export function createGoogleSheetsClient() {
  const auth = createGoogleJwt(GOOGLE_SHEETS_SCOPE);

  return google.sheets({
    version: "v4",
    auth
  });
}
