// apps/api/routes/posts.js
import express from "express";
import mongoose from "mongoose";
import admin from "firebase-admin";
import { Pro } from "../models.js";
import Post from "../models/Post.js";
import PostStats from "../models/PostStats.js";
import redisClient from "../redis.js";
import { scoreFrom } from "../services/postScoring.js";

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

// optional auth – decode token if present, else continue as guest
async function tryAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (token) {
      const decoded = await admin.auth().verifyIdToken(token);
      req.user = { uid: decoded.uid, email: decoded.email || null };
    }
  } catch {}
  next();
}

/* ------------------------------- Helpers ------------------------------- */
const isObjId = (v) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);
const toUpper = (v) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const trim = (v) => (typeof v === "string" ? v.trim() : v);
const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// what we send to frontend
function sanitizePostForClient(p) {
  const obj = typeof p.toObject === "function" ? p.toObject() : { ...p };
  return {
    _id: obj._id,
    pro: obj.pro,
    proId: obj.proId,
    proOwnerUid: obj.proOwnerUid,
    // canonical ownerUid (preferred by frontend)
    ownerUid:
      obj.ownerUid ||
      obj.proOwnerUid ||
      obj.createdBy ||
      (obj.pro && (obj.pro.ownerUid || obj.pro._id)) ||
      null,
    text: obj.text,
    media: obj.media,
    tags: obj.tags || [],
    lga: obj.lga,
    isPublic: !!obj.isPublic,
    hidden: !!obj.hidden,
    commentsDisabled: !!obj.commentsDisabled, // 👈 important for FeedCard
    createdAt: obj.createdAt,
    authorName: obj.pro?.name || "Professional",
    authorAvatar: obj.pro?.photoUrl || "",
  };
}


/* ============================== ROUTER ============================== */
const router = express.Router();

