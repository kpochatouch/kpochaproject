// apps/api/scripts/inventory_cloudinary_urls.js
import mongoose from "mongoose";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const MONGODB_URI = must("MONGODB_URI");
const RX = /cloudinary\.com|res\.cloudinary\.com/i;

function findCloudinaryInValue(v, path, hits) {
  if (v == null) return;

  if (typeof v === "string") {
    if (RX.test(v)) hits.push({ path, sample: v.slice(0, 160) });
    return;
  }

  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      findCloudinaryInValue(v[i], `${path}[${i}]`, hits);
    }
    return;
  }

  if (typeof v === "object") {
    for (const k of Object.keys(v)) {
      findCloudinaryInValue(v[k], path ? `${path}.${k}` : k, hits);
    }
  }
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const cols = await db.listCollections().toArray();
  console.log("DB:", db.databaseName);
  console.log("Collections:", cols.length);

  const results = [];

  for (const c of cols) {
    const name = c.name;
    const col = db.collection(name);

    // fast prefilter: only docs that contain "cloudinary" somewhere in JSON
    const cursor = col.find({ $text: { $search: "cloudinary" } }).limit(50);
    let foundAny = false;
    let docCount = 0;

    // if no text index, fallback to regex scan on a few docs
    let docs = [];
    try {
      docs = await cursor.toArray();
    } catch {
      docs = await col
        .find({ $or: [{}, {}] })
        .project({})
        .limit(30)
        .toArray();
    }

    for (const d of docs) {
      docCount++;
      const hits = [];
      findCloudinaryInValue(d, "", hits);
      if (hits.length) {
        foundAny = true;
        results.push({
          collection: name,
          _id: String(d._id),
          hits: hits.slice(0, 8),
        });
        break; // one proof per collection is enough
      }
    }

    if (foundAny) {
      console.log(`✅ ${name}: has Cloudinary URLs`);
    }
  }

  console.log("\n=== SUMMARY (collections with Cloudinary URLs) ===");
  const uniq = [...new Set(results.map((r) => r.collection))].sort();
  console.log(uniq);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
