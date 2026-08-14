import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const defaultFolderId = "1IxJs0myuunN49Z944vWzu1gr_8OqLFKv";
export const defaultStateRelativePath = "./.state/last-sync.json";
export const defaultIntervalMinutes = 60;
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

export function requiredEnvValue(envSource, name, locationLabel = localEnvPath) {
  const value = readEnvValue(envSource, name);
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name} trong ${locationLabel}.`);
  }
  return value;
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
  rootFolderId = readEnvValue(envSource, "LOCAL_CONTRACT_SYNC_FOLDER_ID", defaultFolderId) || defaultFolderId,
  programRoot: customProgramRoot = programRoot,
  allowPartial = false,
  resolveExecutable = resolveExecutablePath
} = {}) {
  const requiredOrEmpty = (name) => allowPartial
    ? readEnvValue(envSource, name)
    : requiredEnvValue(envSource, name);

  return {
    rootFolderId,
    mongoDbName: readEnvValue(envSource, "LOCAL_CONTRACT_SYNC_MONGODB_DB", "hr_streaming"),
    mongodbUri: requiredOrEmpty("LOCAL_CONTRACT_SYNC_MONGODB_URI"),
    cloudinaryUrl: requiredOrEmpty("LOCAL_CONTRACT_SYNC_CLOUDINARY_URL"),
    statePath: path.resolve(
      customProgramRoot,
      readEnvValue(envSource, "LOCAL_CONTRACT_SYNC_STATE_PATH", defaultStateRelativePath)
    ),
    intervalMinutes: Number(readEnvValue(envSource, "LOCAL_CONTRACT_SYNC_INTERVAL_MINUTES", String(defaultIntervalMinutes))) || defaultIntervalMinutes,
    gwsPath: resolveExecutable("gws", {
      envSource,
      candidates: defaultGwsCandidates
    })
  };
}

export function buildLaunchAgentPlist({
  nodePath,
  repoRoot: plistRepoRoot,
  scriptPath,
  stateDir,
  intervalMinutes
}) {
  const startIntervalSeconds = Math.max(1, Number(intervalMinutes) || defaultIntervalMinutes) * 60;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>co.delements.hr.contract-drive-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${plistRepoRoot}</string>
  <key>StartInterval</key>
  <integer>${startIntervalSeconds}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(stateDir, "launchd.stdout.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(stateDir, "launchd.stderr.log")}</string>
</dict>
</plist>
`;
}
