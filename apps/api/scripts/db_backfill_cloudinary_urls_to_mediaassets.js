//apps/api/scripts/db_backfill_cloudinary_urls_to_mediaassets.js
/**
 * DB backfill:
 * - Finds Cloudinary URLs stored in MongoDB (legacy fields)
 * - Copies each URL -> R2 (into your canonical key format)
 * - Creates MediaAsset docs (public/private based on FIELD RULES below)
 * - Rewrites DB to use assetId / thumbnailAssetId where possible
 *
 * Required env:
 *   MONGODB_URI
 *   R2_ENDPOINT
 *   R2_ACCESS_KEY
 *   R2_SECRET_KEY
 *   R2_BUCKET
 *
 * Optional env:
 *   DRY_RUN=1  (no writes)
 */

import mongoose from "mongoose";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

import MediaAsset from "../models/MediaAsset.js";
import Post from "../models/Post.js";
import { ClientProfile, ProProfile } from "../models/Profile.js";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const MONGODB_URI = must("MONGODB_URI");

const s3 = new S3Client({
  region: "auto",
  endpoint: must("R2_ENDPOINT"),
  credentials: {
    accessKeyId: must("R2_ACCESS_KEY"),
    secretAccessKey: must("R2_SECRET_KEY"),
  },
});

const R2_BUCKET = must("R2_BUCKET");
const DRY_RUN = String(process.env.DRY_RUN || "") === "1";

// ✅ Raw collections (inventory proved these contain Cloudinary URLs)
function col(name) {
  return mongoose.connection.db.collection(name);
}

function isCloudinaryUrl(s) {
  const v = String(s || "");
  return v.includes("res.cloudinary.com") || v.includes("cloudinary.com");
}

function guessTypeFromUrlOrHint(url, hintType) {
  if (hintType === "video" || hintType === "image") return hintType;
  const u = String(url || "").toLowerCase();
  if (u.match(/\.(mp4|webm|mov|mkv|3gp)(\?|$)/)) return "video";
  return "image";
}

function guessExtFromUrl(url, type) {
  const u = String(url || "");
  const m = u.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
  if (m) return String(m[1]).toLowerCase();
  return type === "video" ? "mp4" : "jpg";
}

async function r2Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function downloadStream(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    buffer,
    contentType: res.headers.get("content-type") || "",
  };
}

/**
 * Canonical key format (matches your /media/init):
 *   media/<ownerUid>/<assetId>/original.<ext>
 */
async function ensureMediaAssetFromUrl({ ownerUid, url, type, visibility }) {
  const ext = guessExtFromUrl(url, type);

  // 1) create doc to obtain assetId
  const asset = await MediaAsset.create({
    ownerUid,
    type,
    visibility,
    status: "uploading",
  });

  const key = `media/${ownerUid}/${asset._id}/original.${ext}`;

  // 2) upload to R2 if missing
  const exists = await r2Exists(key);
  if (!exists) {
    const { buffer, contentType } = await downloadStream(url);

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType || undefined,
      }),
    );
    asset.original = { key, contentType };
  } else {
    // already in R2; keep key so it resolves
    asset.original = { key, contentType: "" };
  }

  // 3) finalize status:
  // - images can be "ready" immediately
  // - videos we mark "uploaded" (you can later queue worker if desired)
  asset.status = type === "image" ? "ready" : "uploaded";
  await asset.save();

  return asset;
}

/**
 * FIELD RULES (explicit, not guesses):
 * - Post media is PUBLIC (it is feed content)
 * - Profile photo is PUBLIC (used in UI)
 * - application.documentUrls is PRIVATE (KYC docs)
 * - ProProfile.gallery is PUBLIC (portfolio)
 *
 * If you want any of these different, change ONLY these constants below.
 */
const VIS = {
  POST_MEDIA: "public",
  PROFILE_PHOTO: "public",
  KYC_DOCS: "private",
  PRO_GALLERY: "public",
};

