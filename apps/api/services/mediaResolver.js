// apps/api/services/mediaResolver.js
import MediaAsset from "../models/MediaAsset.js";
import { keyToPublicUrl } from "../r2.js";

/**
 * Resolve ONE asset doc (already loaded) into client-ready urls
 */
export function resolveAssetDocToClient(a) {
  if (!a) return null;

  const isVideo = a.type === "video";
  // If visibility is missing (older docs), treat it as public so URLs resolve.
  const vis = a.visibility || "public";
  const isPublic = vis === "public";

  // ✅ Never leak CDN URLs for private assets
  const originalUrl = isPublic ? keyToPublicUrl(a?.original?.key) : "";
  const hlsUrl = isPublic
    ? isVideo
      ? keyToPublicUrl(a?.hls?.masterPlaylistKey)
      : ""
    : "";
  const thumbnailUrl = isPublic ? keyToPublicUrl(a?.thumbnail?.key || "") : "";

  return {
    assetId: String(a._id),
    visibility: vis,
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
  const toIdString = (v) => {
    if (!v) return "";
    // Handles ObjectId objects from Mongoose lean() as well as strings
    if (typeof v === "string") return v;
    if (typeof v === "object" && typeof v.toString === "function")
      return v.toString();
    return "";
  };

  const ids = media
    .flatMap((m) => [toIdString(m?.assetId), toIdString(m?.thumbnailAssetId)])
    .filter((x) => typeof x === "string" && /^[0-9a-fA-F]{24}$/.test(x));

  const assets = await MediaAsset.find({ _id: { $in: ids } }).lean();
  const map = new Map(assets.map((a) => [String(a._id), a]));

  return media.map((m) => {
    const assetIdStr = toIdString(m?.assetId);
    const thumbIdStr = toIdString(m?.thumbnailAssetId);

    if (assetIdStr && map.has(assetIdStr)) {
      const a = map.get(assetIdStr);
      const base = resolveAssetDocToClient(a);

      if (!base) {
        const legacyUrl =
          typeof m?.url === "string" && m.url.trim() ? m.url.trim() : "";
        const legacyThumb =
          typeof m?.thumbnailUrl === "string" && m.thumbnailUrl.trim()
            ? m.thumbnailUrl.trim()
            : "";

        return {
          assetId: assetIdStr,
          visibility: "public",
          url: legacyUrl,
          hlsUrl: "",
          type: m?.type || "image",
          thumbnailUrl: legacyThumb,
          width: Number(m?.width || 0),
          height: Number(m?.height || 0),
          durationSec: Number(m?.durationSec || 0),
          status: legacyUrl ? "legacy" : "missing",
          error: null,
        };
      }

      const thumb = (thumbIdStr && map.get(thumbIdStr)) || null;

      const thumbnailUrl = thumb
        ? thumb.visibility === "public"
          ? keyToPublicUrl(thumb?.original?.key || thumb?.thumbnail?.key)
          : ""
        : base.thumbnailUrl;

      return { ...base, thumbnailUrl };
    }

    const legacyUrl =
      typeof m?.url === "string" && m.url.trim() ? m.url.trim() : "";
    const legacyThumb =
      typeof m?.thumbnailUrl === "string" && m.thumbnailUrl.trim()
        ? m.thumbnailUrl.trim()
        : "";

    return {
      assetId: assetIdStr || "",
      visibility: "public",
      url: legacyUrl,
      hlsUrl: "",
      type: m?.type || "image",
      thumbnailUrl: legacyThumb,
      width: Number(m?.width || 0),
      height: Number(m?.height || 0),
      durationSec: Number(m?.durationSec || 0),
      status: legacyUrl ? "legacy" : "missing",
      error: null,
    };
  });
}
