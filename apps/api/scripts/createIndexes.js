#!/usr/bin/env node
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

async function safeCreateIndex(db, collName, spec, opts = {}) {
  try {
    console.log(
      `[indexes] creating ${collName} -> ${JSON.stringify(spec)} ...`,
    );
    await db.collection(collName).createIndex(spec, opts);
    console.log(`[indexes] created ${collName} -> ${JSON.stringify(spec)}`);
  } catch (e) {
    // Mongo error code 86 = IndexKeySpecsConflict (existing index same name but different spec)
    const isIndexConflict =
      e && (e.code === 86 || (e.errorResponse && e.errorResponse.code === 86));
    if (isIndexConflict) {
      console.warn(
        `[indexes] skipped (conflict) ${collName} -> ${JSON.stringify(spec)} — existing index differs (IndexKeySpecsConflict)`,
      );
    } else {
      console.error(
        `[indexes] failed ${collName} -> ${JSON.stringify(spec)}:`,
        e,
      );
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

    // Posts / feed
    await safeCreateIndex(db, "posts", {
      isPublic: 1,
      hidden: 1,
      deleted: 1,
      createdAt: -1,
    });
    await safeCreateIndex(db, "posts", { lga: 1, isPublic: 1, createdAt: -1 });

    // Post stats, notifications, follows
    await safeCreateIndex(db, "poststats", { postId: 1 });
    await safeCreateIndex(db, "notifications", {
      toUid: 1,
      read: 1,
      createdAt: -1,
    });
    await safeCreateIndex(db, "follows", {
      toUid: 1,
      fromUid: 1,
      createdAt: -1,
    });

    // Bookings
    await safeCreateIndex(db, "bookings", {
      proOwnerUid: 1,
      status: 1,
      createdAt: -1,
    });
    await safeCreateIndex(db, "bookings", { proId: 1, scheduledFor: -1 }); // matches BookingSchema.index
    await safeCreateIndex(db, "bookings", { clientUid: 1, createdAt: -1 });

    // Wallets (if you have wallets collection)
    await safeCreateIndex(
      db,
      "wallets",
      { ownerUid: 1 },
      { unique: true, sparse: true },
    );

    // Pro (pros) collection: helpful indexes including geospatial
    // Note: collection name depends on your models — I assume "pros" (lowercase plural).
    // If your collection name is "pro" or something else, change below accordingly.
    await safeCreateIndex(db, "pros", { profileVisible: 1, lga: 1 });
    await safeCreateIndex(db, "pros", { profileVisible: 1, state: 1 });
    await safeCreateIndex(db, "pros", { profileVisible: 1, state: 1, lga: 1 });
    await safeCreateIndex(db, "pros", { "services.name": 1 });
    await safeCreateIndex(db, "pros", { "services.id": 1 });

    // Geospatial: ensure 2dsphere index on `loc` for geo queries ($geoNear / $near)
    // If your Pro documents put coordinates in `loc.coordinates: [lon, lat]`, this is correct.
    await safeCreateIndex(db, "pros", { loc: "2dsphere" });

    // Optional: ensure ownerUid unique index for quick lookups (matches models: ownerUid unique)
    await safeCreateIndex(
      db,
      "pros",
      { ownerUid: 1 },
      { unique: true, sparse: true },
    );

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
