// apps/api/routes/awsLiveness.js
// Minimal AWS Rekognition Face Liveness bridge
// Mount in server.js like you already did:
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

  const region = process.env.AWS_REGION || "us-east-1";

  // build client once
  const client = new RekognitionClient({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });

  // quick ping so you can test from browser
  router.get("/aws/liveness/ping", (req, res) => {
    return res.json({
      ok: true,
      region,
      hasKey: !!process.env.AWS_ACCESS_KEY_ID,
    });
  });

  /**
   * 1. CREATE SESSION
   * POST /api/aws/liveness/session
   */
  router.post("/aws/liveness/session", requireAuth, async (req, res) => {
    try {
      const reason = req.body?.reason || "onboarding";

      const cmd = new CreateFaceLivenessSessionCommand({
        ClientRequestToken: `kpocha-${req.user.uid}-${Date.now()}`,
      });

      const out = await client.send(cmd);

      return res.json({
        ok: true,
        sessionId: out.SessionId,
        region,
        reason,
      });
    } catch (err) {
      // 👇 make the error super obvious
      console.error("[aws-liveness] create failed:", {
        name: err.name,
        message: err.message,
        $metadata: err.$metadata,
      });

      return res.status(500).json({
        ok: false,
        where: "create",
        name: err.name,
        message: err.message,
        // this helps you see if it was AccessDenied, UnrecognizedClient, SignatureDoesNotMatch...
        details: err.$metadata || null,
      });
    }
  });

  /**
   * 2. GET RESULTS
   * GET /api/aws/liveness/session/:id
   */
  router.get("/aws/liveness/session/:id", requireAuth, async (req, res) => {
    try {
      const sessionId = req.params.id;
      const cmd = new GetFaceLivenessSessionResultsCommand({
        SessionId: sessionId,
      });
      const out = await client.send(cmd);

      return res.json({
        ok: true,
        sessionId,
        aws: out,
      });
    } catch (err) {
      console.error("[aws-liveness] get result failed:", {
        name: err.name,
        message: err.message,
        $metadata: err.$metadata,
      });
      return res.status(500).json({
        ok: false,
        where: "get-result",
        name: err.name,
        message: err.message,
        details: err.$metadata || null,
      });
    }
  });

  return router;
}
