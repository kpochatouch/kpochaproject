//apps/api/routes/faceGateTest.js
import express from "express";
import { requireFaceGate } from "../services/faceGate.js";

export default function faceGateTestRoutes({ requireAuth, requireAdmin }) {
  const router = express.Router();

  // GET /api/face/gate-test
  router.get("/face/gate-test", requireAuth, requireAdmin, async (req, res) => {
    let passed = false;

    await new Promise((resolve) => {
      requireFaceGate(
        req,
        res,
        () => {
          passed = true;
          resolve();
        },
        { reason: "manual_test", force: true }, // force compare now
      );
    });

    if (!passed) return; // middleware already responded
    return res.json({ ok: true, message: "FaceGate passed" });
  });

  return router;
}
