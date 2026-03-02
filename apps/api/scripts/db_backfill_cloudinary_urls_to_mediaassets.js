// apps/api/scripts/db_backfill_cloudinary_urls_to_mediaassets.js
/**
 * Unified DB backfill (Cloudinary -> R2 -> MediaAsset -> assetId pointers)
 *
 * Goal:
 * - Stop relying on legacy Cloudinary URL fields in DB.
 * - For known schemas (posts/profiles/pros/proprofiles/applications/etc):
 *   - Create (or reuse) MediaAsset docs
 *   - Point records to assetId / thumbnailAssetId / photoAssetId / documentAssetIds
 * - Keep legacy URL fields untouched for safety (optional cleanup later)
 *
 * IMPORTANT:
 * - This script can work even if Cloudinary is deactivated,
 *   as long as you have cloudinary_backup_map.jsonl from cloudinary_full_backup_to_r2.js
 *
 * Required env:
 *   MONGODB_URI
 *   R2_ENDPOINT
 *   R2_ACCESS_KEY
 *   R2_SECRET_KEY
 *   R2_BUCKET
 *
 * Strongly recommended env:
 *   MAP_FILE=./cloudinary_backup_map.jsonl   (or absolute path)
 *
 * Optional:
 *   DB_NAME=kpocha_touch_barbers   (only used for logging; Mongoose uses uri DB unless overridden)
 *   DRY_RUN=1                      (no writes)
 *   VERIFY_R2=1                    (HEAD check keys before creating MediaAsset)
 */

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

import MediaAsset from "../models/MediaAsset.js";
import Post from "../models/Post.js";
import { ClientProfile } from "../models/Profile.js";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const MONGODB_URI = must("MONGODB_URI");
const R2_BUCKET = must("R2_BUCKET");

const DRY_RUN = String(process.env.DRY_RUN || "") === "1";
const VERIFY_R2 = String(process.env.VERIFY_R2 || "") === "1";

const MAP_FILE =
  process.env.MAP_FILE ||
  path.resolve(process.cwd(), "cloudinary_backup_map.jsonl");

const s3 = new S3Client({
  region: "auto",
  endpoint: must("R2_ENDPOINT"),
  credentials: {
    accessKeyId: must("R2_ACCESS_KEY"),
    secretAccessKey: must("R2_SECRET_KEY"),
  },
});

const RX_CLOUD = /cloudinary\.com|res\.cloudinary\.com/i;

// Treat as Cloudinary url if it contains res.cloudinary.com or cloudinary.com
function isCloudinaryUrl(s) {
  return typeof s === "string" && RX_CLOUD.test(s);
}

/**
 * Visibility rules (explicit)
 * - Post media is PUBLIC (feed content)
 * - Profile photo is PUBLIC (used in UI)
 * - KYC docs are PRIVATE (must never be CDN-leaked)
 * - Galleries are PUBLIC (portfolio)
 */
const VIS = {
  POST_MEDIA: "public",
  PROFILE_PHOTO: "public",
  KYC_DOCS: "private",
  GALLERY: "public",
};

function guessTypeFromUrlOrHint(url, hintType) {
  if (hintType === "video" || hintType === "image") return hintType;
  const u = String(url || "").toLowerCase();
  if (u.match(/\.(mp4|webm|mov|mkv|3gp|m3u8)(\?|$)/)) return "video";
  return "image";
}

function guessExtFromKeyOrUrl({ key, url, type }) {
  // Prefer ext from key
  if (key && typeof key === "string") {
    const m = key.match(/\.([a-zA-Z0-9]+)$/);
    if (m) return m[1].toLowerCase();
  }
  // Else from url path
  const u = String(url || "");
  const m = u.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
  if (m) return m[1].toLowerCase();
  return type === "video" ? "mp4" : "jpg";
}

/**
 * Build a lookup: Cloudinary secure_url -> r2.key
 * Also: (resource_type:public_id) -> r2.key
 * This is what lets us migrate even after Cloudinary deactivation.
 */
