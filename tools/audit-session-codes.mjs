import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MongoClient } from "mongodb";

function loadDotEnv(cwd) {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return;
  const source = fs.readFileSync(envPath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function parseSlot(slot) {
  const match = normalizeText(slot).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { start: "0000", end: "0000" };
  }
  const [, startHour, startMinute, endHour, endMinute] = match;
  return {
    start: `${startHour.padStart(2, "0")}${startMinute}`,
    end: `${endHour.padStart(2, "0")}${endMinute}`
  };
}

function formatDatePart(dateKey) {
  const match = normalizeText(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return normalizeText(dateKey).replace(/\D/g, "") || "00000000";
  const [, year, month, day] = match;
  return `${day}${month}${year}`;
}

function getLane(format) {
  return normalizeText(format).toLowerCase().includes("home") ? "home" : "studio";
}

function buildSessionCode(document) {
  const { start, end } = parseSlot(document.slot);
  const hostToken = normalizeText(document.hostId) || "NOHOST";
  const supportToken = getLane(document.format) === "home"
    ? "NO_SUPPORT"
    : (normalizeText(document.supportId) || "NO_SUPPORT");
  return `SS-${formatDatePart(document.dateKey)}-${start}${end}-${hostToken}-${supportToken}`;
}

async function main() {
  const cwd = process.cwd();
  loadDotEnv(cwd);
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI.");
  }
  const databaseName = process.env.MONGODB_DB || "hr_streaming";
  const write = process.argv.includes("--write");

  const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const collection = client.db(databaseName).collection("schedule_sessions");
    const documents = await collection.find({}, {
      projection: {
        _id: 1,
        sessionKey: 1,
        sessionId: 1,
        sessionCode: 1,
        dateKey: 1,
        slot: 1,
        format: 1,
        hostId: 1,
        supportId: 1,
        active: 1
      }
    }).toArray();

    const mismatches = [];
    for (const document of documents) {
      const expected = buildSessionCode(document);
      const current = normalizeText(document.sessionCode);
      if (current !== expected) {
        mismatches.push({
          id: document._id,
          sessionKey: normalizeText(document.sessionKey || document.sessionId),
          active: document.active === true,
          dateKey: normalizeText(document.dateKey),
          slot: normalizeText(document.slot),
          format: normalizeText(document.format),
          hostId: normalizeText(document.hostId),
          supportId: normalizeText(document.supportId),
          current,
          expected
        });
      }
    }

    console.log(`Total sessions: ${documents.length}`);
    console.log(`Mismatched sessionCode: ${mismatches.length}`);
    if (mismatches.length > 0) {
      console.log("Sample mismatches:");
      mismatches.slice(0, 20).forEach((item, index) => {
        console.log(`${index + 1}. [${item.active ? "active" : "inactive"}] ${item.dateKey} ${item.slot} ${item.hostId || "NOHOST"} ${item.supportId || "NO_SUPPORT"} :: current=${item.current || "(blank)"} :: expected=${item.expected}`);
      });
    }

    if (write && mismatches.length > 0) {
      const now = new Date();
      const operations = mismatches.map((item) => ({
        updateOne: {
          filter: { _id: item.id },
          update: {
            $set: {
              sessionCode: item.expected,
              updatedAt: now
            }
          }
        }
      }));
      const result = await collection.bulkWrite(operations, { ordered: false });
      console.log(`Updated ${result.modifiedCount} documents.`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
