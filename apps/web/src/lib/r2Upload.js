// apps/web/src/lib/r2Upload.js

/**
 * Reusable MediaAsset uploader (R2 + /api/media/init + /api/media/complete)
 *
 * Returns:
 *  - assetId (string)
 *
 * Notes:
 * - We keep this tiny and dependency-free.
 * - Caller can create its own preview URL (URL.createObjectURL(file)).
 */

function detectMediaType(file, explicitType) {
  if (explicitType === "image" || explicitType === "video") return explicitType;

  const mime = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();

  const isVideo =
    mime.startsWith("video/") || /\.(mp4|mov|webm|mkv|3gp|avi)$/i.test(name);

  return isVideo ? "video" : "image";
}

export async function uploadMediaAsset({
  api,
  file,
  type,
  visibility = "private", // ✅ default safe
}) {
  if (!api) throw new Error("uploadMediaAsset: api is required");
  if (!file) throw new Error("uploadMediaAsset: file is required");

  const finalType = detectMediaType(file, type);

  // 1) init
  const initRes = await api.post("/api/media/init", {
    type: finalType,
    visibility, // ✅ "public" | "private"
    contentType:
      file.type || (finalType === "video" ? "video/mp4" : "image/jpeg"),
    filename: file.name || "",
  });

  const { assetId, uploadUrl, publicUrl, key } = initRes?.data || {};
  if (!assetId || !uploadUrl) throw new Error("Media init failed");

  // 2) direct PUT to R2
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type":
        file.type || (finalType === "video" ? "video/mp4" : "image/jpeg"),
    },
  });

  if (!putRes.ok) {
    const t = await putRes.text().catch(() => "");
    throw new Error(`R2 upload failed: ${t || putRes.status}`);
  }

  // 3) complete (enqueue if video)
  await api.post("/api/media/complete", { assetId });

  return {
    assetId,
    type: finalType,
    publicUrl: publicUrl || "",
    key: key || "",
  };
}

export async function waitForMediaAssetReady({
  api,
  assetId,
  timeoutMs = 180000,
  intervalMs = 2000,
}) {
  if (!api) throw new Error("waitForMediaAssetReady: api is required");
  if (!assetId) throw new Error("waitForMediaAssetReady: assetId is required");

  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const res = await api.get(`/api/media/${assetId}`);
    const status = String(res?.data?.asset?.status || "");

    if (status === "ready") {
      return res?.data?.asset || null;
    }

    if (status === "failed") {
      const errMsg =
        res?.data?.asset?.error?.message || "Video processing failed.";
      throw new Error(errMsg);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error("Video processing timed out.");
}

/**
 * Optional helper:
 * owner-only signed URL (good for immediate preview after upload)
 * GET /api/media/:id/url?variant=original|thumbnail|hls
 */
export async function getSignedMediaUrl({
  api,
  assetId,
  variant = "original",
}) {
  if (!api) throw new Error("getSignedMediaUrl: api is required");
  if (!assetId) throw new Error("getSignedMediaUrl: assetId is required");

  const res = await api.get(`/api/media/${assetId}/url?variant=${variant}`);
  const url = res?.data?.url || "";
  return url;
}
