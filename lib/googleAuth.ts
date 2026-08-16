import { google } from "googleapis";

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}.`);
  }
  return value;
}

function readGooglePrivateKey() {
  const directKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  if (directKey) return directKey.replace(/\\n/g, "\n");
  return readRequiredEnv("GOOGLE_SHEETS_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function readGoogleClientEmail() {
  return process.env.GOOGLE_CLIENT_EMAIL?.trim() || readRequiredEnv("GOOGLE_SHEETS_CLIENT_EMAIL");
}

export function createGoogleJwt(scopes: string[]) {
  return new google.auth.JWT({
    email: readGoogleClientEmail(),
    key: readGooglePrivateKey(),
    scopes
  });
}