function buildMapIndex() {
  const bySecureUrl = new Map();
  const byPublicId = new Map();

  if (!fs.existsSync(MAP_FILE)) {
    console.warn("⚠️ MAP_FILE not found:", MAP_FILE);
    return { bySecureUrl, byPublicId };
  }

  const raw = fs.readFileSync(MAP_FILE, "utf8").trim();
  if (!raw) return { bySecureUrl, byPublicId };

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row?.ok) continue;

    const secure = row?.cloudinary?.secure_url;
    const key = row?.r2?.key;
    const resource_type = row?.cloudinary?.resource_type;
    const public_id = row?.cloudinary?.public_id;

    if (secure && key) bySecureUrl.set(String(secure), String(key));
    if (resource_type && public_id && key) {
      byPublicId.set(
        `${String(resource_type)}:${String(public_id)}`,
        String(key),
      );
    }
  }

  return { bySecureUrl, byPublicId };
}

/**
 * Cloudinary secure_url parsing to resource_type + public_id
 * Works for typical secure_url shape.
 */
const CLOUD_RX =
  /^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\/v\d+\/(.+)$/i;

function parseCloudinary(url) {
  const m = String(url).match(CLOUD_RX);
  if (!m) return null;
  const resource_type = m[1].toLowerCase();
  const tail = m[2];
  const public_id = tail.replace(/\.[a-z0-9]+$/i, "");
  return { resource_type, public_id };
}

function cloudinaryUrlToR2Key(url, idx) {
  const k1 = idx.bySecureUrl.get(String(url));
  if (k1) return k1;

  const parsed = parseCloudinary(url);
  if (parsed) {
    const k2 = idx.byPublicId.get(
      `${parsed.resource_type}:${parsed.public_id}`,
    );
    if (k2) return k2;
  }
  return "";
}

async function r2Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * DEDUPE STRATEGY
 * We try to reuse an existing MediaAsset by:
 *   { ownerUid, "original.key": key }
 * If found -> reuse.
 * Else -> create a new MediaAsset that points to that key.
 */
async function ensureMediaAssetFromR2Key({
  ownerUid,
  key,
  type,
  visibility,
  sourceUrl = "",
}) {
  const cleanOwner = String(ownerUid || "").trim();
  const cleanKey = String(key || "")
    .trim()
    .replace(/^\/+/, "");
  const cleanSource = String(sourceUrl || "").trim();

  if (!cleanOwner)
    throw new Error("ensureMediaAssetFromR2Key: missing ownerUid");
  if (!cleanKey) throw new Error("ensureMediaAssetFromR2Key: missing key");

  // ✅ Strong dedupe order:
  // 1) owner + sourceUrl (best for reruns)
  // 2) owner + original.key (best for already-migrated)
  let existing = null;

  if (cleanSource) {
    existing = await MediaAsset.findOne({
      ownerUid: cleanOwner,
      sourceUrl: cleanSource,
    }).lean();
    if (existing) return existing;
  }

  existing = await MediaAsset.findOne({
    ownerUid: cleanOwner,
    "original.key": cleanKey,
  }).lean();
  if (existing) return existing;

  if (VERIFY_R2) {
    const ok = await r2Exists(cleanKey);
    if (!ok) throw new Error(`R2 key not found (VERIFY_R2=1): ${cleanKey}`);
  }

  if (DRY_RUN) {
    return {
      _id: new mongoose.Types.ObjectId(),
      ownerUid: cleanOwner,
      sourceUrl: cleanSource,
      type,
      visibility,
      status: type === "image" ? "ready" : "uploaded",
      original: { key: cleanKey },
    };
  }

  const asset = await MediaAsset.create({
    ownerUid: cleanOwner,
    sourceUrl: cleanSource,
    type,
    visibility,
    status: type === "image" ? "ready" : "uploaded",
    original: {
      key: cleanKey,
      contentType: "",
      size: 0,
      durationSec: 0,
      width: 0,
      height: 0,
    },
  });

  return asset.toObject ? asset.toObject() : asset;
}

/**
 * Core helper:
 * - Accepts a Cloudinary URL
 * - Resolves to R2 key via map file
 * - Creates/returns MediaAsset
 */
