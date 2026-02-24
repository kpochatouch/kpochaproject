// apps/api/routes/media.js
import express from "express";
import MediaAsset from "../models/MediaAsset.js";
import { mediaQueue } from "../queues/mediaQueue.js";
import { getUploadUrl } from "../r2.js";

export default function mediaRoutes({ requireAuth }) {
  const r = express.Router();

  // INIT
  r.post("/media/init", requireAuth, async (req, res) => {
    const { type, contentType } = req.body;

    if (!["video", "image"].includes(type)) {
      return res.status(400).json({ error: "invalid_type" });
    }
    if (!contentType || typeof contentType !== "string") {
      return res.status(400).json({ error: "contentType_required" });
    }

    const asset = await MediaAsset.create({
      ownerUid: req.user.uid,
      type,
      status: "uploading",
    });

    const key = `media/${req.user.uid}/${asset._id}/original.mp4`;

    const uploadUrl = await getUploadUrl(key, contentType);

    asset.original = {
      key,
      contentType,
    };

    await asset.save();

    return res.json({
      assetId: asset._id,
      uploadUrl,
    });
  });

  // COMPLETE
  r.post("/media/complete", requireAuth, async (req, res) => {
    const { assetId } = req.body;

    const asset = await MediaAsset.findById(assetId);
    if (!asset) return res.status(404).json({ error: "not_found" });

    asset.status = "uploaded";
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

    return res.json({ ok: true });
  });

  return r;
}