// GET /posts?ownerUid=...  (compat for public profile pages)
router.get("/posts", async (req, res) => {
  try {
    const { ownerUid = "", limit = 50, before = null } = req.query;
    if (!ownerUid) return res.status(400).json({ error: "ownerUid_required" });

    const q = {
      $and: [
        { hidden: { $ne: true }, deleted: { $ne: true } },
        {
          $or: [
            { proOwnerUid: String(ownerUid) },
            { ownerUid: String(ownerUid) },
            { proUid: String(ownerUid) },
            { createdBy: String(ownerUid) },
          ],
        },
      ],
    };

    if (before) q.$and.push({ createdAt: { $lt: new Date(before) } });

    const items = await Post.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit) || 20, 200)))
      .lean();

    return res.json(items.map(sanitizePostForClient));
  } catch (err) {
    console.error("[posts:get?ownerUid] error:", err);
    return res.status(500).json({ error: "posts_load_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* CREATE                                                               */
/* -------------------------------------------------------------------- */
router.post("/posts", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    let { text = "", media = [], lga = "", isPublic = true, tags = [] } = body;

    // find pro profile for this uid
    const proDoc = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!proDoc) return res.status(403).json({ error: "not_a_pro" });

    text = trim(text || "");
    if (!Array.isArray(media)) media = [];
    media = media
      .filter((m) => m && typeof m.url === "string" && m.url.trim())
      .map((m) => ({
        url: trim(m.url),
        type: m.type === "video" ? "video" : "image",
      }));

    tags = Array.isArray(tags)
      ? tags
          .map((t) => String(t || "").trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];

    const lgaFinal = toUpper(lga || proDoc.lga || "");

    const post = await Post.create({
      // canonical owner UID — used by profile pages & follow logic
      ownerUid: req.user.uid,
      // for backward compatibility / pro-specific fields
      proOwnerUid: req.user.uid,
      createdBy: req.user.uid,
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
      // createdBy is handy for older payload shapes
      createdBy: req.user.uid,
    });

    // make sure stats doc exists
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
/* PUBLIC FEED                                                          */
/* -------------------------------------------------------------------- */
// NOTE: path changed from "/feed/public" → "/posts/public" to match frontend
router.get("/posts/public", async (req, res) => {
  try {
    const { lga = "", limit = 20, before = null } = req.query;
    const q = { isPublic: true, hidden: { $ne: true }, deleted: { $ne: true } };
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

/* posts by pro-owner uid (public-ish) */
router.get("/posts/author/:uid", async (req, res) => {
  try {
    const uid = String(req.params.uid || "");
    if (!uid) return res.status(400).json({ error: "uid_required" });

    const items = await Post.find({
      proOwnerUid: uid,
      hidden: { $ne: true },
      deleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json(items.map(sanitizePostForClient));
  } catch (err) {
    console.error("[posts:author] error:", err);
    return res.status(500).json({ error: "author_load_failed" });
  }
});

/* my posts */
router.get("/posts/me", requireAuth, async (req, res) => {
  try {
    const items = await Post.find({
      proOwnerUid: req.user.uid,
      deleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
  return res.json(items.map(sanitizePostForClient));
  } catch (err) {
    console.error("[posts:me] error:", err);
    return res.status(500).json({ error: "posts_load_failed" });
  }
});

// ── READ: single post (public) ─────────────────────────────────────────
router.get("/posts/:id", tryAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id).lean();
    if (!p || p.hidden || p.deleted) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json(sanitizePostForClient(p));
  } catch (err) {
    console.error("[posts:read] error:", err);
    return res.status(500).json({ error: "post_load_failed" });
  }
});

// NEXT video for For You
router.get("/posts/:id/next", tryAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const current = await Post.findById(id).lean();
    if (!current) return res.json({ next: null, queue: [] });

    const viewerUid = req.user?.uid || null;

    const baseFilter = {
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
      media: { $elemMatch: { type: "video" } },
      _id: { $ne: current._id }, // never return the same post again
    };

    // 1. Same pro (other videos from this stylist)
    const samePro = await Post.find({
      ...baseFilter,
      proOwnerUid: current.proOwnerUid,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // 2. Same LGA (local content)
    const sameLga = await Post.find({
      ...baseFilter,
      lga: current.lga,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // 3. Videos this viewer has liked (from stats)
    let likedPosts = [];
    if (viewerUid) {
      const likedStats = await PostStats.find({
        likedBy: viewerUid,
      })
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();

      const likedIds = likedStats.map((s) => s.postId);
      if (likedIds.length) {
        likedPosts = await Post.find({
          ...baseFilter,
          _id: { $in: likedIds, $ne: current._id },
        }).lean();
      }
    }

    // 4. Global trending (by trendingScore)
    const topStats = await PostStats.find({})
      .sort({ trendingScore: -1 })
      .limit(100)
      .lean();

    const trendingIds = topStats.map((s) => s.postId);
    let trendingPosts = [];
    if (trendingIds.length) {
      trendingPosts = await Post.find({
        ...baseFilter,
        _id: { $in: trendingIds },
      }).lean();

      const order = new Map(trendingIds.map((pid, idx) => [String(pid), idx]));
      trendingPosts.sort(
        (a, b) =>
          (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0)
      );
    }

    // 5. Global recent fallback (in case stats are empty)
    const recentGlobal = await Post.find(baseFilter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Build final queue (dedup by _id, keep order)
    const queueRaw = [
      ...samePro,
      ...sameLga,
      ...likedPosts,
      ...trendingPosts,
      ...recentGlobal,
    ];

    const seen = new Set();
    const queue = [];
    for (const p of queueRaw) {
      const key = String(p._id);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(p);
    }

    const next = queue[0] || null;

    return res.json({
      next: next ? sanitizePostForClient(next) : null,
      queue: queue.map(sanitizePostForClient),
    });
  } catch (e) {
    console.error("[posts:next] error", e?.message || e);
    return res.json({ next: null, queue: [] });
  }
});


/* -------------------------------------------------------------------- */
/* OWNER / MODERATION ACTIONS                                           */
/* -------------------------------------------------------------------- */

// hide post
router.patch("/posts/:id/hide", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (p.proOwnerUid !== req.user.uid)
      return res.status(403).json({ error: "forbidden" });

    p.hidden = true;
    p.hiddenBy = req.user.uid;
    await p.save();

    return res.json({ ok: true, post: sanitizePostForClient(p) });
  } catch (err) {
    console.error("[posts:hide] error:", err);
    return res.status(500).json({ error: "hide_failed" });
  }
});

// unhide post
router.patch("/posts/:id/unhide", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (p.proOwnerUid !== req.user.uid)
      return res.status(403).json({ error: "forbidden" });

    p.hidden = false;
    await p.save();

    return res.json({ ok: true, post: sanitizePostForClient(p) });
  } catch (err) {
    console.error("[posts:unhide] error:", err);
    return res.status(500).json({ error: "unhide_failed" });
  }
});

// disable comments
router.patch("/posts/:id/comments/disable", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (p.proOwnerUid !== req.user.uid)
      return res.status(403).json({ error: "forbidden" });

    p.commentsDisabled = true;
    await p.save();

    return res.json({ ok: true, post: sanitizePostForClient(p) });
  } catch (err) {
    console.error("[posts:comments:disable] error:", err);
    return res.status(500).json({ error: "comments_disable_failed" });
  }
});

// enable comments
router.patch("/posts/:id/comments/enable", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (p.proOwnerUid !== req.user.uid)
      return res.status(403).json({ error: "forbidden" });

    p.commentsDisabled = false;
    await p.save();

    return res.json({ ok: true, post: sanitizePostForClient(p) });
  } catch (err) {
    console.error("[posts:comments:enable] error:", err);
    return res.status(500).json({ error: "comments_enable_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* INTERACTIONS                                                         */
/* -------------------------------------------------------------------- */

// like
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
          daily: {
            day: todayStr(),
            views: 0,
            likes: 1,
            comments: 0,
            shares: 0,
            saves: 0,
          },
        },
      },
      { upsert: true }
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne({ postId: new mongoose.Types.ObjectId(id) }, { $set: { trendingScore } });
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

// unlike
router.delete("/posts/:id/like", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id), likedBy: req.user.uid },
      { $pull: { likedBy: req.user.uid }, $inc: { likesCount: -1 } }
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const likesCount = Math.max(0, Number(stats?.likesCount || 0));
    const trendingScore = scoreFrom({ ...stats, likesCount });
    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      { $set: { likesCount, trendingScore } }
    );

    return res.json({ ok: true, likesCount, trendingScore });
  } catch (err) {
    console.error("[posts:unlike] error:", err);
    return res.status(500).json({ error: "unlike_failed" });
  }
});

