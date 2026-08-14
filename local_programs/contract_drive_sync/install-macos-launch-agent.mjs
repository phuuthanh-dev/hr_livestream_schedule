#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import {
  buildLaunchAgentPlist,
  buildLocalProgramEnv,
  loadLocalProgramEnv,
  programRoot,
  repoRoot
} from "./runtime.mjs";

const plistDir = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(plistDir, "co.delements.hr.contract-drive-sync.plist");
const scriptPath = path.join(repoRoot, "local_programs/contract_drive_sync/sync-contracts.mjs");

loadLocalProgramEnv();
const config = buildLocalProgramEnv({
  programRoot,
  allowPartial: true
});
const stateDir = path.dirname(config.statePath);

const xml = buildLaunchAgentPlist({
  nodePath: process.execPath,
  repoRoot,
  scriptPath,
  stateDir,
  intervalMinutes: config.intervalMinutes
});

fs.mkdirSync(plistDir, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(plistPath, xml);

console.log(`Đã tạo LaunchAgent: ${plistPath}`);
console.log("Nạp agent bằng:");
console.log(`launchctl unload ${plistPath} 2>/dev/null || true`);
console.log(`launchctl load ${plistPath}`);
