// apps/api/routes/face.js
import express from "express";
import mongoose from "mongoose";
import { runFaceCompareForEnrollment } from "../services/faceGate.js";
import MediaAsset from "../models/MediaAsset.js";

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

      // 1) Read profile to get latest liveness session pointer
      const doc = await col.findOne(
        { uid },
        {
          projection: {
            face: 1,
            liveness: 1,
            livenessRaw: 1,
            livenessVerifiedAt: 1,
          },
        },
      );

      const sessionId = String(
        doc?.liveness?.lastSessionId || doc?.livenessRaw?.sessionId || "",
      ).trim();

      if (!sessionId) {
        return res.status(403).json({
          error: "liveness_required",
          message: "Please complete liveness verification first.",
        });
      }

      // ✅ Facebook-style rule:
      // Enrolled selfie MUST be a PRIVATE image asset owned by this user.
      const enrolled = await MediaAsset.findById(enrolledAssetId)
        .select("_id ownerUid visibility type status")
        .lean()
        .catch(() => null);

      if (!enrolled) {
        return res.status(404).json({
          error: "asset_not_found",
          message: "Selfie asset not found. Please upload again.",
        });
      }

      if (String(enrolled.ownerUid) !== String(uid)) {
        return res.status(403).json({
          error: "asset_forbidden",
          message: "This selfie asset does not belong to you.",
        });
      }

      if (enrolled.visibility !== "private") {
        return res.status(400).json({
          error: "asset_must_be_private",
          message: "Selfie must be uploaded as PRIVATE for face verification.",
        });
      }

      if (enrolled.type !== "image") {
        return res.status(400).json({
          error: "asset_must_be_image",
          message: "Selfie must be an IMAGE asset.",
        });
      }

      if (enrolled.status !== "ready") {
        return res.status(409).json({
          error: "asset_not_ready",
          message:
            "Selfie is still processing. Please wait a moment and retry.",
        });
      }

      // 2) Compare: liveness reference image vs enrolled selfie asset
      const cmp = await runFaceCompareForEnrollment({
        sessionId,
        enrolledAssetId,
      });

      if (!cmp?.ok) {
        return res.status(403).json({
          error: "face_mismatch",
          message: "Face verification failed. Please retry in good lighting.",
          similarity: cmp?.similarity ?? 0,
        });
      }

      // 3) Only after compare passes, persist enrollment
      await col.updateOne(
        { uid },
        {
          $set: {
            uid,
            "face.enrolledAssetId": enrolledAssetId,
            "face.enrolledAt": now,

            // store “fresh verification” at enrollment time too
            "face.lastVerifiedAt": now,
            "face.lastCheckedAt": now,
            "face.lastSimilarity": cmp?.similarity ?? 0,
            "face.lastSessionId": sessionId,
            "face.lastReason": "enrollment",
            "face.lastStatus": "match",
          },
        },
        { upsert: true },
      );

      return res.json({
        ok: true,
        enrolledAssetId,
        enrolledAt: now,
        sessionId,
        similarity: cmp?.similarity ?? 0,
      });
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
