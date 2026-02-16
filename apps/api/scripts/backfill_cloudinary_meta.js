// apps/api/scripts/backfill_cloudinary_meta.js
import "dotenv/config";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import Post from "../models/Post.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Parse Cloudinary public_id from a URL like:
// https://res.cloudinary.com/<cloud>/image/upload/v1234/folder/name.jpg
function parsePublicId(url) {
  const s = String(url || "");
  const m = s.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
  if (!m) return null;
  return m[1]; // includes folders
}

function inferResourceType(url, fallbackType) {
  const u = String(url || "").toLowerCase();
  if (u.includes("/video/upload/") || u.includes("/video/")) return "video";
  if (fallbackType === "video") return "video";
  return "image";
}

async function main() {
  // --- Mongo ---
  const mongoUri = mustEnv("MONGODB_URI");
  await mongoose.connect(mongoUri);

  // --- Cloudinary Admin API ---
  cloudinary.config({
    cloud_name: mustEnv("CLOUDINARY_CLOUD_NAME"),
    api_key: mustEnv("CLOUDINARY_API_KEY"),
    api_secret: mustEnv("CLOUDINARY_API_SECRET"),
  });

  // Find posts with missing meta
  const posts = await Post.find({
    media: { $exists: true, $ne: [] },
    $or: [
      { "media.width": 0 },
      { "media.height": 0 },
      { "media.durationSec": 0 }, // harmless for images
    ],
  })
    .limit(500) // run in batches
    .lean();

  console.log(`Found ${posts.length} posts to inspect (limit 500).`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of posts) {
    const m0 = Array.isArray(p.media) ? p.media[0] : null;
    if (!m0?.url) {
      skipped++;
      continue;
    }

    const publicId = parsePublicId(m0.url);
    if (!publicId) {
      console.log("SKIP: cannot parse public_id", p._id, m0.url);
      skipped++;
      continue;
    }

    const resourceType = inferResourceType(m0.url, m0.type);

    try {
      const info = await cloudinary.api.resource(publicId, {
        resource_type: resourceType,
      });

      const width = Number(info.width || 0);
      const height = Number(info.height || 0);
      const durationSec = Number(info.duration || 0);

      const patch = {};
      if (width > 0) patch["media.0.width"] = width;
      if (height > 0) patch["media.0.height"] = height;
      if (resourceType === "video" && durationSec > 0) {
        patch["media.0.durationSec"] = durationSec;
      }

      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }

      await Post.updateOne({ _id: p._id }, { $set: patch });
      updated++;
      console.log("OK:", p._id, patch);
    } catch (e) {
      failed++;
      console.log("FAIL:", p._id, publicId, resourceType, e?.message || e);
    }
  }

  console.log({ updated, skipped, failed });
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
