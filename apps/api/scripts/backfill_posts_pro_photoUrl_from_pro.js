// apps/api/scripts/backfill_posts_pro_photoUrl_from_pro.js
import "dotenv/config";
import mongoose from "mongoose";
import { Pro } from "../models.js";
import Post from "../models/Post.js";

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("Missing MONGO_URI (or MONGODB_URI) in env.");
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected");

  // Only posts that still have Cloudinary in snapshot
  const posts = await Post.find({
    "pro.photoUrl": { $regex: "cloudinary", $options: "i" },
    deleted: { $ne: true },
  })
    .select({ _id: 1, proOwnerUid: 1, proId: 1, pro: 1 })
    .lean();

  console.log(`Posts with Cloudinary snapshot avatar: ${posts.length}`);

  let updated = 0;
  let missingPro = 0;
  let proHasNoPhoto = 0;

  for (const p of posts) {
    const proDoc =
      (p.proId
        ? await Pro.findById(p.proId).select({ photoUrl: 1 }).lean()
        : null) ||
      (p.proOwnerUid
        ? await Pro.findOne({ ownerUid: p.proOwnerUid })
            .select({ photoUrl: 1 })
            .lean()
        : null);

    if (!proDoc) {
      missingPro++;
      continue;
    }

    const newUrl = String(proDoc.photoUrl || "").trim();
    if (!newUrl) {
      proHasNoPhoto++;
      continue;
    }

    const res = await Post.updateOne(
      { _id: p._id },
      { $set: { "pro.photoUrl": newUrl } },
    );

    if (res.modifiedCount > 0) updated++;
  }

  console.log({ updated, missingPro, proHasNoPhoto });
  await mongoose.disconnect();
  console.log("✅ Done");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
