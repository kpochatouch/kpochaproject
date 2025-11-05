// apps/api/routes/posts.js
import express from "express";
import mongoose from "mongoose";
import admin from "firebase-admin";
import { Pro } from "../models.js";
import Post from "../models/Post.js";
import PostStats from "../models/PostStats.js";
import redisClient from "../redis.js";

/* --------------------------- Auth middleware --------------------------- */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ------------------------------- Helpers ------------------------------- */
const isObjId = (v) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);
const toUpper = (v) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const trim = (v) => (typeof v === "string" ? v.trim() : v);
const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function sanitizePostForClient(p) {
  const obj = typeof p.toObject === "function" ? p.toObject() : { ...p };
  return {
    _id: obj._id,
    pro: obj.pro,
    proId: obj.proId,
    proOwnerUid: obj.proOwnerUid,
    text: obj.text,
    media: obj.media,
    tags: obj.tags || [],
    lga: obj.lga,
    isPublic: !!obj.isPublic,
    hidden: !!obj.hidden,
    createdAt: obj.createdAt,
    authorName: obj.pro?.name || "Professional",
    authorAvatar: obj.pro?.photoUrl || "",
  };
}

function scoreFrom(stats) {
  const s = stats || {};
  const v = Number(s.viewsCount || 0);
  const l = Number(s.likesCount || 0);
  const c = Number(s.commentsCount || 0);
  const sh = Number(s.sharesCount || 0);
  const sv = Number(s.savesCount || 0);
  return l * 3 + c * 4 + sh * 5 + sv * 2 + v * 0.2;
}

/* ============================== ROUTER ============================== */
const router = express.Router();

/* -------------------------------------------------------------------- */
/* CREATE                                                               */
/* -------------------------------------------------------------------- */
router.post("/posts", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    let { text = "", media = [], lga = "", isPublic = true, tags = [] } = body;

    const proDoc = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!proDoc) return res.status(403).json({ error: "not_a_pro" });

    text = trim(text || "");
    if (!Array.isArray(media)) media = [];
    media = media
      .filter((m) => m && typeof m.url === "string" && m.url.trim())
      .map((m) => ({ url: trim(m.url), type: m.type === "video" ? "video" : "image" }));

    tags = Array.isArray(tags)
      ? tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 10)
      : [];
    const lgaFinal = toUpper(lga || proDoc.lga || "");

    const post = await Post.create({
      proOwnerUid: req.user.uid,
      proId: proDoc._id,
      pro: {
        _id: proDoc._id,
        name: proDoc.name || "Professional",
        lga: proDoc.lga || "",
        photoUrl: proDoc.photoUrl || proDoc.avatarUrl || "",
      },
      text,
      media,
      tags,
      lga: lgaFinal,
      isPublic: !!isPublic,
    });

    await PostStats.findOneAndUpdate(
      { postId: post._id },
      { $setOnInsert: { postId: post._id, trendingScore: 0 } },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, post: sanitizePostForClient(post) });
  } catch (err) {
    console.error("[posts:create] error:", err);
    return res.status(500).json({ error: "post_create_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* PUBLIC FEEDS                                                         */
/* -------------------------------------------------------------------- */
router.get("/feed/public", async (req, res) => {
  try {
    const { lga = "", limit = 20, before = null } = req.query;
    const q = { isPublic: true, hidden: { $ne: true } };
    if (lga) q.lga = toUpper(String(lga));
    if (before) q.createdAt = { $lt: new Date(before) };

    const items = await Post.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit) || 20, 50)))
      .lean();

    return res.json(items.map(sanitizePostForClient));
  } catch (err) {
    console.error("[feed:public] error:", err);
    return res.status(500).json({ error: "feed_load_failed" });
  }
});

router.get("/posts/author/:uid", async (req, res) => {
  try {
    const uid = String(req.params.uid || "");
    if (!uid) return res.status(400).json({ error: "uid_required" });

    const items = await Post.find({ proOwnerUid: uid, hidden: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json(items.map(sanitizePostForClient));
  } catch (err) {
    console.error("[posts:author] error:", err);
    return res.status(500).json({ error: "author_load_failed" });
  }
});

router.get("/posts/me", requireAuth, async (req, res) => {
  try {
    const items = await Post.find({ proOwnerUid: req.user.uid })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json(items.map(sanitizePostForClient));
  } catch (err) {
    console.error("[posts:me] error:", err);
    return res.status(500).json({ error: "posts_load_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* INTERACTIONS                                                         */
/* -------------------------------------------------------------------- */
router.post("/posts/:id/like", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const upd = await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id), likedBy: { $ne: req.user.uid } },
      {
        $addToSet: { likedBy: req.user.uid },
        $inc: { likesCount: 1 },
        $setOnInsert: { postId: new mongoose.Types.ObjectId(id) },
        $push: {
          daily: { day: todayStr(), views: 0, likes: 1, comments: 0, shares: 0, saves: 0 },
        },
      },
      { upsert: true }
    );

    const stats = await PostStats.findOne({ postId: new mongoose.Types.ObjectId(id) }).lean();
    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne({ postId: id }, { $set: { trendingScore } });

    return res.json({
      ok: true,
      changed: upd.modifiedCount > 0 || upd.upsertedCount > 0,
      likesCount: stats?.likesCount || 0,
      trendingScore,
    });
  } catch (err) {
    console.error("[posts:like] error:", err);
    return res.status(500).json({ error: "like_failed" });
  }
});

router.delete("/posts/:id/like", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id), likedBy: req.user.uid },
      { $pull: { likedBy: req.user.uid }, $inc: { likesCount: -1 } }
    );

    const stats = await PostStats.findOne({ postId: new mongoose.Types.ObjectId(id) }).lean();
    const likesCount = Math.max(0, Number(stats?.likesCount || 0));
    const trendingScore = scoreFrom({ ...stats, likesCount });
    await PostStats.updateOne({ postId: id }, { $set: { likesCount, trendingScore } });

    return res.json({ ok: true, likesCount, trendingScore });
  } catch (err) {
    console.error("[posts:unlike] error:", err);
    return res.status(500).json({ error: "unlike_failed" });
  }
});

