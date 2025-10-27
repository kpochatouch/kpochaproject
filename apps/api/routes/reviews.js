// apps/api/routes/reviews.js
import express from "express";
import mongoose from "mongoose";
import Review from "../models/Review.js";
import { Pro } from "../models.js";

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function safeObjectId(id) { try { return new mongoose.Types.ObjectId(id); } catch { return null; } }

export default function reviewsRouter({ requireAuth } = {}) {
  const r = express.Router();
  const mustAuth = requireAuth || ((req, _res, next) => next());

  // CREATE a review (client -> pro)
  r.post("/reviews", mustAuth, async (req, res) => {
    try {
      if (!req.user?.uid) return res.status(401).json({ error: "auth_required" });
      const { proId, rating, title, comment, photos } = req.body || {};
      const _proId = safeObjectId(proId);
      if (!_proId) return res.status(400).json({ error: "bad_pro_id" });

      const pro = await Pro.findById(_proId).select("_id metrics").lean();
      if (!pro) return res.status(404).json({ error: "pro_not_found" });

      const review = await Review.create({
        reviewerUid: req.user.uid,
        reviewerRole: "client",
        proId: _proId,
        rating: clamp(Number(rating), 1, 5),
        title: String(title || "").slice(0, 120),
        comment: String(comment || ""),
        photos: Array.isArray(photos) ? photos : [],
      });

      // Update Pro.metrics (avg + total)
      try {
        const p = await Pro.findById(_proId);
        const total = Number(p?.metrics?.totalReviews || 0);
        const avg = Number(p?.metrics?.avgRating || 0);
        const nextTotal = total + 1;
        const nextAvg = ((avg * total) + review.rating) / nextTotal;

        p.metrics.totalReviews = nextTotal;
        p.metrics.avgRating = Math.round(nextAvg * 10) / 10;
        p.metrics.lastDecisionAt = new Date();
        await p.save();
      } catch (e) {
        console.warn("[reviews] metrics update warn:", e?.message || e);
      }

      res.json({ ok: true, item: review });
    } catch (e) {
      console.error("[reviews:create]", e);
      res.status(500).json({ error: "create_failed" });
    }
  });

  // LIST reviews for a pro
  r.get("/reviews/pro/:proId", async (req, res) => {
    try {
      const _proId = safeObjectId(req.params.proId);
      if (!_proId) return res.status(400).json({ error: "bad_pro_id" });

      const items = await Review.find({ proId: _proId, status: "public" })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();

      res.json(items);
    } catch (e) {
      console.error("[reviews:list]", e);
      res.status(500).json({ error: "list_failed" });
    }
  });

  // GET my review for a pro (unique-per-user flow)
  r.get("/reviews/pro/:proId/me", mustAuth, async (req, res) => {
    try {
      if (!req.user?.uid) return res.status(401).json({ error: "auth_required" });
      const _proId = safeObjectId(req.params.proId);
      if (!_proId) return res.status(400).json({ error: "bad_pro_id" });

      const item = await Review.findOne({
        proId: _proId,
        reviewerUid: req.user.uid,
        status: { $ne: "deleted" },
      }).lean();

      res.json(item || null);
    } catch (e) {
      console.error("[reviews:mine]", e);
      res.status(500).json({ error: "mine_failed" });
    }
  });

  return r;
}