/**
 * VIEW with Redis de-dup
 */
router.post("/posts/:id/view", tryAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const postObjectId = new mongoose.Types.ObjectId(id);
    const viewerId = req.user?.uid || req.viewIdentity?.anonId || null;

    let shouldIncrement = true;

    // optional Redis: don't blow up if missing
    if (redisClient && viewerId) {
      const redisKey = `post:view:${id}:${viewerId}`;
      try {
        const setRes = await redisClient.set(redisKey, "1", {
          EX: 10,
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
    await PostStats.updateOne({ postId: new mongoose.Types.ObjectId(id) }, { $set: { trendingScore } });
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

// share
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
          daily: {
            day: todayStr(),
            views: 0,
            likes: 0,
            comments: 0,
            shares: 1,
            saves: 0,
          },
        },
      },
      { upsert: true }
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne({ postId: new mongoose.Types.ObjectId(id) }, { $set: { trendingScore } });

    return res.json({
      ok: true,
      sharesCount: stats?.sharesCount || 0,
      trendingScore,
    });
  } catch (err) {
    console.error("[posts:share] error:", err);
    return res.status(500).json({ error: "share_failed" });
  }
});

// save
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
          daily: {
            day: todayStr(),
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            saves: 1,
          },
        },
      },
      { upsert: true }
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne({ postId: new mongoose.Types.ObjectId(id) }, { $set: { trendingScore } });

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

// unsave
router.delete("/posts/:id/save", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id), savedBy: req.user.uid },
      { $pull: { savedBy: req.user.uid }, $inc: { savesCount: -1 } }
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const savesCount = Math.max(0, Number(stats?.savesCount || 0));
    const trendingScore = scoreFrom({ ...stats, savesCount });
    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      { $set: { savesCount, trendingScore } }
    );

    return res.json({ ok: true, savesCount, trendingScore });
  } catch (err) {
    console.error("[posts:unsave] error:", err);
    return res.status(500).json({ error: "unsave_failed" });
  }
});

// --------------------------------------------------------------------
// FOR YOU START (first video for /for-you without :id)
// --------------------------------------------------------------------
router.get("/posts/for-you/start", tryAuth, async (req, res) => {
  try {
    const { lga = "" } = req.query;
    const viewerUid = req.user?.uid || null;

    const baseQuery = {
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
      media: { $elemMatch: { type: "video" } },
    };
    if (lga) baseQuery.lga = toUpper(String(lga));

    let candidateIds = [];

    // 1. videos this viewer has liked
    if (viewerUid) {
      const likedStats = await PostStats.find({ likedBy: viewerUid })
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();
      candidateIds.push(...likedStats.map((s) => s.postId));
    }

    // 2. top trending videos
    const topStats = await PostStats.find({})
      .sort({ trendingScore: -1 })
      .limit(100)
      .lean();
    candidateIds.push(...topStats.map((s) => s.postId));

    // dedupe candidate IDs
    const seenIds = new Set();
    candidateIds = candidateIds.filter((pid) => {
      const key = String(pid);
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });

    let posts = [];
    if (candidateIds.length) {
      posts = await Post.find({
        _id: { $in: candidateIds },
        ...baseQuery,
      }).lean();

      const order = new Map(
        candidateIds.map((pid, idx) => [String(pid), idx])
      );
      posts.sort(
        (a, b) =>
          (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0)
      );
    }

    // 3. fallback – newest video posts if nothing matched
    if (!posts.length) {
      posts = await Post.find(baseQuery)
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
    }

    if (!posts.length) {
      return res.json({ post: null, next: null });
    }

    const primary = posts[0];
    const next = posts[1] || null;

    return res.json({
      post: sanitizePostForClient(primary),
      next: next ? sanitizePostForClient(next) : null,
    });
  } catch (err) {
    console.error("[posts:for-you:start] error:", err);
    return res.status(500).json({ error: "for_you_start_failed" });
  }
});


/* -------------------------------------------------------------------- */
/* TRENDING                                                             */
/* -------------------------------------------------------------------- */
router.get("/posts/trending", async (req, res) => {
  try {
    const { lga = "", limit = 20 } = req.query;
    const lim = Math.max(1, Math.min(Number(limit) || 20, 50));
    const q = { isPublic: true, hidden: { $ne: true }, deleted: { $ne: true } };
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
    if (p.proOwnerUid !== req.user.uid)
      return res.status(403).json({ error: "forbidden" });

    await Post.deleteOne({ _id: p._id });
    await PostStats.deleteOne({ postId: p._id }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error("[posts:delete] error:", err);
    return res.status(500).json({ error: "delete_failed" });
  }
});

export default router;
