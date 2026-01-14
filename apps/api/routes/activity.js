// apps/api/routes/activity.js
import express from "express";
import admin from "firebase-admin";

import Post from "../models/Post.js";
import Comment from "../models/Comment.js";
import Follow from "../models/Follow.js";
import { Booking } from "../models/Booking.js";
import Notification from "../models/Notification.js";
import { computeProfileStats } from "../services/profileStatsService.js";

const router = express.Router();

/* --------------------------- Auth (optional) --------------------------- */
// optional auth – decode token if present, else continue as guest
async function tryAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (token) {
      const decoded = await admin.auth().verifyIdToken(token);
      req.user = { uid: decoded.uid, email: decoded.email || null };
    }
  } catch {
    // ignore auth errors – this endpoint is public-ish
  }
  next();
}

/**
 * GET /api/activity/:uid
 * Returns mixed recent activity for a profile:
 * - recent posts (public)
 * - recent comments (on their posts)
 * - recent follows (new followers)
 * - recent bookings (for that proOwnerUid)
 * - recent notifications (for that uid)
 *
 * NOTE: This is intentionally light and approximate – small pages from each
 * source, merged and sorted by createdAt desc.
 */
router.get("/activity/:uid", tryAuth, async (req, res) => {
  try {
    const uid = String(req.params.uid || "");
    if (!uid) return res.status(400).json({ error: "uid_required" });

    const limit = Math.max(5, Math.min(50, Number(req.query.limit || 20)));

    // 1) Load recent posts for this pro
    const posts = await Post.find({
      proOwnerUid: uid,
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .catch(() => []);

    const postIds = posts.map((p) => p._id);

    // 2) Parallel fetch of other activity sources
    const [comments, follows, bookings, notifications] = await Promise.all([
      // comments on this pro's posts
      postIds.length
        ? Comment.find({ postId: { $in: postIds } })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()
            .catch(() => [])
        : Promise.resolve([]),

      // followers of this uid
      Follow.find({ targetUid: uid })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .catch(() => []),

      // bookings for this proOwnerUid
      Booking.find({ proOwnerUid: uid })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .catch(() => []),

      // notifications for this uid
      Notification.find({ ownerUid: uid })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .catch(() => []),
    ]);

    const normalized = [];

    posts.forEach((p) =>
      normalized.push({
        kind: "post",
        createdAt: p.createdAt,
        payload: {
          id: p._id,
          text: p.text,
          media: p.media,
          proOwnerUid: p.proOwnerUid,
        },
      }),
    );

    comments.forEach((c) =>
      normalized.push({
        kind: "comment",
        createdAt: c.createdAt,
        payload: c,
      }),
    );

    follows.forEach((f) =>
      normalized.push({
        kind: "follow",
        createdAt: f.createdAt,
        payload: f,
      }),
    );

    bookings.forEach((b) =>
      normalized.push({
        kind: "booking",
        createdAt: b.createdAt,
        payload: b,
      }),
    );

    notifications.forEach((n) =>
      normalized.push({
        kind: "notification",
        createdAt: n.createdAt,
        payload: n,
      }),
    );

    normalized.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({ items: normalized.slice(0, limit) });
  } catch (e) {
    console.error("[activity] error", e?.message || e);
    return res.status(500).json({ error: "activity_failed" });
  }
});

// GET /api/activity/profile-stats/:uid
// Returns canonical stats for a profile using ownerUid
router.get("/activity/profile-stats/:uid", tryAuth, async (req, res) => {
  try {
    const ownerUid = String(req.params.uid || "").trim();
    if (!ownerUid) {
      return res.status(400).json({ error: "uid_required" });
    }

    const stats = await computeProfileStats(ownerUid);

    return res.json({
      ownerUid,
      followers: stats.followers,
      postsCount: stats.postsCount,
      jobsCompleted: stats.jobsCompleted,
      avgRating: stats.avgRating,
    });
  } catch (e) {
    console.error("[activity/profile-stats] error", e?.message || e);
    return res.status(500).json({ error: "stats_failed" });
  }
});

export default router;
