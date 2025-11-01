// apps/api/routes/awsLiveness.js
import express from "express";
import {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} from "@aws-sdk/client-rekognition";

// This matches how server.js calls it: awsLivenessRoutes({ requireAuth })
export default function awsLivenessRoutes({ requireAuth }) {
  const router = express.Router();

  const REGION = process.env.AWS_REGION || "us-east-1";

  // Backend Rekognition client uses the server env:
  // AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
  const rek = new RekognitionClient({
    region: REGION,
    // creds are auto-read from env in Node, so no extra code here
  });

  // POST /api/aws-liveness/session
  // called by the frontend to create a session
  router.post("/aws-liveness/session", requireAuth, async (req, res) => {
    try {
      const cmd = new CreateFaceLivenessSessionCommand({});
      const out = await rek.send(cmd);

      return res.json({
        ok: true,
        sessionId: out.SessionId,
        selfieUrl: "", // frontend will provide real image later
      });
    } catch (err) {
      console.error("[aws-liveness] create session error:", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Failed to create liveness session",
      });
    }
  });

  // OPTIONAL: GET /api/aws-liveness/result/:id
  // you can call this from admin to check result
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