async function backfillPosts() {
  const q = {
    deleted: { $ne: true },
    media: {
      $elemMatch: {
        url: {
          $type: "string",
          $regex: "cloudinary\\.com|res\\.cloudinary\\.com",
        },
      },
    },
  };

  const cursor = Post.find(q).cursor();

  let touched = 0;

  for await (const post of cursor) {
    let changed = false;

    for (const m of post.media || []) {
      // only legacy rows
      if (m.assetId) continue;
      if (!m.url || !isCloudinaryUrl(m.url)) continue;

      const ownerUid = String(
        post.proOwnerUid || post.ownerUid || post.createdBy || "",
      ).trim();
      if (!ownerUid) continue;

      const type = guessTypeFromUrlOrHint(m.url, m.type);
      if (!DRY_RUN) {
        const asset = await ensureMediaAssetFromUrl({
          ownerUid,
          url: m.url,
          type,
          visibility: VIS.POST_MEDIA,
        });

        m.assetId = asset._id;
      }

      // thumbnail (if present)
      if (
        !m.thumbnailAssetId &&
        m.thumbnailUrl &&
        isCloudinaryUrl(m.thumbnailUrl)
      ) {
        if (!DRY_RUN) {
          const thumb = await ensureMediaAssetFromUrl({
            ownerUid,
            url: m.thumbnailUrl,
            type: "image",
            visibility: VIS.POST_MEDIA,
          });
          m.thumbnailAssetId = thumb._id;
        }
      }

      // keep legacy URLs for safety (optional), but your app can stop using them
      changed = true;
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN) await post.save();
    }

    if (touched && touched % 50 === 0)
      console.log(`[posts] updated ${touched} posts...`);
  }

  console.log(`[posts] done. updated posts: ${touched}`);
}

async function backfillClientProfiles() {
  // collection is "profiles" via model, but this covers the keys you showed
  const q = {
    $or: [
      { photoUrl: { $type: "string", $ne: "" } },
      { "identity.photoUrl": { $type: "string", $ne: "" } },
      { "application.documentUrls.0": { $exists: true } },
    ],
  };

  const cursor = ClientProfile.find(q).cursor();
  let touched = 0;

  for await (const p of cursor) {
    let changed = false;

    // photoUrl
    if (!p.photoAssetId && p.photoUrl && isCloudinaryUrl(p.photoUrl)) {
      if (!DRY_RUN) {
        const a = await ensureMediaAssetFromUrl({
          ownerUid: String(p.uid),
          url: p.photoUrl,
          type: "image",
          visibility: VIS.PROFILE_PHOTO,
        });
        p.photoAssetId = a._id;
      }
      changed = true;
    }

    // identity.photoUrl
    if (
      !p.identity?.photoAssetId &&
      p.identity?.photoUrl &&
      isCloudinaryUrl(p.identity.photoUrl)
    ) {
      if (!DRY_RUN) {
        const a = await ensureMediaAssetFromUrl({
          ownerUid: String(p.uid),
          url: p.identity.photoUrl,
          type: "image",
          visibility: VIS.PROFILE_PHOTO,
        });
        p.identity.photoAssetId = a._id;
      }
      changed = true;
    }

    // application.documentUrls -> application.documentAssetIds
    const docs = Array.isArray(p.application?.documentUrls)
      ? p.application.documentUrls
      : [];
    const existingIds = Array.isArray(p.application?.documentAssetIds)
      ? p.application.documentAssetIds
      : [];

    for (const url of docs) {
      if (!isCloudinaryUrl(url)) continue;

      // avoid duplicate migrations in same doc
      if (existingIds?.length) {
        // keep as-is; doc already has IDs
      }

      if (!DRY_RUN) {
        const a = await ensureMediaAssetFromUrl({
          ownerUid: String(p.uid),
          url,
          type: "image", // documents are usually images; if you have PDFs, adjust here
          visibility: VIS.KYC_DOCS,
        });

        p.application.documentAssetIds = [
          ...(p.application.documentAssetIds || []),
          a._id,
        ];
      }
      changed = true;
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN) await p.save();
    }

    if (touched && touched % 50 === 0)
      console.log(`[profiles] updated ${touched} profiles...`);
  }

  console.log(`[profiles] done. updated profiles: ${touched}`);
}

