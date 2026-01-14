// apps/api/routes/risk.js
// ESM router: server-side logging + basic scoring for liveness events.
// Mount with: app.use("/api", riskRoutes({ requireAuth, requireAdmin, Application }))

import express from "express";

/**
 * Very small score function from client metrics.
 * We can swap this for a real PAD provider later.
 */
function scoreFromMetrics(metrics = {}) {
  try {
    const steps = Array.isArray(metrics.steps) ? metrics.steps.length : 0;
    const passed = Array.isArray(metrics.passed) ? metrics.passed.length : 0;

    // base score: how many challenges were completed
    let score = steps ? passed / steps : 0;

    // slight bonus if uploads were via Cloudinary (client indicated)
    if (metrics.cloudinary) score += 0.05;

    // clamp 0..1
    return Math.max(0, Math.min(1, score));
  } catch {
    return 0;
  }
}

// helper to get the collection no matter how mongoose was attached
async function getRiskCollection(req) {
  // try server.js style: app.set("mongoose", mongoose)
  const fromApp =
    req.app.get("mongoose")?.connection?.db?.collection("risk_events") ||
    req.app.locals.mongoose?.connection?.db?.collection("risk_events");

  if (fromApp) return fromApp;

  // fallback: import mongoose directly
  const { default: mongoose } = await import("mongoose");
  return mongoose.connection.db.collection("risk_events");
}

/**
 * Factory so we can receive guards & models from server.js without importing them here.
 */
export default function riskRoutes({ requireAuth, requireAdmin, Application }) {
  const router = express.Router();

  /**
   * POST /api/risk/liveness
   * This is called by your liveness/AWS flow AFTER it has the selfie/video.
   * It just stores it + scores it. This is the one you already had.
   */
  router.post("/risk/liveness", requireAuth, async (req, res) => {
    try {
      const {
        reason = "unspecified",
        context = {},
        selfieUrl = "",
        videoUrl = "",
        metrics = {},
        applicationId = "",
      } = req.body || {};

      // minimal validation (don’t over-block)
      if (!selfieUrl) {
        return res.status(400).json({ error: "selfie_required" });
      }

      const score = scoreFromMetrics(metrics);
      const now = new Date();

      const riskCol = await getRiskCollection(req);

      const doc = {
        type: "liveness",
        uid: req.user.uid,
        email: req.user.email || "",
        reason,
        context,
        selfieUrl,
        videoUrl,
        metrics,
        score,
        ip:
          req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "",
        userAgent: req.headers["user-agent"] || "",
        createdAt: now,
      };

      const ins = await riskCol.insertOne(doc);
      const riskId = ins.insertedId?.toString?.() || "";

      // optionally attach to an Application document for audit
      if (applicationId && Application) {
        try {
          await Application.findByIdAndUpdate(
            applicationId,
            {
              $set: {
                "verification.selfieWithIdUrl": selfieUrl,
                "verification.livenessVideoUrl": videoUrl || "",
                "verification.livenessMetrics": metrics,
                "risk.liveness": { riskId, score, at: now, reason },
              },
            },
            { new: false },
          );
        } catch (e) {
          console.warn("[risk] attach to Application failed:", e?.message || e);
        }
      }

      return res.json({ ok: true, riskId, score });
    } catch (e) {
      console.error("[risk] liveness error:", e?.message || e);
      return res.status(500).json({ error: "risk_failed" });
    }
  });

  /**
   * NEW: GET /api/risk
   * Admin list of recent risk events (what your React page wanted).
   */
  router.get("/risk", requireAuth, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const riskCol = await getRiskCollection(req);
      const items = await riskCol
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return res.json(items);
    } catch (e) {
      console.error("[risk] list error:", e?.message || e);
      return res.status(500).json({ error: "list_failed" });
    }
  });

  /**
   * Existing: GET /api/risk/liveness/:id
   * Keep this for backward compatibility.
   */
  router.get(
    "/risk/liveness/:id",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const { id } = req.params;
        const { default: mongoose } = await import("mongoose");
        const riskCol = await getRiskCollection(req);
        const doc = await riskCol.findOne({
          _id: new mongoose.Types.ObjectId(id),
        });
        if (!doc) return res.status(404).json({ error: "not_found" });
        return res.json(doc);
      } catch (e) {
        console.error("[risk] get liveness error:", e?.message || e);
        return res.status(500).json({ error: "fetch_failed" });
      }
    },
  );

  /**
   * NEW: GET /api/risk/:id
   * same as above but without "liveness" in the path
   */
  router.get("/risk/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { default: mongoose } = await import("mongoose");
      const riskCol = await getRiskCollection(req);
      const doc = await riskCol.findOne({
        _id: new mongoose.Types.ObjectId(id),
      });
      if (!doc) return res.status(404).json({ error: "not_found" });
      return res.json(doc);
    } catch (e) {
      console.error("[risk] get by id error:", e?.message || e);
      return res.status(500).json({ error: "fetch_failed" });
    }
  });

  return router;
}
