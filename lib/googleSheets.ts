import { google } from "googleapis";

const GOOGLE_SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}.`);
  }
  return value;
}

function readGoogleSheetsPrivateKey() {
  return readRequiredEnv("GOOGLE_SHEETS_PRIVATE_KEY").replace(/\\n/g, "\n");
}

export function getGoogleSheetsSpreadsheetId() {
  return readRequiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
}

export function createGoogleSheetsClient() {
  const auth = new google.auth.JWT({
    email: readRequiredEnv("GOOGLE_SHEETS_CLIENT_EMAIL"),
    key: readGoogleSheetsPrivateKey(),
    scopes: GOOGLE_SHEETS_SCOPE
  });

  return google.sheets({
    version: "v4",
    auth
  });
}
