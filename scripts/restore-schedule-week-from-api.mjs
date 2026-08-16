import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";

function readEnvFile(path = ".env") {
  return Object.fromEntries(
    fs
      .readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
      })
  );
}

function buildPersonKey(role, employeeId) {
  const normalizedId = String(employeeId ?? "").trim().toLowerCase();
  return normalizedId ? `${role}:${normalizedId}` : "";
}

function parseArgs(argv) {
  const options = {
    from: "",
    to: "",
    dryRun: false
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg.startsWith("--from=")) {
      options.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      options.to = arg.slice("--to=".length).trim();
    }
  }

  if (!options.from || !options.to) {
    throw new Error("Missing --from=YYYY-MM-DD or --to=YYYY-MM-DD.");
  }

  return options;
}

function normalizeScheduleRow(row) {
  return {
    rowNumber: Number(row.rowNumber) || 0,
    stt: String(row.stt ?? "").trim(),
    sessionId: String(row.sessionId ?? "").trim(),
    dateKey: String(row.dateKey ?? "").trim(),
    dateLabel: String(row.dateLabel ?? "").trim(),
    weekday: String(row.weekday ?? "").trim(),
    slot: String(row.slot ?? "").trim(),
    slotSortKey: String(row.slotSortKey ?? "").trim(),
    hostId: String(row.hostId ?? "").trim(),
    hostName: String(row.hostName ?? "").trim(),
    format: String(row.format ?? "").trim(),
    supportId: String(row.supportId ?? "").trim(),
    supportName: String(row.supportName ?? "").trim(),
    channel: String(row.channel ?? "").trim(),
    scriptUrl: String(row.scriptUrl ?? "").trim(),
    hostConfirm: String(row.hostConfirm ?? "").trim(),
    supportConfirm: String(row.supportConfirm ?? "").trim(),
    backupHostId: String(row.backupHostId ?? "").trim(),
    backupHostName: String(row.backupHostName ?? "").trim(),
    backupSupportId: String(row.backupSupportId ?? "").trim(),
    backupSupportName: String(row.backupSupportName ?? "").trim(),
    supportCandidatePool: String(row.supportCandidatePool ?? "").trim(),
    status:
      row.status === "published" || row.status === "open" || row.status === "canceled" || row.status === "completed"
        ? row.status
        : undefined,
    generatedBy: "google_sheet",
    generationBatchId: undefined,
    manualOverride: row.manualOverride === true,
    isHostConfirmed: row.isHostConfirmed === true,
    isSupportConfirmed: row.isSupportConfirmed === true,
    canConfirmHost: row.canConfirmHost === true,
    canConfirmSupport: row.canConfirmSupport === true,
    supportRequired: row.supportRequired === true,
    isSupportOnly: row.isSupportOnly === true,
    missingSupport: row.missingSupport === true,
    warningLevel: row.warningLevel === "ok" || row.warningLevel === "danger" ? row.warningLevel : "info",
    warnings: Array.isArray(row.warnings) ? row.warnings.map((item) => String(item).trim()).filter(Boolean) : []
  };
}

async function main() {
  const { from, to, dryRun } = parseArgs(process.argv.slice(2));
  const env = readEnvFile();
  const apiUrl = env.GOOGLE_SCHEDULE_API_URL;
  const apiToken = env.GOOGLE_SCHEDULE_API_TOKEN;
  const mongoUri = env.MONGODB_URI;
  const mongoDbName = env.MONGODB_DB || "hr_streaming";

  if (!apiUrl || !apiToken) throw new Error("Missing GOOGLE_SCHEDULE_API_URL or GOOGLE_SCHEDULE_API_TOKEN.");
  if (!mongoUri) throw new Error("Missing MONGODB_URI.");

  const response = await fetch(`${apiUrl}?token=${apiToken}&action=ping`);
  if (!response.ok) {
    throw new Error(`Schedule API request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = sourceRows
    .filter((row) => String(row.dateKey ?? "") >= from && String(row.dateKey ?? "") <= to)
    .map(normalizeScheduleRow)
    .filter((row) => row.sessionId && row.dateKey);

  const counts = rows.reduce((accumulator, row) => {
    accumulator[row.dateKey] = (accumulator[row.dateKey] || 0) + 1;
    return accumulator;
  }, {});

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          generatedAt: payload.generatedAt ?? null,
          from,
          to,
          total: rows.length,
          counts,
          sample: rows.slice(0, 10)
        },
        null,
        2
      )
    );
    return;
  }

  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const database = client.db(mongoDbName);
    const sessions = database.collection("schedule_sessions");
    const syncRuns = database.collection("schedule_sync_runs");
    const syncBatchId = `restore-${from}-${to}-${randomUUID()}`;
    const syncedAt = new Date();

    const beforeCount = await sessions.countDocuments({
      dateKey: { $gte: from, $lte: to },
      active: true
    });

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const updateResult = await sessions.updateOne(
        { sessionKey: row.sessionId },
        {
          $set: {
            ...row,
            sessionKey: row.sessionId,
            hostPersonKey: buildPersonKey("host", row.hostId),
            supportPersonKey: buildPersonKey("support", row.supportId),
            backupHostPersonKey: buildPersonKey("host", row.backupHostId),
            backupSupportPersonKey: buildPersonKey("support", row.backupSupportId),
            active: true,
            sourceGeneratedAt: payload.generatedAt ? new Date(payload.generatedAt) : null,
            sourceSnapshotRevision: Number(payload.confirmationRevision) || 0,
            syncBatchId,
            lastSeenAt: syncedAt,
            updatedAt: syncedAt,
            deactivatedAt: null
          },
          $setOnInsert: {
            firstSyncedAt: syncedAt
          }
        },
        { upsert: true }
      );

      if (updateResult.upsertedCount > 0) {
        inserted += 1;
      } else if (updateResult.matchedCount > 0) {
        updated += 1;
      }
    }

    const afterCount = await sessions.countDocuments({
      dateKey: { $gte: from, $lte: to },
      active: true
    });

    await syncRuns.insertOne({
      batchId: syncBatchId,
      syncType: "schedule",
      mode: "sheet_snapshot",
      status: "success",
      requestedBy: "admin:restore-script",
      sourceGeneratedAt: payload.generatedAt ? new Date(payload.generatedAt) : null,
      timezone: payload.timezone || "Asia/Bangkok",
      startedAt: syncedAt,
      completedAt: syncedAt,
      total: rows.length,
      inserted,
      updated,
      deactivated: 0,
      restoreRange: { from, to },
      restoreSource: "apps_script_api"
    });

    console.log(
      JSON.stringify(
        {
          restored: true,
          generatedAt: payload.generatedAt ?? null,
          from,
          to,
          total: rows.length,
          beforeCount,
          afterCount,
          inserted,
          updated,
          counts,
          batchId: syncBatchId
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
