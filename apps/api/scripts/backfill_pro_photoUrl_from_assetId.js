// apps/api/scripts/backfill_pro_photoUrl_from_assetId.js
import "dotenv/config";
import mongoose from "mongoose";
import { Pro } from "../models.js";
import MediaAsset from "../models/MediaAsset.js";
import { keyToPublicUrl } from "../r2.js";

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("Missing MONGO_URI (or MONGODB_URI) in env.");
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected");

  // Only fix pros that:
  // - have a photoAssetId
  // - have empty photoUrl (you wiped it)
  const pros = await Pro.find({
    photoAssetId: { $exists: true, $ne: "" },
    $or: [{ photoUrl: { $exists: false } }, { photoUrl: "" }],
  })
    .select({ _id: 1, ownerUid: 1, photoAssetId: 1, photoUrl: 1 })
    .lean();

  console.log(`Pros needing backfill: ${pros.length}`);

  let updated = 0;
  let skippedPrivate = 0;
  let missingAsset = 0;

  for (const p of pros) {
    const a = await MediaAsset.findById(p.photoAssetId).lean();
    if (!a) {
      missingAsset++;
      continue;
    }

    // If avatar asset is private, we must NOT expose a public URL.
    const vis = a.visibility || "public";
    if (vis !== "public") {
      skippedPrivate++;
      continue;
    }

    const key = a?.original?.key || "";
    const url = keyToPublicUrl(key);
    if (!url) continue;

    const res = await Pro.updateOne(
      { _id: p._id },
      { $set: { photoUrl: url } },
    );

    if (res.modifiedCount > 0) updated++;
  }

  console.log({ updated, skippedPrivate, missingAsset });
  await mongoose.disconnect();
  console.log("✅ Done");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
