// apps/api/routes/postStats.js
import express from "express";
import mongoose from "mongoose";
import admin from "../lib/firebaseAdmin.js";
import PostStats from "../models/PostStats.js";

const router = express.Router();

const isObjId = (v) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);

// optional auth – if token is present we decode, else continue as guest
async function tryAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return next();
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null };
  } catch {
    // ignore
  }
  next();
}

/**
 * GET /api/posts/:id/stats
 * return the counters for one post (+ user-specific flags)
 */
router.get("/posts/:id/stats", tryAuth, async (req, res) => {
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
        likedByMe: false,
        savedByMe: false,
      });
    }

    const uid = req.user?.uid || null;
    const likedByMe = uid ? stats.likedBy?.includes(uid) : false;
    const savedByMe = uid ? stats.savedBy?.includes(uid) : false;

    return res.json({
      viewsCount: stats.viewsCount || 0,
      likesCount: stats.likesCount || 0,
      commentsCount: stats.commentsCount || 0,
      sharesCount: stats.sharesCount || 0,
      savesCount: stats.savesCount || 0,
      trendingScore: stats.trendingScore || 0,
      lastEngagedAt: stats.lastEngagedAt || null,
      likedByMe,
      savedByMe,
    });
  } catch (err) {
    console.error("[postStats:get] error:", err);
    return res.status(500).json({ error: "stats_load_failed" });
  }
});

export default router;
