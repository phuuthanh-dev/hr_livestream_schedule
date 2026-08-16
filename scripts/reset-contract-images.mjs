import fs from "node:fs";
import { MongoClient } from "mongodb";
import { v2 as cloudinary } from "cloudinary";

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

async function main() {
  const employeeId = process.argv[2];
  if (!employeeId) {
    throw new Error("Usage: node scripts/reset-contract-images.mjs <EMPLOYEE_ID>");
  }

  const env = readEnvFile();
  if (!env.MONGODB_URI) throw new Error("Missing MONGODB_URI.");

  if (env.CLOUDINARY_URL) {
    cloudinary.config(env.CLOUDINARY_URL);
  }

  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();

  try {
    const db = client.db(env.MONGODB_DB || "hr_streaming");
    const collection = db.collection("employee_contract_profiles");
    const document = await collection.findOne({ employeeId });
    if (!document) throw new Error(`Contract profile ${employeeId} not found.`);

    const publicIds = [document.citizenIdFront?.publicId, document.citizenIdBack?.publicId].filter(Boolean);
    for (const publicId of publicIds) {
      try {
        if (env.CLOUDINARY_URL) {
          await cloudinary.uploader.destroy(publicId, {
            resource_type: "image",
            type: "authenticated",
            invalidate: true
          });
        }
      } catch (error) {
        console.error(`Could not delete Cloudinary asset ${publicId}:`, error instanceof Error ? error.message : error);
      }
    }

    const now = new Date();
    const result = await collection.findOneAndUpdate(
      { employeeId },
      {
        $unset: {
          citizenIdFront: "",
          citizenIdBack: "",
          submittedAt: "",
          driveSync: ""
        },
        $set: {
          completed: false,
          updatedAt: now,
          updatedBy: "admin:reset-contract-images"
        }
      },
      { returnDocument: "after" }
    );

    console.log(JSON.stringify({
      employeeId,
      removedPublicIds: publicIds,
      completed: result?.completed,
      hasFront: Boolean(result?.citizenIdFront),
      hasBack: Boolean(result?.citizenIdBack),
      updatedAt: result?.updatedAt
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