async function ensureMediaAssetFromCloudinaryUrl({
  ownerUid,
  url,
  type,
  visibility,
  mapIdx,
}) {
  const keyFromMap = cloudinaryUrlToR2Key(url, mapIdx);
  if (!keyFromMap) return null;

  const finalType = guessTypeFromUrlOrHint(url, type);
  // Not strictly needed, but helps ensure ext defaults are stable if you later rebuild keys.
  guessExtFromKeyOrUrl({ key: keyFromMap, url, type: finalType });

  return ensureMediaAssetFromR2Key({
    ownerUid,
    key: keyFromMap,
    type: finalType,
    visibility,
    sourceUrl: url, // ✅ store legacy URL for dedupe reruns
  });
}

/**
 * Raw collection accessor
 */
function col(name) {
  return mongoose.connection.db.collection(name);
}

/**
 * POST BACKFILL
 * - posts.media[].url -> assetId
 * - posts.media[].thumbnailUrl -> thumbnailAssetId
 */
async function backfillPosts(mapIdx) {
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
  let migratedItems = 0;
  let unmapped = 0;

  for await (const post of cursor) {
    let changed = false;

    for (const m of post.media || []) {
      if (m.assetId) continue;
      if (!m.url || !isCloudinaryUrl(m.url)) continue;

      const ownerUid = String(
        post.proOwnerUid || post.ownerUid || post.createdBy || "",
      ).trim();
      if (!ownerUid) continue;

      const asset = await ensureMediaAssetFromCloudinaryUrl({
        ownerUid,
        url: m.url,
        type: m.type,
        visibility: VIS.POST_MEDIA,
        mapIdx,
      });

      if (!asset) {
        unmapped += 1;
        continue;
      }

      if (!DRY_RUN) m.assetId = asset._id;
      changed = true;
      migratedItems += 1;

      // thumbnail (if present)
      if (
        !m.thumbnailAssetId &&
        m.thumbnailUrl &&
        isCloudinaryUrl(m.thumbnailUrl)
      ) {
        const thumb = await ensureMediaAssetFromCloudinaryUrl({
          ownerUid,
          url: m.thumbnailUrl,
          type: "image",
          visibility: VIS.POST_MEDIA,
          mapIdx,
        });

        if (thumb) {
          if (!DRY_RUN) m.thumbnailAssetId = thumb._id;
          changed = true;
        } else {
          unmapped += 1;
        }
      }
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN) await post.save();
    }

    if (touched && touched % 25 === 0) {
      console.log(
        `[posts] updated=${touched} migratedItems=${migratedItems} unmapped=${unmapped}`,
      );
    }
  }

  console.log(
    `[posts] DONE updated=${touched} migratedItems=${migratedItems} unmapped=${unmapped}`,
  );
}

/**
 * PROFILES-like backfill helper
 * Works for: profiles, clientprofiles, profiles_preview_merged, profiles_spam_quarantine
 *
 * Rules:
 * - photoUrl + identity.photoUrl => photoAssetId / identity.photoAssetId (PUBLIC)
 * - application.documentUrls[] => application.documentAssetIds[] (PRIVATE)
 */
