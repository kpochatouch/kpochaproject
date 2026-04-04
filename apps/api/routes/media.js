// apps/api/routes/media.js
import express from "express";
import MediaAsset from "../models/MediaAsset.js";
import { mediaQueue } from "../queues/mediaQueue.js";
import { getUploadUrl, getDownloadUrl, keyToPublicUrl } from "../r2.js";

export default function mediaRoutes({ requireAuth }) {
  const r = express.Router();

  // INIT
  r.post("/media/init", requireAuth, async (req, res) => {
    const {
      type,
      contentType,
      filename,
      visibility,
      trimStartSec = 0,
      trimEndSec = 0,
    } = req.body;

    if (!["video", "image"].includes(type)) {
      return res.status(400).json({ error: "invalid_type" });
    }
    if (!contentType || typeof contentType !== "string") {
      return res.status(400).json({ error: "contentType_required" });
    }

    // ✅ Visibility gate (default private)
    const vis = visibility === "public" ? "public" : "private";

    // file extension (best-effort)
    const safeName = String(filename || "").toLowerCase();
    const extFromName = safeName.includes(".") ? safeName.split(".").pop() : "";
    const extFromType =
      type === "image"
        ? contentType.includes("png")
          ? "png"
          : contentType.includes("webp")
          ? "webp"
          : "jpg"
        : contentType.includes("webm")
        ? "webm"
        : contentType.includes("quicktime")
        ? "mov"
        : "mp4";

    const ext = (
      extFromName ||
      extFromType ||
      (type === "image" ? "jpg" : "mp4")
    ).replace(/[^a-z0-9]/g, "");

    const trimStart = Number(trimStartSec || 0);
    const trimEnd = Number(trimEndSec || 0);
    const hasTrim = trimEnd > trimStart;

    const asset = await MediaAsset.create({
      ownerUid: req.user.uid,
      type,
      status: "uploading",
      visibility: vis,
      trim: {
        startSec: hasTrim ? trimStart : 0,
        endSec: hasTrim ? trimEnd : 0,
        required: hasTrim,
        applied: false,
      },
    });

    const key = `media/${req.user.uid}/${asset._id}/original.${ext}`;
    const uploadUrl = await getUploadUrl(key, contentType);

    asset.original = { key, contentType };
    await asset.save();

    return res.json({
      ok: true,
      assetId: asset._id,
      key,
      // ✅ Only return a CDN-style url if the asset is public.
      // For private, the client must use /api/media/:id/url
      publicUrl: vis === "public" ? keyToPublicUrl(key) : "",
      type,
      contentType,
      status: asset.status,
      visibility: vis,
      uploadUrl,
    });
  });

  // COMPLETE
  r.post("/media/complete", requireAuth, async (req, res) => {
    const { assetId } = req.body;

    const asset = await MediaAsset.findById(assetId);
    if (!asset) return res.status(404).json({ error: "not_found" });

    // only owner can complete
    if (String(asset.ownerUid) !== String(req.user.uid)) {
      return res.status(403).json({ error: "forbidden" });
    }

    asset.status = "uploaded";
    await asset.save();

    // Only videos get queued for transcoding
    if (asset.type === "video") {
      await mediaQueue.add(
        "process",
        { assetId: asset._id.toString() },
        {
          attempts: 5,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    } else {
      // images become ready immediately (no worker needed)
      asset.status = "ready";
      await asset.save();
    }

    return res.json({
      ok: true,
      assetId: asset._id,
      status: asset.status,
    });
  });

  // STATUS
  r.get("/media/:id", requireAuth, async (req, res) => {
    const asset = await MediaAsset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: "not_found" });

    if (String(asset.ownerUid) !== String(req.user.uid)) {
      return res.status(403).json({ error: "forbidden" });
    }

    return res.json({
      ok: true,
      asset: {
        id: asset._id,
        type: asset.type,
        status: asset.status,
        visibility: asset.visibility || "private",
        original: asset.original || null,
        hls: asset.hls || null,
        renditions: asset.renditions || [],
        thumbnail: asset.thumbnail || null,
        error: asset.error || null,
      },
    });
  });

  // DELIVERY URL (signed GET)
  // GET /api/media/:id/url?variant=original|thumbnail|hls
  r.get("/media/:id/url", requireAuth, async (req, res) => {
    const asset = await MediaAsset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: "not_found" });

    // ✅ Private assets: owner-only signed URL
    // ✅ Public assets: still allow signed URL for owner (fine), but ALSO return CDN url elsewhere via resolvers.
    if (asset.visibility !== "public") {
      if (String(asset.ownerUid) !== String(req.user.uid)) {
        return res.status(403).json({ error: "forbidden" });
      }
    }

    const variant = String(req.query.variant || "original");

    let key = "";
    if (variant === "original") key = asset.original?.key || "";
    else if (variant === "thumbnail") key = asset.thumbnail?.key || "";
    else if (variant === "hls") key = asset.hls?.masterPlaylistKey || "";
    else return res.status(400).json({ error: "invalid_variant" });

    if (!key) return res.status(409).json({ error: "not_ready" });

    const url = await getDownloadUrl(key, { expiresIn: 300 });

    return res.json({ ok: true, id: asset._id, variant, key, url });
  });

  // RETRY processing (video only)
  r.post("/media/:id/retry", requireAuth, async (req, res) => {
    const asset = await MediaAsset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: "not_found" });

    if (String(asset.ownerUid) !== String(req.user.uid)) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (asset.type !== "video") {
      return res.status(400).json({ error: "not_video" });
    }

    asset.status = "uploaded";
    asset.error = null;
    await asset.save();

    await mediaQueue.add(
      "process",
      { assetId: asset._id.toString() },
      {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return res.json({ ok: true, assetId: asset._id, status: asset.status });
  });

  return r;
}
