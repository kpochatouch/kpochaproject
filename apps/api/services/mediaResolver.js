// apps/api/services/mediaResolver.js
import MediaAsset from "../models/MediaAsset.js";

const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || "").replace(
  /\/+$/,
  "",
);

function assetKeyToPublicUrl(key) {
  if (!key) return "";
  if (!R2_PUBLIC_BASE_URL) return "";
  return `${R2_PUBLIC_BASE_URL}/${String(key).replace(/^\/+/, "")}`;
}

/**
 * Resolve ONE asset doc (already loaded) into client-ready urls
 */
export function resolveAssetDocToClient(a) {
  if (!a) return null;

  const isVideo = a.type === "video";
  const originalUrl = assetKeyToPublicUrl(a?.original?.key);

  const hlsUrl = isVideo ? assetKeyToPublicUrl(a?.hls?.masterPlaylistKey) : "";

  const thumbnailUrl = assetKeyToPublicUrl(a?.thumbnail?.key || "");

  return {
    assetId: String(a._id),
    url: isVideo ? hlsUrl || originalUrl : originalUrl,
    hlsUrl,
    type: isVideo ? "video" : "image",
    thumbnailUrl,
    width: Number(a?.original?.width || 0),
    height: Number(a?.original?.height || 0),
    durationSec: Number(a?.original?.durationSec || 0),
    status: a.status || "uploaded",
    error: a.error || null,
  };
}

/**
 * expandMediaForClient(mediaArr)
 * - supports Post.media[] style objects:
 *   { assetId?, thumbnailAssetId?, url?, thumbnailUrl?, type?, width?, height?, durationSec? }
 */
export async function expandMediaForClient(mediaArr) {
  const media = Array.isArray(mediaArr) ? mediaArr : [];

  // Collect both assetId and thumbnailAssetId so thumbnail resolution works
  const ids = media
    .flatMap((m) => [m?.assetId, m?.thumbnailAssetId])
    .filter((x) => typeof x === "string" && x.length === 24);

  if (!ids.length) {
    // legacy passthrough
    return media
      .map((m) => {
        const url = String(m?.url || "").trim();
        if (!url) return null;
        return {
          url,
          type: m?.type === "video" ? "video" : "image",
          thumbnailUrl: String(m?.thumbnailUrl || "").trim(),
          width: Number(m?.width || 0),
          height: Number(m?.height || 0),
          durationSec: Number(m?.durationSec || 0),
          status: "ready",
        };
      })
      .filter(Boolean);
  }

  const assets = await MediaAsset.find({ _id: { $in: ids } }).lean();
  const map = new Map(assets.map((a) => [String(a._id), a]));

  return media
    .map((m) => {
      // Asset-based
      if (m?.assetId && map.has(String(m.assetId))) {
        const a = map.get(String(m.assetId));

        const base = resolveAssetDocToClient(a);
        if (!base) return null;

        // Prefer explicit thumbnail asset if provided
        const thumb =
          (m.thumbnailAssetId && map.get(String(m.thumbnailAssetId))) || null;

        const thumbnailUrl = thumb
          ? assetKeyToPublicUrl(thumb?.original?.key || thumb?.thumbnail?.key)
          : base.thumbnailUrl;

        return { ...base, thumbnailUrl };
      }

      // Legacy fallback (url)
      const url = String(m?.url || "").trim();
      if (!url) return null;

      return {
        url,
        type: m?.type === "video" ? "video" : "image",
        thumbnailUrl: String(m?.thumbnailUrl || "").trim(),
        width: Number(m?.width || 0),
        height: Number(m?.height || 0),
        durationSec: Number(m?.durationSec || 0),
        status: "ready",
      };
    })
    .filter(Boolean);
}
