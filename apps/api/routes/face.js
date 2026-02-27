// apps/api/routes/face.js
import express from "express";
import mongoose from "mongoose";

export default function faceRoutes({ requireAuth }) {
  const router = express.Router();

  /**
   * POST /api/face/enroll
   * Body: { enrolledAssetId? }  (preferred)
   *
   * You can enroll with:
   * - profile.photoAssetId (already uploaded) by sending it
   * - or later extend to accept a fresh upload
   */
  router.post("/face/enroll", requireAuth, async (req, res) => {
    try {
      const uid = req.user.uid;
      const enrolledAssetId = String(req.body?.enrolledAssetId || "").trim();

      if (!enrolledAssetId) {
        return res.status(400).json({
          error: "enrolledAssetId_required",
          message: "Send the assetId of a clear selfie photo.",
        });
      }

      const col = mongoose.connection.db.collection("profiles");
      const now = new Date();

      await col.updateOne(
        { uid },
        {
          $set: {
            uid,
            face: {
              enrolledAssetId,
              enrolledAt: now,
            },
          },
        },
        { upsert: true },
      );

      return res.json({ ok: true, enrolledAssetId, enrolledAt: now });
    } catch (e) {
      console.error("[face/enroll] error:", e?.message || e);
      return res.status(500).json({ error: "enroll_failed" });
    }
  });

  /**
   * GET /api/face/me
   * Small helper to show enrollment + last check
   */
  router.get("/face/me", requireAuth, async (req, res) => {
    try {
      const uid = req.user.uid;
      const col = mongoose.connection.db.collection("profiles");
      const doc = await col.findOne(
        { uid },
        { projection: { face: 1, liveness: 1, livenessVerifiedAt: 1 } },
      );

      return res.json({
        ok: true,
        face: doc?.face || null,
        liveness: doc?.liveness || null,
        livenessVerifiedAt: doc?.livenessVerifiedAt || null,
      });
    } catch (e) {
      return res.status(500).json({ error: "failed" });
    }
  });

  return router;
}
