import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { MongoClient } from "mongodb";
import { v2 as cloudinary } from "cloudinary";

const HOST_TAB_NAME = "Thông tin Mẫu Live";
const SUPPORT_TAB_NAME = "Thông tin Support Live";
const RANGE = "A:AZ";

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeEmployeeId(value) {
  return normalizeText(value).toUpperCase();
}

function personKey(role, employeeId) {
  return `${role}:${normalizeText(employeeId).toLowerCase()}`;
}

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply")
  };
}

function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: readRequiredEnv("GOOGLE_SHEETS_CLIENT_EMAIL"),
    key: readRequiredEnv("GOOGLE_SHEETS_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

async function readSheetValues(tabName) {
  const sheets = getSheetsClient();
  const spreadsheetId = readRequiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!${RANGE}`
  });
  return response.data.values || [];
}

function getEmployeeIdColumnIndex(header) {
  const aliases = new Set(["mã nhân viên", "ma nhan vien"]);
  for (let index = 0; index < header.length; index += 1) {
    if (aliases.has(normalizeHeader(header[index]))) return index;
  }
  return -1;
}

async function loadSheetKeys() {
  const [hostValues, supportValues] = await Promise.all([
    readSheetValues(HOST_TAB_NAME),
    readSheetValues(SUPPORT_TAB_NAME)
  ]);
  const keys = new Set();

  const hostHeader = hostValues[0] || [];
  const hostIdIndex = getEmployeeIdColumnIndex(hostHeader);
  for (const row of hostValues.slice(1)) {
    const employeeId = normalizeEmployeeId(row[hostIdIndex]);
    if (employeeId) keys.add(personKey("host", employeeId));
  }

  const supportHeader = supportValues[0] || [];
  const supportIdIndex = getEmployeeIdColumnIndex(supportHeader);
  for (const row of supportValues.slice(1)) {
    const employeeId = normalizeEmployeeId(row[supportIdIndex]);
    if (employeeId) keys.add(personKey("support", employeeId));
  }

  return {
    keys,
    counts: {
      host: hostValues.length > 1 ? hostValues.slice(1).filter((row) => normalizeEmployeeId(row[hostIdIndex])).length : 0,
      support: supportValues.length > 1 ? supportValues.slice(1).filter((row) => normalizeEmployeeId(row[supportIdIndex])).length : 0
    }
  };
}

function getCloudinaryReady() {
  try {
    return Boolean(cloudinary.config().cloud_name || process.env.CLOUDINARY_URL);
  } catch {
    return false;
  }
}

async function backupFilePath() {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0")
  ].join("");
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `stale-sheet-prune-backup-${stamp}.json`);
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const { keys: sheetKeys, counts: sheetCounts } = await loadSheetKeys();

  const mongo = new MongoClient(readRequiredEnv("MONGODB_URI"), {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000
  });
  await mongo.connect();
  const db = mongo.db(process.env.MONGODB_DB || "hr_streaming");

  const collections = {
    roster: db.collection("schedule_people"),
    recruitment: db.collection("recruitment_profiles"),
    contracts: db.collection("employee_contract_profiles"),
    applications: db.collection("people_applications"),
    supportTraining: db.collection("support_training_profiles"),
    users: db.collection("schedule_users"),
    availabilityWeeks: db.collection("schedule_availability_weeks"),
    availabilitySlots: db.collection("schedule_availability_slots")
  };

  const [rosterDocs, recruitmentDocs, contractDocs, supportTrainingDocs, applicationDocs] = await Promise.all([
    collections.roster.find({}, { projection: { personKey: 1, role: 1, employeeId: 1, name: 1, updatedAt: 1 } }).toArray(),
    collections.recruitment.find({}, { projection: { personKey: 1, role: 1, employeeId: 1, fullName: 1, updatedAt: 1 } }).toArray(),
    collections.contracts.find({}, { projection: { personKey: 1, role: 1, employeeId: 1, employeeName: 1, contractCode: 1, citizenIdFront: 1, citizenIdBack: 1, updatedAt: 1 } }).toArray(),
    collections.supportTraining.find({}, { projection: { personKey: 1, employeeId: 1, employeeName: 1, updatedAt: 1 } }).toArray(),
    collections.applications.find({}, { projection: { role: 1, employeeId: 1, fullName: 1, phone: 1, updatedAt: 1, status: 1 } }).toArray()
  ]);

  const keySources = new Map();
  function addKey(source, key, detail) {
    if (!key) return;
    const current = keySources.get(key) || [];
    current.push({ source, ...detail });
    keySources.set(key, current);
  }

  for (const doc of rosterDocs) addKey("schedule_people", doc.personKey || personKey(doc.role, doc.employeeId), { employeeId: doc.employeeId, role: doc.role, name: doc.name, updatedAt: doc.updatedAt });
  for (const doc of recruitmentDocs) addKey("recruitment_profiles", doc.personKey || personKey(doc.role, doc.employeeId), { employeeId: doc.employeeId, role: doc.role, name: doc.fullName, updatedAt: doc.updatedAt });
  for (const doc of contractDocs) addKey("employee_contract_profiles", doc.personKey || personKey(doc.role, doc.employeeId), { employeeId: doc.employeeId, role: doc.role, name: doc.employeeName, updatedAt: doc.updatedAt });
  for (const doc of supportTrainingDocs) addKey("support_training_profiles", doc.personKey || personKey("support", doc.employeeId), { employeeId: doc.employeeId, role: "support", name: doc.employeeName, updatedAt: doc.updatedAt });
  for (const doc of applicationDocs) {
    if (!doc.employeeId || (doc.role !== "host" && doc.role !== "support")) continue;
    addKey("people_applications", personKey(doc.role, doc.employeeId), { employeeId: doc.employeeId, role: doc.role, name: doc.fullName, updatedAt: doc.updatedAt, status: doc.status });
  }

  const staleKeys = [...keySources.keys()].filter((key) => !sheetKeys.has(key)).sort();
  const staleSet = new Set(staleKeys);

  const backup = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "audit",
    sheetCounts,
    staleKeys,
    keys: Object.fromEntries(staleKeys.map((key) => [key, keySources.get(key) || []])),
    documents: {
      schedule_people: await collections.roster.find({ personKey: { $in: staleKeys } }).toArray(),
      recruitment_profiles: await collections.recruitment.find({ personKey: { $in: staleKeys } }).toArray(),
      employee_contract_profiles: await collections.contracts.find({ personKey: { $in: staleKeys } }).toArray(),
      support_training_profiles: await collections.supportTraining.find({ personKey: { $in: staleKeys } }).toArray(),
      schedule_availability_weeks: await collections.availabilityWeeks.find({ personKey: { $in: staleKeys } }).toArray(),
      schedule_availability_slots: await collections.availabilitySlots.find({ personKey: { $in: staleKeys } }).toArray(),
      schedule_users: await collections.users.find({ accountKey: { $regex: "^employee:(host|support):" } }).toArray(),
      people_applications: staleKeys.length > 0
        ? await collections.applications.find({
          $or: staleKeys.map((key) => {
            const [role, normalizedEmployeeId] = key.split(":");
            return { role, employeeId: { $regex: `^${normalizedEmployeeId}$`, $options: "i" } };
          })
        }).toArray()
        : []
    }
  };
  backup.documents.schedule_users = backup.documents.schedule_users.filter((doc) => {
    const match = /^employee:(host|support):(.+)$/.exec(normalizeText(doc.accountKey));
    if (!match) return false;
    return staleSet.has(`${match[1]}:${normalizeText(match[2]).toLowerCase()}`);
  });

  const backupPath = await backupFilePath();
  await fs.writeFile(backupPath, JSON.stringify(backup, null, 2), "utf8");

  const summary = {
    sheetHostRows: sheetCounts.host,
    sheetSupportRows: sheetCounts.support,
    staleKeys: staleKeys.length,
    roster: backup.documents.schedule_people.length,
    recruitment: backup.documents.recruitment_profiles.length,
    contracts: backup.documents.employee_contract_profiles.length,
    applications: backup.documents.people_applications.length,
    supportTraining: backup.documents.support_training_profiles.length,
    availabilityWeeks: backup.documents.schedule_availability_weeks.length,
    availabilitySlots: backup.documents.schedule_availability_slots.length,
    users: backup.documents.schedule_users.length,
    backupPath
  };

  console.log(JSON.stringify({ mode: apply ? "apply" : "audit", summary, preview: staleKeys.slice(0, 20) }, null, 2));

  if (!apply || staleKeys.length === 0) {
    await mongo.close();
    return;
  }

  const cloudinaryEnabled = getCloudinaryReady();
  let deletedCloudinaryAssets = 0;
  const cloudinaryErrors = [];
  if (cloudinaryEnabled) {
    for (const contract of backup.documents.employee_contract_profiles) {
      for (const side of ["citizenIdFront", "citizenIdBack"]) {
        const publicId = contract?.[side]?.publicId;
        if (!publicId) continue;
        try {
          await cloudinary.uploader.destroy(publicId, {
            resource_type: "image",
            type: "authenticated",
            invalidate: true
          });
          deletedCloudinaryAssets += 1;
        } catch (error) {
          cloudinaryErrors.push({ publicId, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }

  const userAccountKeys = backup.documents.schedule_users.map((doc) => doc.accountKey).filter(Boolean);
  const applicationDeleteFilter = {
    $or: staleKeys.map((key) => {
      const [role, normalizedEmployeeId] = key.split(":");
      return { role, employeeId: { $regex: `^${normalizedEmployeeId}$`, $options: "i" } };
    })
  };

  const [rosterDelete, recruitmentDelete, contractDelete, supportTrainingDelete, weekDelete, slotDelete, userDelete, applicationDelete] = await Promise.all([
    collections.roster.deleteMany({ personKey: { $in: staleKeys } }),
    collections.recruitment.deleteMany({ personKey: { $in: staleKeys } }),
    collections.contracts.deleteMany({ personKey: { $in: staleKeys } }),
    collections.supportTraining.deleteMany({ personKey: { $in: staleKeys } }),
    collections.availabilityWeeks.deleteMany({ personKey: { $in: staleKeys } }),
    collections.availabilitySlots.deleteMany({ personKey: { $in: staleKeys } }),
    userAccountKeys.length ? collections.users.deleteMany({ accountKey: { $in: userAccountKeys } }) : { deletedCount: 0 },
    staleKeys.length ? collections.applications.deleteMany(applicationDeleteFilter) : { deletedCount: 0 }
  ]);

  await mongo.close();
  console.log(JSON.stringify({
    mode: "apply",
    deleted: {
      schedule_people: rosterDelete.deletedCount || 0,
      recruitment_profiles: recruitmentDelete.deletedCount || 0,
      employee_contract_profiles: contractDelete.deletedCount || 0,
      support_training_profiles: supportTrainingDelete.deletedCount || 0,
      schedule_availability_weeks: weekDelete.deletedCount || 0,
      schedule_availability_slots: slotDelete.deletedCount || 0,
      schedule_users: userDelete.deletedCount || 0,
      people_applications: applicationDelete.deletedCount || 0,
      cloudinaryAssets: deletedCloudinaryAssets
    },
    cloudinaryErrors,
    backupPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
