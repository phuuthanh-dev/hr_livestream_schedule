import fs from "node:fs";
import { MongoClient } from "mongodb";
import { v2 as cloudinary } from "cloudinary";

function readEnvFile(path = ".env") {
  if (!fs.existsSync(path)) return {};
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

function readEnv(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function readRequiredEnv(name, env) {
  const value = readEnv(name, env[name] || "");
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function configureCloudinary(env) {
  const cloudinaryUrl = readEnv("CLOUDINARY_URL", env.CLOUDINARY_URL || "");
  if (cloudinaryUrl) {
    cloudinary.config(cloudinaryUrl);
    return;
  }

  const cloudName = readEnv("CLOUDINARY_CLOUD_NAME", env.CLOUDINARY_CLOUD_NAME || "");
  const apiKey = readEnv("CLOUDINARY_API_KEY", env.CLOUDINARY_API_KEY || "");
  const apiSecret = readEnv("CLOUDINARY_API_SECRET", env.CLOUDINARY_API_SECRET || "");
  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    return;
  }

  throw new Error("Missing Cloudinary configuration. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET.");
}

function safePathSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "employee";
}

function contractAssetFolder(role, employeeId) {
  return `root-rotation-livestream/contracts/${role}/${safePathSegment(employeeId)}`;
}

function avatarAssetFolder(role, employeeId) {
  return `root-rotation-livestream/avatars/${role}/${safePathSegment(employeeId)}`;
}

function parseArgs(argv) {
  const result = {
    apply: argv.includes("--apply"),
    employeeId: "",
    role: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--employee-id") {
      result.employeeId = String(argv[index + 1] || "").trim().toUpperCase();
      index += 1;
    } else if (value === "--role") {
      result.role = String(argv[index + 1] || "").trim().toLowerCase();
      index += 1;
    }
  }

  return result;
}

function buildRenamedPublicId(targetFolder, currentPublicId, fallbackPrefix) {
  const basename = String(currentPublicId || "").split("/").pop()?.trim() || `${fallbackPrefix}-${Date.now()}`;
  return `${targetFolder}/${basename}`;
}

async function renameAsset({ currentPublicId, targetPublicId, deliveryType }) {
  if (currentPublicId === targetPublicId) {
    return { publicId: currentPublicId, version: undefined, status: "already_migrated" };
  }

  const response = await cloudinary.uploader.rename(currentPublicId, targetPublicId, {
    resource_type: "image",
    type: deliveryType,
    to_type: deliveryType,
    overwrite: true,
    invalidate: true
  });

  return {
    publicId: response.public_id,
    version: Number(response.version || 0),
    status: "renamed"
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileEnv = readEnvFile();

  const mongoUri = readRequiredEnv("MONGODB_URI", fileEnv);
  const mongoDb = readEnv("MONGODB_DB", fileEnv.MONGODB_DB || "hr_streaming");
  configureCloudinary(fileEnv);

  const client = new MongoClient(mongoUri, { maxPoolSize: 4, serverSelectionTimeoutMS: 8000 });
  await client.connect();

  try {
    const db = client.db(mongoDb);
    const rosterCollection = db.collection("schedule_people");
    const contractCollection = db.collection("employee_contract_profiles");

    const rosterFilter = {};
    const contractFilter = {};
    if (args.employeeId) {
      rosterFilter.employeeId = args.employeeId;
      contractFilter.employeeId = args.employeeId;
    }
    if (args.role === "host" || args.role === "support") {
      rosterFilter.role = args.role;
      contractFilter.role = args.role;
    }

    const [rosterDocs, contractDocs] = await Promise.all([
      rosterCollection.find(rosterFilter, { projection: { employeeId: 1, role: 1, avatar: 1 } }).toArray(),
      contractCollection.find(contractFilter, { projection: { employeeId: 1, role: 1, citizenIdFront: 1, citizenIdBack: 1 } }).toArray()
    ]);

    const actions = [];

    for (const person of rosterDocs) {
      const avatar = person.avatar;
      if (!avatar?.publicId) continue;
      const targetPublicId = buildRenamedPublicId(
        avatarAssetFolder(person.role, person.employeeId),
        avatar.publicId,
        "avatar"
      );
      if (avatar.publicId === targetPublicId) continue;
      actions.push({
        collection: "schedule_people",
        employeeId: person.employeeId,
        role: person.role,
        field: "avatar",
        currentPublicId: avatar.publicId,
        targetPublicId,
        deliveryType: "upload",
        currentVersion: Number(avatar.version || 0)
      });
    }

    for (const contract of contractDocs) {
      for (const side of ["front", "back"]) {
        const file = side === "front" ? contract.citizenIdFront : contract.citizenIdBack;
        if (!file?.publicId) continue;
        const targetPublicId = buildRenamedPublicId(
          contractAssetFolder(contract.role, contract.employeeId),
          file.publicId,
          side
        );
        if (file.publicId === targetPublicId) continue;
        actions.push({
          collection: "employee_contract_profiles",
          employeeId: contract.employeeId,
          role: contract.role,
          field: side === "front" ? "citizenIdFront" : "citizenIdBack",
          currentPublicId: file.publicId,
          targetPublicId,
          deliveryType: "authenticated",
          currentVersion: Number(file.version || 0)
        });
      }
    }

    if (!args.apply) {
      console.log(JSON.stringify({
        mode: "dry-run",
        totalActions: actions.length,
        actions
      }, null, 2));
      return;
    }

    const results = [];
    for (const action of actions) {
      try {
        const renamed = await renameAsset(action);
        const update = {
          $set: {
            [`${action.field}.publicId`]: renamed.publicId,
            updatedAt: new Date(),
            updatedBy: "admin:migrate-cloudinary-project-folders"
          }
        };
        if (renamed.version) {
          update.$set[`${action.field}.version`] = renamed.version;
        }

        if (action.collection === "schedule_people") {
          await rosterCollection.updateOne(
            { employeeId: action.employeeId, role: action.role, [`${action.field}.publicId`]: action.currentPublicId },
            update
          );
        } else {
          await contractCollection.updateOne(
            { employeeId: action.employeeId, role: action.role, [`${action.field}.publicId`]: action.currentPublicId },
            update
          );
        }

        results.push({
          ...action,
          status: renamed.status,
          appliedPublicId: renamed.publicId,
          version: renamed.version || action.currentVersion || 0
        });
      } catch (error) {
        results.push({
          ...action,
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log(JSON.stringify({
      mode: "apply",
      totalActions: actions.length,
      successCount: results.filter((item) => item.status !== "error").length,
      errorCount: results.filter((item) => item.status === "error").length,
      results
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
