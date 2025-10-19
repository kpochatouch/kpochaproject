// apps/api/routes/adminPros.js
import express from "express";
import mongoose from "mongoose";

export default function adminProsRoutes({ requireAuth, requireAdmin, Application }) {
  const r = express.Router();

  // POST /api/pros/decline/:id  { reason }
  r.post("/pros/decline/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id;
      const { reason = "" } = req.body || {};
      if (!reason.trim()) return res.status(400).json({ error: "reason_required" });

      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: "Database not connected" });
      }

      // Accept either clientId (string like timestamp) or Mongo _id
      let doc = await Application.findOne({ clientId: rawId });
      if (!doc && /^[0-9a-fA-F]{24}$/.test(rawId)) {
        doc = await Application.findById(rawId);
      }
      if (!doc) return res.status(404).json({ error: "application_not_found" });

      doc.status = "rejected";
      doc.declineReason = reason.trim();
      await doc.save();

      return res.json({ ok: true });
    } catch (err) {
      console.error("[admin:decline] error:", err);
      res.status(500).json({ error: "decline_failed" });
    }
  });

  return r;
}
