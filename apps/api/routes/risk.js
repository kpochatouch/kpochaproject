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

    // Base score: how many challenges were completed
    let score = steps ? passed / steps : 0;

    // Slight bonus if uploads were via Cloudinary (client indicated)
    if (metrics.cloudinary) score += 0.05;

    // Clamp 0..1
    return Math.max(0, Math.min(1, score));
  } catch {
    return 0;
  }
}

/**
 * Factory so we can receive guards & models from server.js without importing them here.
 */
export default function riskRoutes({ requireAuth, requireAdmin, Application }) {
  const router = express.Router();

  /**
   * POST /api/risk/liveness
   * Body:
   * {
   *   reason: "payout" | "onboarding" | "suspicious_login" | string,
   *   context: { ...any small JSON... },
   *   selfieUrl: "https://...",
   *   videoUrl: "https://..." | "",
   *   metrics: { steps:[], passed:[], cloudinary:bool, ... },
   *   applicationId?: string // if provided, we attach a summary to that Application
   * }
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

      // Minimal validation (don’t over-block)
      if (!selfieUrl) {
        return res.status(400).json({ error: "selfie_required" });
      }

      const score = scoreFromMetrics(metrics);
      const now = new Date();

      // Store raw event in a lightweight collection (no schema)
      const col = req.app.get("mongoose")?.connection?.db?.collection("risk_events")
        || (req.app.locals.mongoose?.connection?.db?.collection("risk_events"));

      // If server.js doesn’t expose mongoose via app, fallback:
      const db = col
        ? null
        : (await (await import("mongoose")).default).connection?.db;
      const riskCol = col || db.collection("risk_events");

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
        ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
        createdAt: now,
      };

      const ins = await riskCol.insertOne(doc);
      const riskId = ins.insertedId?.toString?.() || "";

      // Optionally attach to an Application document for audit
      if (applicationId && Application) {
        try {
          await Application.findByIdAndUpdate(
            applicationId,
            {
              $set: {
                "verification.selfieWithIdUrl": selfieUrl, // preserves your existing key
                "verification.livenessVideoUrl": videoUrl || "",
                "verification.livenessMetrics": metrics,
                "risk.liveness": { riskId, score, at: now, reason },
              },
            },
            { new: false }
          );
        } catch (e) {
          // Non-fatal — we still return ok
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
   * (Optional) Admin view of a single risk event
   * GET /api/risk/liveness/:id
   */
  router.get("/risk/liveness/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { default: mongoose } = await import("mongoose");
      const riskCol = mongoose.connection.db.collection("risk_events");
      const doc = await riskCol.findOne({ _id: new mongoose.Types.ObjectId(id) });
      if (!doc) return res.status(404).json({ error: "not_found" });
      return res.json(doc);
    } catch (e) {
      return res.status(500).json({ error: "fetch_failed" });
    }
  });

  return router;
}
