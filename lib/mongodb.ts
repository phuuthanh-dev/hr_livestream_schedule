import { MongoClient, type Db } from "mongodb";

declare global {
  var __hrStreamingMongoClientPromise: Promise<MongoClient> | undefined;
}

function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI.");
  }
  return uri;
}

function getMongoClientPromise() {
  if (!globalThis.__hrStreamingMongoClientPromise) {
    const client = new MongoClient(getMongoUri(), {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000
    });
    const connectionPromise = client.connect().catch((error) => {
      if (globalThis.__hrStreamingMongoClientPromise === connectionPromise) {
        globalThis.__hrStreamingMongoClientPromise = undefined;
      }
      throw error;
    });
    globalThis.__hrStreamingMongoClientPromise = connectionPromise;
  }
  return globalThis.__hrStreamingMongoClientPromise;
}

export async function getMongoDatabase(): Promise<Db> {
  const client = await getMongoClientPromise();
  return client.db(process.env.MONGODB_DB || "hr_streaming");
}
