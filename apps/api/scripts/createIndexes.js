#!/usr/bin/env node
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

async function safeCreateIndex(db, collName, spec, opts = {}) {
  try {
    console.log(`[indexes] creating ${collName} -> ${JSON.stringify(spec)} ...`);
    await db.collection(collName).createIndex(spec, opts);
    console.log(`[indexes] created ${collName} -> ${JSON.stringify(spec)}`);
  } catch (e) {
    // Mongo error code 86 = IndexKeySpecsConflict (existing index same name but different spec)
    const isIndexConflict = e && (e.code === 86 || (e.errorResponse && e.errorResponse.code === 86));
    if (isIndexConflict) {
      console.warn(`[indexes] skipped (conflict) ${collName} -> ${JSON.stringify(spec)} — existing index differs (IndexKeySpecsConflict)`);
    } else {
      console.error(`[indexes] failed ${collName} -> ${JSON.stringify(spec)}:`, e);
      // rethrow so other serious errors stop execution
      throw e;
    }
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set in env");
    process.exit(1);
  }

  console.log("[indexes] connecting to mongo...");
  await mongoose.connect(uri, {});

  const db = mongoose.connection.db;
  try {
    console.log("Creating indexes...");

    await safeCreateIndex(db, "posts", { isPublic: 1, hidden: 1, deleted: 1, createdAt: -1 });
    await safeCreateIndex(db, "posts", { lga: 1, isPublic: 1, createdAt: -1 });
    await safeCreateIndex(db, "poststats", { postId: 1 });
    await safeCreateIndex(db, "notifications", { toUid: 1, read: 1, createdAt: -1 });
    await safeCreateIndex(db, "follows", { toUid: 1, fromUid: 1, createdAt: -1 });
    await safeCreateIndex(db, "bookings", { proOwnerUid: 1, status: 1, createdAt: -1 });

    console.log("Indexes created (or skipped conflicts).");
  } catch (e) {
    console.error("index creation failed", e);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
