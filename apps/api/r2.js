//apps/api/r2.js
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

export const R2_PUBLIC_BASE_URL = (
  process.env.R2_PUBLIC_BASE_URL || ""
).replace(/\/+$/, "");

export function keyToPublicUrl(key) {
  if (!key) return "";
  if (!R2_PUBLIC_BASE_URL) return "";
  return `${R2_PUBLIC_BASE_URL}/${String(key).replace(/^\/+/, "")}`;
}

export async function getUploadUrl(key, contentType) {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  return await getSignedUrl(s3, command, { expiresIn: 900 });
}

// ✅ NEW: signed GET (delivery)
export async function getDownloadUrl(key, opts = {}) {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    // optional: force download/inline behavior
    ...(opts.responseContentType
      ? { ResponseContentType: opts.responseContentType }
      : {}),
    ...(opts.responseContentDisposition
      ? { ResponseContentDisposition: opts.responseContentDisposition }
      : {}),
  });

  // short-lived is good security; bump if you want
  const expiresIn = Number(opts.expiresIn || 300);
  return await getSignedUrl(s3, command, { expiresIn });
}

export { s3 };