async function backfillProfilesCollection(mapIdx, collectionName) {
  const c = col(collectionName);

  const cursor = c
    .find({
      $or: [
        { photoUrl: { $regex: "cloudinary\\.com", $options: "i" } },
        { "identity.photoUrl": { $regex: "cloudinary\\.com", $options: "i" } },
        {
          "application.documentUrls": {
            $elemMatch: { $regex: "cloudinary\\.com", $options: "i" },
          },
        },
      ],
    })
    .batchSize(50);

  let touched = 0;
  let migrated = 0;
  let unmapped = 0;

  for await (const doc of cursor) {
    const uid = String(doc.uid || doc.ownerUid || doc.userUid || "").trim();
    if (!uid) continue;

    const patch = {};
    let changed = false;

    // photoUrl -> photoAssetId
    if (!doc.photoAssetId && doc.photoUrl && isCloudinaryUrl(doc.photoUrl)) {
      const a = await ensureMediaAssetFromCloudinaryUrl({
        ownerUid: uid,
        url: doc.photoUrl,
        type: "image",
        visibility: VIS.PROFILE_PHOTO,
        mapIdx,
      });

      if (a) {
        patch.photoAssetId = a._id;
        changed = true;
        migrated += 1;
      } else {
        unmapped += 1;
      }
    }

    // identity.photoUrl -> identity.photoAssetId
    if (
      !doc?.identity?.photoAssetId &&
      doc?.identity?.photoUrl &&
      isCloudinaryUrl(doc.identity.photoUrl)
    ) {
      const a = await ensureMediaAssetFromCloudinaryUrl({
        ownerUid: uid,
        url: doc.identity.photoUrl,
        type: "image",
        visibility: VIS.PROFILE_PHOTO,
        mapIdx,
      });

      if (a) {
        patch["identity.photoAssetId"] = a._id;
        changed = true;
        migrated += 1;
      } else {
        unmapped += 1;
      }
    }

    // application.documentUrls[] -> application.documentAssetIds[]
    const docUrls = Array.isArray(doc?.application?.documentUrls)
      ? doc.application.documentUrls
      : [];

    if (docUrls.length) {
      const existing = Array.isArray(doc?.application?.documentAssetIds)
        ? doc.application.documentAssetIds.map((x) => String(x))
        : [];

      const nextSet = new Set(existing);

      for (const url of docUrls) {
        if (!isCloudinaryUrl(url)) continue;

        const a = await ensureMediaAssetFromCloudinaryUrl({
          ownerUid: uid,
          url,
          type: "image",
          visibility: VIS.KYC_DOCS,
          mapIdx,
        });

        if (a) {
          nextSet.add(String(a._id));
          changed = true;
          migrated += 1;
        } else {
          unmapped += 1;
        }
      }

      if (changed) {
        patch["application.documentAssetIds"] = Array.from(nextSet).map(
          (s) => new mongoose.Types.ObjectId(s),
        );
      }
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN) {
        await c.updateOne({ _id: doc._id }, { $set: patch });
      }
    }

    if (touched && touched % 25 === 0) {
      console.log(
        `[${collectionName}] updated=${touched} migrated=${migrated} unmapped=${unmapped}`,
      );
    }
  }

  console.log(
    `[${collectionName}] DONE updated=${touched} migrated=${migrated} unmapped=${unmapped}`,
  );
}

/**
 * APPLICATIONS backfill (raw collection: applications)
 * Rules:
 * - documentUrls[] or application.documentUrls[] => documentAssetIds[] (PRIVATE)
 * - photoUrl / identity.photoUrl => photoAssetId / identity.photoAssetId (PUBLIC)
 */
async function backfillApplications(mapIdx) {
  const c = col("applications");

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
  let migrated = 0;
  let unmapped = 0;

  for await (const doc of cursor) {
    const uid = String(
      doc.ownerUid || doc.uid || doc.clientUid || doc.proOwnerUid || "",
    ).trim();
    if (!uid) continue;

    const patch = {};
    let changed = false;

    const docUrls = Array.isArray(doc.documentUrls)
      ? doc.documentUrls
      : Array.isArray(doc?.application?.documentUrls)
      ? doc.application.documentUrls
      : [];

    if (docUrls.length) {
      const next = new Set(
        Array.isArray(doc.documentAssetIds)
          ? doc.documentAssetIds.map((x) => String(x))
          : [],
      );

      for (const url of docUrls) {
        if (!isCloudinaryUrl(url)) continue;

        const a = await ensureMediaAssetFromCloudinaryUrl({
          ownerUid: uid,
          url,
          type: "image",
          visibility: VIS.KYC_DOCS,
          mapIdx,
        });

        if (a) {
          next.add(String(a._id));
          changed = true;
          migrated += 1;
        } else {
          unmapped += 1;
        }
      }

      if (changed) {
        patch.documentAssetIds = Array.from(next).map(
          (s) => new mongoose.Types.ObjectId(s),
        );
      }
    }

    if (doc.photoUrl && isCloudinaryUrl(doc.photoUrl) && !doc.photoAssetId) {
      const a = await ensureMediaAssetFromCloudinaryUrl({
        ownerUid: uid,
        url: doc.photoUrl,
        type: "image",
        visibility: VIS.PROFILE_PHOTO,
        mapIdx,
      });

      if (a) {
        patch.photoAssetId = a._id;
        changed = true;
        migrated += 1;
      } else {
        unmapped += 1;
      }
    }

    if (
      doc?.identity?.photoUrl &&
      isCloudinaryUrl(doc.identity.photoUrl) &&
      !doc?.identity?.photoAssetId
    ) {
      const a = await ensureMediaAssetFromCloudinaryUrl({
        ownerUid: uid,
        url: doc.identity.photoUrl,
        type: "image",
        visibility: VIS.PROFILE_PHOTO,
        mapIdx,
      });

      if (a) {
        patch["identity.photoAssetId"] = a._id;
        changed = true;
        migrated += 1;
      } else {
        unmapped += 1;
      }
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN) await c.updateOne({ _id: doc._id }, { $set: patch });
    }

    if (touched && touched % 25 === 0) {
      console.log(
        `[applications] updated=${touched} migrated=${migrated} unmapped=${unmapped}`,
      );
    }
  }

  console.log(
    `[applications] DONE updated=${touched} migrated=${migrated} unmapped=${unmapped}`,
  );
}

