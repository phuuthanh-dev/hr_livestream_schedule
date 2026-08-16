import { google } from "googleapis";
import { createGoogleJwt } from "@/lib/googleAuth";

const GOOGLE_SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];

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

export function createGoogleSheetsClient() {
  const auth = createGoogleJwt(GOOGLE_SHEETS_SCOPE);

  return google.sheets({
    version: "v4",
    auth
  });
}
