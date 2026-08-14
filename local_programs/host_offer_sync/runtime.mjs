import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const defaultSpreadsheetId = "12WU5jM-KC9EngkA_xBS3U82KYnO-8RMwGwk9fwcGe3o";
export const defaultTabName = "Thông tin Mẫu Live";
export const defaultRangeA1 = `${defaultTabName}!A1:Z1200`;
export const defaultStateRelativePath = "./.state/last-run.json";
export const defaultBatchLimit = 50;
export const defaultGwsCandidates = ["/opt/homebrew/bin/gws", "/usr/local/bin/gws"];
export const programRoot = __dirname;
export const repoRoot = path.resolve(programRoot, "..", "..");
export const localEnvPath = path.join(programRoot, ".env.local");

export function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return target;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || target[key] != null) continue;
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    target[key] = value.replace(/\\n/g, "\n");
  }
  return target;
}

export function loadLocalProgramEnv(target = process.env) {
  return loadEnvFile(localEnvPath, target);
}

export function readEnvValue(envSource, name, fallback = "") {
  const value = envSource?.[name];
  return typeof value === "string" ? value.trim() : fallback;
}

function isExistingFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

export function resolveExecutablePath(executableName, {
  envSource = process.env,
  candidates = []
} = {}) {
  const pathEntries = String(envSource?.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);

  for (const candidate of [
    ...candidates,
    ...pathEntries.map((entry) => path.join(entry, executableName))
  ]) {
    if (candidate && isExistingFile(candidate)) return candidate;
  }

  throw new Error(`Không tìm thấy CLI ${executableName}. Hãy cài ${executableName} và bảo đảm lệnh này chạy được trên máy local.`);
}

export function buildLocalProgramEnv({
  envSource = process.env,
  programRoot: customProgramRoot = programRoot,
  resolveExecutable = resolveExecutablePath
} = {}) {
  return {
    spreadsheetId: readEnvValue(envSource, "LOCAL_HOST_OFFER_SPREADSHEET_ID", defaultSpreadsheetId) || defaultSpreadsheetId,
    tabName: readEnvValue(envSource, "LOCAL_HOST_OFFER_TAB", defaultTabName) || defaultTabName,
    rangeA1: readEnvValue(envSource, "LOCAL_HOST_OFFER_RANGE", defaultRangeA1) || defaultRangeA1,
    batchLimit: Number(readEnvValue(envSource, "LOCAL_HOST_OFFER_BATCH_LIMIT", String(defaultBatchLimit))) || defaultBatchLimit,
    statePath: path.resolve(
      customProgramRoot,
      readEnvValue(envSource, "LOCAL_HOST_OFFER_STATE_PATH", defaultStateRelativePath)
    ),
    gwsPath: resolveExecutable("gws", {
      envSource,
      candidates: defaultGwsCandidates
    })
  };
}

export function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