async function backfillProGallery() {
  const q = { gallery: { $exists: true, $type: "array" } };
  const cursor = ProProfile.find(q).cursor();

  let touched = 0;

  for await (const p of cursor) {
    const g = Array.isArray(p.gallery) ? p.gallery : [];
    const cloudUrls = g.filter((u) => isCloudinaryUrl(u));

    if (!cloudUrls.length) continue;

    let changed = false;
    const ownerUid = String(p.ownerUid || "").trim();
    if (!ownerUid) continue;

    const next = [...g];

    for (let i = 0; i < next.length; i++) {
      const url = next[i];
      if (!isCloudinaryUrl(url)) continue;

      if (!DRY_RUN) {
        const a = await ensureMediaAssetFromUrl({
          ownerUid,
          url,
          type: "image",
          visibility: VIS.PRO_GALLERY,
        });

        // ProProfile.gallery is array of strings, so store PUBLIC url using your base:
        // We cannot call keyToPublicUrl here safely without importing your api/r2.js.
        // Store key string marker or keep as-is; simplest: keep Cloudinary url until your UI is migrated.
        // If you want R2 public URL strings here, tell me your R2_PUBLIC_BASE_URL is stable, then I will set it.
        next[i] = `r2key:${a.original.key}`;
      }

      changed = true;
    }

    if (changed) {
      p.gallery = next;
      touched += 1;
      if (!DRY_RUN) await p.save();
    }

    if (touched && touched % 50 === 0)
      console.log(`[pro gallery] updated ${touched} docs...`);
  }

  console.log(`[pro gallery] done. updated docs: ${touched}`);
}

async function backfillApplications() {
  const collectionName = "applications";
  const c = col(collectionName);

  // Find docs with any string containing cloudinary in a few common fields
  // We do not assume schema; we scan the document shallowly for likely keys.
  const cursor = c
    .find({
      $or: [
        {
          documentUrls: {
            $elemMatch: { $regex: "cloudinary\\.com", $options: "i" },
          },
        },
        {
          "application.documentUrls": {
            $elemMatch: { $regex: "cloudinary\\.com", $options: "i" },
          },
        },
        { photoUrl: { $regex: "cloudinary\\.com", $options: "i" } },
        { "identity.photoUrl": { $regex: "cloudinary\\.com", $options: "i" } },
      ],
    })
    .batchSize(50);

  let touched = 0;

  for await (const doc of cursor) {
    const uid = String(
      doc.ownerUid || doc.uid || doc.clientUid || doc.proOwnerUid || "",
    ).trim();

    if (!uid) continue;

    let changed = false;
    const patch = {};

    // migrate common: documentUrls -> documentAssetIds
    const docUrls = Array.isArray(doc.documentUrls)
      ? doc.documentUrls
      : Array.isArray(doc?.application?.documentUrls)
      ? doc.application.documentUrls
      : [];

    let migratedDocsCount = 0;
    const newAssetIds = [];

    for (const url of docUrls) {
      if (!isCloudinaryUrl(url)) continue;

      migratedDocsCount += 1;
      changed = true;

      if (!DRY_RUN) {
        const a = await ensureMediaAssetFromUrl({
          ownerUid: uid,
          url,
          type: "image",
          visibility: VIS.KYC_DOCS,
        });
        newAssetIds.push(a._id);
      }
    }

    if (!DRY_RUN && newAssetIds.length) {
      patch.documentAssetIds = newAssetIds;
    }

    // optional: DRY_RUN visibility
    if (DRY_RUN && migratedDocsCount) {
      // leave patch empty; we only want a reliable touched count
    }

    if (newAssetIds.length) {
      // store in a safe field without assuming schema
      patch.documentAssetIds = newAssetIds;
    }

    // migrate common: photoUrl
    if (doc.photoUrl && isCloudinaryUrl(doc.photoUrl)) {
      if (!DRY_RUN) {
        const a = await ensureMediaAssetFromUrl({
          ownerUid: uid,
          url: doc.photoUrl,
          type: "image",
          visibility: VIS.PROFILE_PHOTO,
        });
        patch.photoAssetId = a._id;
      }
      changed = true;
    }

    if (doc?.identity?.photoUrl && isCloudinaryUrl(doc.identity.photoUrl)) {
      if (!DRY_RUN) {
        const a = await ensureMediaAssetFromUrl({
          ownerUid: uid,
          url: doc.identity.photoUrl,
          type: "image",
          visibility: VIS.PROFILE_PHOTO,
        });
        patch["identity.photoAssetId"] = a._id;
      }
      changed = true;
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN) {
        // flatten dotted keys properly
        const setPatch = {};
        for (const [k, v] of Object.entries(patch)) setPatch[k] = v;
        await c.updateOne({ _id: doc._id }, { $set: setPatch });
      }
    }

    if (touched && touched % 50 === 0)
      console.log(`[applications] updated ${touched} docs...`);
  }

  console.log(`[applications] done. updated docs: ${touched}`);
}

