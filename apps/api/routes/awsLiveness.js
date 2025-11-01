// apps/api/routes/awsLiveness.js
// Minimal AWS Rekognition Face Liveness bridge
// Mount in server.js like:
//   import awsLivenessRoutes from "./routes/awsLiveness.js";
//   app.use("/api", awsLivenessRoutes({ requireAuth }));

import express from "express";
import {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} from "@aws-sdk/client-rekognition";

export default function awsLivenessRoutes({ requireAuth }) {
  const router = express.Router();

  // build client once
  const client = new RekognitionClient({
    region: process.env.AWS_REGION || "us-east-1",
    // if you run on Render with IAM-style envs, this is enough
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });

  /**
   * 1. CREATE SESSION
   * POST /api/aws/liveness/session
   * body: { reason?: string }
   * returns: { ok: true, sessionId }
   */
  router.post("/aws/liveness/session", requireAuth, async (req, res) => {
    try {
      const reason = req.body?.reason || "onboarding";

      const cmd = new CreateFaceLivenessSessionCommand({
        // AWS needs a client token; we just make one
        ClientRequestToken: `kpocha-${req.user.uid}-${Date.now()}`,
        // You can also add: KmsKeyId, Settings, etc.
      });

      const out = await client.send(cmd);

      return res.json({
        ok: true,
        sessionId: out.SessionId,
        reason,
      });
    } catch (err) {
      console.error("[aws-liveness] create failed:", err);
      return res.status(500).json({
        ok: false,
        error: err.name || "CreateFailed",
        message: err.message,
      });
    }
  });

  /**
   * 2. GET RESULTS
   * GET /api/aws/liveness/session/:id
   * returns AWS raw result so frontend can decide
   */
  router.get("/aws/liveness/session/:id", requireAuth, async (req, res) => {
    try {
      const sessionId = req.params.id;
      const cmd = new GetFaceLivenessSessionResultsCommand({
        SessionId: sessionId,
      });
      const out = await client.send(cmd);

      // out.Status: "SUCCEEDED" | "IN_PROGRESS" | "FAILED"
      // out.Confidence: number (0..100)
      // out.DetectionResponse?

      return res.json({
        ok: true,
        sessionId,
        aws: out,
      });
    } catch (err) {
      console.error("[aws-liveness] get result failed:", err);
      return res.status(500).json({
        ok: false,
        error: err.name || "GetFailed",
        message: err.message,
      });
    }
  });

  return router;
}
