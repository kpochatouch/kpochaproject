// apps/api/scripts/bulk_replace_cloudinary_urls_everywhere.js
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config();

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const MONGODB_URI = must("MONGODB_URI");
const DB_NAME = process.env.DB_NAME || "kpocha_touch_barbers";
const R2_PUBLIC_BASE_URL = must("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
const MAP_FILE =
  process.env.MAP_FILE || path.resolve("cloudinary_backup_map.jsonl");
const DRY_RUN = String(process.env.DRY_RUN || "") === "1";

const CLOUD_RX =
  /^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\/v\d+\/(.+)$/i;

function keyToPublicUrl(key) {
  return `${R2_PUBLIC_BASE_URL}/${String(key).replace(/^\/+/, "")}`;
}

function isCloudinaryUrl(s) {
  return typeof s === "string" && s.includes("res.cloudinary.com/");
}

function parseCloudinary(url) {
  // returns { resource_type, public_id } if possible
  const m = String(url).match(CLOUD_RX);
  if (!m) return null;
  const resource_type = m[1].toLowerCase();
  const tail = m[2]; // public_id + extension sometimes
  // Cloudinary secure_url usually ends with .../<public_id>.<ext>
  // In map we have public_id without extension. So strip last extension.
  const public_id = tail.replace(/\.[a-z0-9]+$/i, "");
  return { resource_type, public_id };
}

function buildMapIndex() {
  // two indices:
  // 1) by exact secure_url
  // 2) by `${resource_type}:${public_id}`
  const bySecureUrl = new Map();
  const byPublicId = new Map();

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

    if (secure && key) bySecureUrl.set(secure, key);
    if (resource_type && public_id && key) {
      byPublicId.set(`${resource_type}:${public_id}`, key);
    }
  }

  return { bySecureUrl, byPublicId };
}

function walkAndCollect(obj, basePath = "") {
  // returns array of { path, value } for cloudinary url strings
  const hits = [];

  const visit = (val, p) => {
    if (typeof val === "string") {
      if (isCloudinaryUrl(val)) hits.push({ path: p, value: val });
      return;
    }
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++)
        visit(val[i], p ? `${p}.${i}` : String(i));
      return;
    }
    if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val)) {
        visit(v, p ? `${p}.${k}` : k);
      }
    }
  };

  visit(obj, basePath);
  return hits;
}

function getReplacement(url, idx) {
  // 1) exact match secure_url -> key
  const k1 = idx.bySecureUrl.get(url);
  if (k1) return keyToPublicUrl(k1);

  // 2) parse and match by public_id
  const parsed = parseCloudinary(url);
  if (parsed) {
    const k2 = idx.byPublicId.get(
      `${parsed.resource_type}:${parsed.public_id}`,
    );
    if (k2) return keyToPublicUrl(k2);
  }

  return null;
}

async function main() {
  if (!fs.existsSync(MAP_FILE)) {
    throw new Error(`Map file not found: ${MAP_FILE}`);
  }

  const idx = buildMapIndex();
  console.log("DB:", DB_NAME);
  console.log("DRY_RUN:", DRY_RUN);
  console.log("MAP_FILE:", MAP_FILE);
  console.log("R2_PUBLIC_BASE_URL:", R2_PUBLIC_BASE_URL);
  console.log("Map index sizes:", {
    bySecureUrl: idx.bySecureUrl.size,
    byPublicId: idx.byPublicId.size,
  });

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const names = collections.map((c) => c.name);

  let totalDocsScanned = 0;
  let totalDocsChanged = 0;
  let totalUrlsRewritten = 0;
  let totalUrlsUnmapped = 0;

  for (const colName of names) {
    // skip system collections if any
    if (colName.startsWith("system.")) continue;

    const col = db.collection(colName);
    const cursor = col.find(
      {},
      {
        projection: {
          /* full doc */
        },
      },
    );

    const bulk = [];
    let scanned = 0;
    let changedDocs = 0;
    let rewritten = 0;
    let unmapped = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      scanned++;
      totalDocsScanned++;

      const hits = walkAndCollect(doc);
      if (!hits.length) continue;

      const $set = {};
      let localChanged = 0;

      for (const h of hits) {
        const rep = getReplacement(h.value, idx);
        if (rep) {
          $set[h.path] = rep;
          localChanged++;
          rewritten++;
          totalUrlsRewritten++;
        } else {
          unmapped++;
          totalUrlsUnmapped++;
        }
      }

      if (localChanged > 0) {
        changedDocs++;
        totalDocsChanged++;

        bulk.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set },
          },
        });
      }

      // execute in batches
      if (bulk.length >= 300) {
        if (!DRY_RUN) await col.bulkWrite(bulk, { ordered: false });
        bulk.length = 0;
      }
    }

    if (bulk.length) {
      if (!DRY_RUN) await col.bulkWrite(bulk, { ordered: false });
    }

    if (scanned || changedDocs || rewritten || unmapped) {
      console.log(
        `[${colName}] scanned=${scanned} changedDocs=${changedDocs} rewrittenUrls=${rewritten} unmappedUrls=${unmapped}`,
      );
    }
  }

  console.log("✅ DONE", {
    totalDocsScanned,
    totalDocsChanged,
    totalUrlsRewritten,
    totalUrlsUnmapped,
    dryRun: DRY_RUN,
  });

  await client.close();
}

main().catch((e) => {
  console.error("❌ FAILED", e);
  process.exit(1);
});