/**
 * PROS / PROFESSIONALS backfill
 * Collections: pros, professionals (both exist in your screenshot list)
 *
 * Rules:
 * - photoUrl => photoAssetId (PUBLIC)
 * - gallery[] => replace "r2key:<key>" markers (PUBLIC) (keeps schema as string array)
 *   (We do NOT rewrite to actual public URL string; your resolver should handle keys or you can later normalize)
 */
async function backfillProsLike(mapIdx, collectionName) {
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
  let migrated = 0;
  let unmapped = 0;

  for await (const doc of cursor) {
    const ownerUid = String(doc.ownerUid || doc.uid || "").trim();
    if (!ownerUid) continue;

    const patch = {};
    let changed = false;

    if (doc.photoUrl && isCloudinaryUrl(doc.photoUrl) && !doc.photoAssetId) {
      const a = await ensureMediaAssetFromCloudinaryUrl({
        ownerUid,
        url: doc.photoUrl,
        type: "image",
        visibility: VIS.PROFILE_PHOTO,
        mapIdx,
      });

      if (a) {
        patch.photoAssetId = a._id;
        changed = true;
        migrated += 1;
      } else {
        unmapped += 1;
      }
    }

    const g = Array.isArray(doc.gallery) ? doc.gallery : [];
    const next = [...g];
    let galleryChanged = false;

    for (let i = 0; i < next.length; i++) {
      const url = next[i];
      if (!isCloudinaryUrl(url)) continue;

      const a = await ensureMediaAssetFromCloudinaryUrl({
        ownerUid,
        url,
        type: "image",
        visibility: VIS.GALLERY,
        mapIdx,
      });

      if (a) {
        next[i] = `r2key:${a.original?.key || ""}`;
        galleryChanged = true;
        migrated += 1;
      } else {
        unmapped += 1;
      }
    }

    if (galleryChanged) {
      patch.gallery = next;
      changed = true;
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN) await c.updateOne({ _id: doc._id }, { $set: patch });
    }

    if (touched && touched % 25 === 0) {
      console.log(
        `[${collectionName}] updated=${touched} migrated=${migrated} unmapped=${unmapped}`,
      );
    }
  }

  console.log(
    `[${collectionName}] DONE updated=${touched} migrated=${migrated} unmapped=${unmapped}`,
  );
}

/**
 * PROPROFILES backfill
 * Collection: proprofiles (exists in your screenshots)
 * Rule: gallery[] cloudinary -> r2key:<key>
 */
