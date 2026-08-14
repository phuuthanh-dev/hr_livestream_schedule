import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildLocalProgramEnv,
  buildLaunchAgentPlist,
  resolveExecutablePath
} from "../local_programs/contract_drive_sync/runtime.mjs";

test("resolveExecutablePath finds gws from PATH", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-drive-sync-bin-"));
  const gwsPath = path.join(tempDir, "gws");
  fs.writeFileSync(gwsPath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(gwsPath, 0o755);

  const resolved = resolveExecutablePath("gws", {
    envSource: { PATH: tempDir }
  });

  assert.equal(resolved, gwsPath);
});

test("buildLocalProgramEnv resolves interval, state path, and gws path from local env", () => {
  const config = buildLocalProgramEnv({
    programRoot: "/tmp/contract_drive_sync",
    envSource: {
      LOCAL_CONTRACT_SYNC_MONGODB_URI: "mongodb://example",
      LOCAL_CONTRACT_SYNC_CLOUDINARY_URL: "cloudinary://key:secret@cloud",
      LOCAL_CONTRACT_SYNC_INTERVAL_MINUTES: "15",
      LOCAL_CONTRACT_SYNC_STATE_PATH: "./state/custom.json"
    },
    resolveExecutable: () => "/opt/homebrew/bin/gws"
  });

  assert.equal(config.intervalMinutes, 15);
  assert.equal(config.statePath, "/tmp/contract_drive_sync/state/custom.json");
  assert.equal(config.gwsPath, "/opt/homebrew/bin/gws");
});

test("buildLaunchAgentPlist uses configured interval minutes", () => {
  const xml = buildLaunchAgentPlist({
    nodePath: "/opt/homebrew/bin/node",
    repoRoot: "/repo",
    scriptPath: "/repo/local_programs/contract_drive_sync/sync-contracts.mjs",
    stateDir: "/repo/local_programs/contract_drive_sync/.state",
    intervalMinutes: 15
  });

  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
});
