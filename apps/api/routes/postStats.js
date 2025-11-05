// apps/api/routes/postStats.js
import express from "express";
import mongoose from "mongoose";
import PostStats from "../models/PostStats.js";

const router = express.Router();

const isObjId = (v) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);

/**
 * GET /api/posts/:id/stats
 * return the counters for one post
 */
router.get("/posts/:id/stats", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();

    if (!stats) {
      return res.json({
        viewsCount: 0,
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        savesCount: 0,
        trendingScore: 0,
      });
    }

    return res.json({
      viewsCount: stats.viewsCount || 0,
      likesCount: stats.likesCount || 0,
      commentsCount: stats.commentsCount || 0,
      sharesCount: stats.sharesCount || 0,
      savesCount: stats.savesCount || 0,
      trendingScore: stats.trendingScore || 0,
      lastEngagedAt: stats.lastEngagedAt || null,
    });
  } catch (err) {
    console.error("[postStats:get] error:", err);
    return res.status(500).json({ error: "stats_load_failed" });
  }
});

export default router;