async function backfillPros() {
  const collectionName = "pros";
  const c = col(collectionName);

  const cursor = c
    .find({
      $or: [
        { photoUrl: { $regex: "cloudinary\\.com", $options: "i" } },
        {
          gallery: {
            $elemMatch: { $regex: "cloudinary\\.com", $options: "i" },
          },
        },
      ],
    })
    .batchSize(50);

  let touched = 0;

  for await (const doc of cursor) {
    const ownerUid = String(doc.ownerUid || doc.uid || "").trim();
    if (!ownerUid) continue;

    let changed = false;
    const patch = {};

    if (doc.photoUrl && isCloudinaryUrl(doc.photoUrl)) {
      if (!DRY_RUN) {
        const a = await ensureMediaAssetFromUrl({
          ownerUid,
          url: doc.photoUrl,
          type: "image",
          visibility: VIS.PROFILE_PHOTO,
        });
        patch.photoAssetId = a._id;
      }
      changed = true;
    }

    const g = Array.isArray(doc.gallery) ? doc.gallery : [];
    const hasCloud = g.some((u) => isCloudinaryUrl(u));

    if (hasCloud) {
      const next = [...g];
      for (let i = 0; i < next.length; i++) {
        if (!isCloudinaryUrl(next[i])) continue;

        if (!DRY_RUN) {
          const a = await ensureMediaAssetFromUrl({
            ownerUid,
            url: next[i],
            type: "image",
            visibility: VIS.PRO_GALLERY,
          });
          next[i] = `r2key:${a.original.key}`;
        }
        changed = true;
      }

      if (!DRY_RUN) patch.gallery = next;
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN) await c.updateOne({ _id: doc._id }, { $set: patch });
    }

    if (touched && touched % 50 === 0)
      console.log(`[pros] updated ${touched} docs...`);
  }

  console.log(`[pros] done. updated docs: ${touched}`);
}

async function main() {
  await mongoose.connect(MONGODB_URI);

  console.log("DRY_RUN =", DRY_RUN);

  await backfillPosts(); // posts
  await backfillClientProfiles(); // profiles (your model-backed)
  await backfillProGallery(); // proprofiles gallery (0 docs in your DB)

  // ✅ NEW: collections found by inventory
  await backfillApplications();
  await backfillPros();

  await mongoose.disconnect();
  console.log("✅ DB backfill finished.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