/**
 * VIEW with Redis de-dup
 */
router.post("/posts/:id/view", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const postObjectId = new mongoose.Types.ObjectId(id);
    const viewerId = req.user?.uid || req.viewIdentity?.anonId || null;

    let shouldIncrement = true;

    if (redisClient && viewerId) {
      const redisKey = `post:view:${id}:${viewerId}`;
      try {
        const setRes = await redisClient.set(redisKey, "1", {
          EX: 3600,
          NX: true,
        });
        if (setRes !== "OK") {
          shouldIncrement = false;
        }
      } catch (e) {
        console.warn("[posts:view] redis set failed:", e?.message || e);
        shouldIncrement = true;
      }
    }

    const update = { $setOnInsert: { postId: postObjectId } };

    if (shouldIncrement) {
      update.$inc = { viewsCount: 1 };
      update.$push = {
        daily: {
          day: todayStr(),
          views: 1,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
        },
      };
    }

    await PostStats.updateOne({ postId: postObjectId }, update, { upsert: true });

    const stats = await PostStats.findOne({ postId: postObjectId }).lean();
    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne({ postId: id }, { $set: { trendingScore } });

    return res.json({
      ok: true,
      deduped: !shouldIncrement,
      viewsCount: stats?.viewsCount || 0,
      trendingScore,
    });
  } catch (err) {
    console.error("[posts:view] error:", err);
    return res.status(500).json({ error: "view_failed" });
  }
});

router.post("/posts/:id/share", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      {
        $inc: { sharesCount: 1 },
        $addToSet: { sharedBy: req.user.uid },
        $setOnInsert: { postId: new mongoose.Types.ObjectId(id) },
        $push: {
          daily: { day: todayStr(), views: 0, likes: 0, comments: 0, shares: 1, saves: 0 },
        },
      },
      { upsert: true }
    );

    const stats = await PostStats.findOne({ postId: new mongoose.Types.ObjectId(id) }).lean();
    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne({ postId: id }, { $set: { trendingScore } });

    return res.json({ ok: true, sharesCount: stats?.sharesCount || 0, trendingScore });
  } catch (err) {
    console.error("[posts:share] error:", err);
    return res.status(500).json({ error: "share_failed" });
  }
});

router.post("/posts/:id/save", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const upd = await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id), savedBy: { $ne: req.user.uid } },
      {
        $addToSet: { savedBy: req.user.uid },
        $inc: { savesCount: 1 },
        $setOnInsert: { postId: new mongoose.Types.ObjectId(id) },
        $push: {
          daily: { day: todayStr(), views: 0, likes: 0, comments: 0, shares: 0, saves: 1 },
        },
      },
      { upsert: true }
    );

    const stats = await PostStats.findOne({ postId: new mongoose.Types.ObjectId(id) }).lean();
    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne({ postId: id }, { $set: { trendingScore } });

    return res.json({
      ok: true,
      changed: upd.modifiedCount > 0 || upd.upsertedCount > 0,
      savesCount: stats?.savesCount || 0,
      trendingScore,
    });
  } catch (err) {
    console.error("[posts:save] error:", err);
    return res.status(500).json({ error: "save_failed" });
  }
});

router.delete("/posts/:id/save", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id), savedBy: req.user.uid },
      { $pull: { savedBy: req.user.uid }, $inc: { savesCount: -1 } }
    );
    const stats = await PostStats.findOne({ postId: new mongoose.Types.ObjectId(id) }).lean();
    const savesCount = Math.max(0, Number(stats?.savesCount || 0));
    const trendingScore = scoreFrom({ ...stats, savesCount });
    await PostStats.updateOne({ postId: id }, { $set: { savesCount, trendingScore } });

    return res.json({ ok: true, savesCount, trendingScore });
  } catch (err) {
    console.error("[posts:unsave] error:", err);
    return res.status(500).json({ error: "unsave_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* TRENDING                                                             */
/* -------------------------------------------------------------------- */
router.get("/posts/trending", async (req, res) => {
  try {
    const { lga = "", limit = 20 } = req.query;
    const lim = Math.max(1, Math.min(Number(limit) || 20, 50));
    const q = { isPublic: true, hidden: { $ne: true } };
    if (lga) q.lga = toUpper(String(lga));

    const topStats = await PostStats.find({})
      .sort({ trendingScore: -1 })
      .limit(lim * 2)
      .lean();

    const ids = topStats.map((s) => s.postId);
    const posts = await Post.find({ _id: { $in: ids }, ...q }).lean();

    const order = new Map(ids.map((id, idx) => [String(id), idx]));
    posts.sort(
      (a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0)
    );

    return res.json(posts.slice(0, lim).map(sanitizePostForClient));
  } catch (err) {
    console.error("[posts:trending] error:", err);
    return res.status(500).json({ error: "trending_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* DELETE                                                               */
/* -------------------------------------------------------------------- */
router.delete("/posts/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (p.proOwnerUid !== req.user.uid) return res.status(403).json({ error: "forbidden" });

    await Post.deleteOne({ _id: p._id });
    await PostStats.deleteOne({ postId: p._id }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("[posts:delete] error:", err);
    return res.status(500).json({ error: "delete_failed" });
  }
});

export default router;
