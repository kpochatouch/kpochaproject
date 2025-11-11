// apps/api/routes/awsLiveness.js
import express from "express";
import mongoose from "mongoose";
import {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} from "@aws-sdk/client-rekognition";

// This matches how server.js calls it: awsLivenessRoutes({ requireAuth })
export default function awsLivenessRoutes({ requireAuth }) {
  const router = express.Router();

  const REGION = process.env.AWS_REGION || "us-east-1";
  const rek = new RekognitionClient({ region: REGION });

  // 1) Create a liveness session (frontend uses this to start AWS flow)
  router.post("/aws-liveness/session", requireAuth, async (req, res) => {
    try {
      const cmd = new CreateFaceLivenessSessionCommand({});
      const out = await rek.send(cmd);

      return res.json({
        ok: true,
        sessionId: out.SessionId,
      });
    } catch (err) {
      console.error("[aws-liveness] create session error:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Failed to create liveness session",
      });
    }
  });

  // 2) Called AFTER the webview finishes: we verify with AWS and STORE the fact
  //    that this user passed, so we can require it before sensitive edits.
  router.post("/aws-liveness/verify", requireAuth, async (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: "missing_session" });
    }

    try {
      const out = await rek.send(
        new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId })
      );

      // AWS will tell us if it’s a success
      const status = out?.Status || out?.status;
      if (status !== "SUCCEEDED") {
        return res.status(400).json({ error: "liveness_failed", detail: status });
      }

      // ✅ store it on the profile so other routes can trust it
      const uid = req.user.uid;
      const col = mongoose.connection.db.collection("profiles");
      const now = new Date();
      await col.updateOne(
        { uid },
        {
          $set: {
            uid,
            livenessVerifiedAt: now,
            // you can also store the raw AWS result if you want:
            livenessRaw: {
              sessionId,
              auditImage: out.AuditImages || [],
            },
          },
        },
        { upsert: true }
      );

      return res.json({ ok: true, at: now });
    } catch (err) {
      console.error("[aws-liveness] verify error:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Failed to verify liveness",
      });
    }
  });

  // 3) Tiny helper so frontend can ask “am I verified recently?”
  router.get("/aws-liveness/me", requireAuth, async (req, res) => {
    try {
      const uid = req.user.uid;
      const col = mongoose.connection.db.collection("profiles");
      const doc = await col.findOne(
        { uid },
        { projection: { livenessVerifiedAt: 1 } }
      );
      return res.json({
        ok: true,
        livenessVerifiedAt: doc?.livenessVerifiedAt || null,
      });
    } catch (err) {
      console.error("[aws-liveness] me error:", err);
      return res.status(500).json({ ok: false, error: "failed" });
    }
  });

  // OPTIONAL: admin/debug to fetch raw result from AWS again
  router.get("/aws-liveness/result/:id", requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
      const out = await rek.send(
        new GetFaceLivenessSessionResultsCommand({
          SessionId: id,
        })
      );
      return res.json({ ok: true, result: out });
    } catch (err) {
      console.error("[aws-liveness] get result error:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Failed to fetch liveness result",
      });
    }
  });

  return router;
}
