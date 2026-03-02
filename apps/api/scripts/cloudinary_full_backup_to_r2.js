//apps/api/scripts/cloudinary_full_backup_to_r2.js
/**
 * Full Cloudinary backup -> R2 (copies EVERYTHING)
 *
 * Output:
 * - Writes ./cloudinary_backup_map.jsonl (resume-friendly)
 *
 * Required env:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 *   R2_ENDPOINT
 *   R2_ACCESS_KEY
 *   R2_SECRET_KEY
 *   R2_BUCKET
 *
 * Optional env:
 *   BACKUP_PREFIX   (default "cloudinary-backup")
 *   ONLY_TYPE       (image|video|raw)
 *   MAX_ITEMS       (0 = unlimited)
 */

import fs from "fs";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const MAP_PATH = path.join(process.cwd(), "cloudinary_backup_map.jsonl");

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const CLOUD_NAME = must("CLOUDINARY_CLOUD_NAME");
const CLD_KEY = must("CLOUDINARY_API_KEY");
const CLD_SECRET = must("CLOUDINARY_API_SECRET");

const R2_ENDPOINT = must("R2_ENDPOINT");
const R2_ACCESS_KEY = must("R2_ACCESS_KEY");
const R2_SECRET_KEY = must("R2_SECRET_KEY");
const R2_BUCKET = must("R2_BUCKET");

const BACKUP_PREFIX = (
  process.env.BACKUP_PREFIX || "cloudinary-backup"
).replace(/^\/+|\/+$/g, "");
const ONLY_TYPE = (process.env.ONLY_TYPE || "").trim(); // image|video|raw
const MAX_ITEMS = Number(process.env.MAX_ITEMS || "0");

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

function basicAuthHeader(user, pass) {
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return `Basic ${token}`;
}

function guessExt(resource) {
  const fmt = String(resource.format || "").toLowerCase();
  if (fmt) return fmt;

  try {
    const u = new URL(resource.secure_url);
    const m = u.pathname.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function safeKey(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "");
}

async function r2Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function cloudinaryList({ resource_type, next_cursor }) {
  const base = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    CLOUD_NAME,
  )}/resources/${encodeURIComponent(resource_type)}`;
  const params = new URLSearchParams();
  params.set("max_results", "500");
  params.set("direction", "asc");
  if (next_cursor) params.set("next_cursor", next_cursor);

  const url = `${base}?${params.toString()}`;

  const res = await fetch(url, {
    headers: { Authorization: basicAuthHeader(CLD_KEY, CLD_SECRET) },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(
      `Cloudinary list failed (${res.status}): ${txt.slice(0, 400)}`,
    );
  }

  return res.json();
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

function readDoneAssetIds() {
  const s = new Set();
  if (!fs.existsSync(MAP_PATH)) return s;
  const lines = fs.readFileSync(MAP_PATH, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row?.cloudinary?.asset_id) s.add(row.cloudinary.asset_id);
    } catch {}
  }
  return s;
}

function appendRow(row) {
  fs.appendFileSync(MAP_PATH, JSON.stringify(row) + "\n");
}

async function main() {
  const done = readDoneAssetIds();
  const types = ["image", "video", "raw"].filter(
    (t) => !ONLY_TYPE || t === ONLY_TYPE,
  );

  let processed = 0;

  for (const t of types) {
    let next_cursor = null;

    while (true) {
      const page = await cloudinaryList({ resource_type: t, next_cursor });
      const resources = page.resources || [];

      for (const r of resources) {
        if (MAX_ITEMS && processed >= MAX_ITEMS) {
          console.log(`Reached MAX_ITEMS=${MAX_ITEMS}. Stop.`);
          return;
        }

        if (done.has(r.asset_id)) continue;

        const ext = guessExt(r);
        const publicId = String(r.public_id || "").replace(/^\/+/, "");
        const key = safeKey(
          BACKUP_PREFIX,
          t,
          ext ? `${publicId}.${ext}` : publicId,
        );

        try {
          const exists = await r2Exists(key);

          if (!exists) {
            const { buffer, contentType } = await downloadStream(r.secure_url);

            await s3.send(
              new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: key,
                Body: buffer,
                ContentType: contentType || undefined,
              }),
            );
          }
          appendRow({
            ts: new Date().toISOString(),
            cloudinary: {
              asset_id: r.asset_id,
              public_id: r.public_id,
              resource_type: t,
              format: r.format,
              bytes: r.bytes,
              secure_url: r.secure_url,
            },
            r2: { key },
            ok: true,
          });

          done.add(r.asset_id);
          processed += 1;

          if (processed % 100 === 0)
            console.log(`Backed up ${processed} assets...`);
        } catch (e) {
          appendRow({
            ts: new Date().toISOString(),
            cloudinary: {
              asset_id: r.asset_id,
              public_id: r.public_id,
              resource_type: t,
              format: r.format,
              bytes: r.bytes,
              secure_url: r.secure_url,
            },
            r2: { key },
            ok: false,
            error: String(e?.message || e),
          });
          console.error("❌ backup failed:", r.public_id, e?.message || e);
        }
      }

      next_cursor = page.next_cursor || null;
      if (!next_cursor) break;
    }
  }

  console.log(`✅ Full backup done. Total new rows: ${processed}`);
  console.log(`Map file: ${MAP_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