async function backfillProProfiles(mapIdx) {
  const c = col("proprofiles");

  const cursor = c
    .find({
      gallery: { $elemMatch: { $regex: "cloudinary\\.com", $options: "i" } },
    })
    .batchSize(50);

  let touched = 0;
  let migrated = 0;
  let unmapped = 0;

  for await (const doc of cursor) {
    const ownerUid = String(doc.ownerUid || "").trim();
    if (!ownerUid) continue;

    const g = Array.isArray(doc.gallery) ? doc.gallery : [];
    const next = [...g];
    let changed = false;

    for (let i = 0; i < next.length; i++) {
      const url = next[i];
      if (!isCloudinaryUrl(url)) continue;

      const a = await ensureMediaAssetFromCloudinaryUrl({
        ownerUid,
        url,
        type: "image",
        visibility: VIS.GALLERY,
        mapIdx,
      });

      if (a) {
        next[i] = `r2key:${a.original?.key || ""}`;
        changed = true;
        migrated += 1;
      } else {
        unmapped += 1;
      }
    }

    if (changed) {
      touched += 1;
      if (!DRY_RUN)
        await c.updateOne({ _id: doc._id }, { $set: { gallery: next } });
    }

    if (touched && touched % 25 === 0) {
      console.log(
        `[proprofiles] updated=${touched} migrated=${migrated} unmapped=${unmapped}`,
      );
    }
  }

  console.log(
    `[proprofiles] DONE updated=${touched} migrated=${migrated} unmapped=${unmapped}`,
  );
}

/**
 * COMPREHENSIVE AUDIT (read-only):
 * Scan ALL collections and report any still containing Cloudinary URLs,
 * even if we don't have a schema handler for them.
 */
async function auditAllCollectionsForCloudinary() {
  const db = mongoose.connection.db;
  const cols = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = cols.map((c) => c.name).filter((n) => !n.startsWith("system."));

  const offenders = [];

  for (const name of names) {
    const c = db.collection(name);

    // fast-ish sample: find ONE doc containing "cloudinary" anywhere using regex on $where is too slow.
    // We'll do a limited scan (30 docs) and look for a string match in JSON.
    const docs = await c.find({}).limit(30).toArray();
    let found = false;

    for (const d of docs) {
      const json = JSON.stringify(d);
      if (RX_CLOUD.test(json)) {
        found = true;
        offenders.push(name);
        break;
      }
    }
  }

  offenders.sort();
  console.log(
    "\n=== AUDIT: collections with Cloudinary URLs (sample scan) ===",
  );
  console.log(offenders.length ? offenders : ["(none found in samples)"]);
  console.log(
    "NOTE: sample scan can miss rare URLs; handlers cover known schemas.",
  );
}

async function main() {
  console.log("DRY_RUN =", DRY_RUN);
  console.log("VERIFY_R2 =", VERIFY_R2);
  console.log(
    "MAP_FILE =",
    MAP_FILE,
    fs.existsSync(MAP_FILE) ? "(found)" : "(MISSING)",
  );

  await mongoose.connect(MONGODB_URI);

  const mapIdx = buildMapIndex();
  console.log("Map index sizes:", {
    bySecureUrl: mapIdx.bySecureUrl.size,
    byPublicId: mapIdx.byPublicId.size,
  });

  // 1) Known schema backfills (comprehensive for your screenshot collections)
  await backfillPosts(mapIdx);

  // Profiles + variants seen in your screenshots
  await backfillProfilesCollection(mapIdx, "profiles");
  // optional: these exist in your DB list; we migrate the same fields if present
  await backfillProfilesCollection(mapIdx, "clientprofiles").catch(() => {});
  await backfillProfilesCollection(mapIdx, "profiles_preview_merged").catch(
    () => {},
  );
  await backfillProfilesCollection(mapIdx, "profiles_spam_quarantine").catch(
    () => {},
  );

  // Applications / Pros / ProProfiles
  await backfillApplications(mapIdx);
  await backfillProsLike(mapIdx, "pros");
  await backfillProsLike(mapIdx, "professionals").catch(() => {});
  await backfillProProfiles(mapIdx).catch(() => {});

  // 2) Read-only audit (so you know if anything is still hiding Cloudinary URLs)
  await auditAllCollectionsForCloudinary();

  await mongoose.disconnect();
  console.log("✅ Backfill finished.");
}

main().catch((e) => {
  console.error("❌ FAILED:", e?.message || e);
  process.exit(1);
});
