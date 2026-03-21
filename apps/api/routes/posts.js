// apps/api/routes/posts.js
import express from "express";
import mongoose from "mongoose";
import admin from "firebase-admin";

import { Pro } from "../models.js";
import Post from "../models/Post.js";
import PostStats from "../models/PostStats.js";

import redisClient from "../redis.js";
import { scoreFrom } from "../services/postScoring.js";
import { expandMediaForClient } from "../services/mediaResolver.js";
import postService from "../services/postService.js";

import Follow from "../models/Follow.js";
import { ClientProfile } from "../models/Profile.js";
import { createNotification } from "../services/notificationService.js";

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

function videoElemMatch() {
  return {
    $elemMatch: {
      type: "video",
      assetId: { $exists: true, $ne: null },
    },
  };
}

// what we send to frontend
async function sanitizePostForClient(p) {
  const obj = typeof p.toObject === "function" ? p.toObject() : { ...p };
  const mediaNorm = await expandMediaForClient(obj.media);

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
      (obj.pro && obj.pro.ownerUid) ||
      null,

    text: obj.text,
    media: mediaNorm,
    tags: obj.tags || [],
    type: obj.type || "post",
    expiresAt: obj.expiresAt || null,
    lga: obj.lga,
    isPublic: !!obj.isPublic,
    hidden: !!obj.hidden,
    commentsDisabled: !!obj.commentsDisabled,
    createdAt: obj.createdAt,

    authorName: obj.pro?.name || "Professional",
    authorAvatar: obj.pro?.photoAssetId
      ? (await expandMediaForClient([{ assetId: obj.pro.photoAssetId }]))[0]
          ?.url || ""
      : "",
  };
}

/* ============================== ROUTER ============================== */
const router = express.Router();

/* -------------------------------------------------------------------- */
/* GET /posts?ownerUid=... (compat for public profile pages) */
/* -------------------------------------------------------------------- */
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

    const out = await Promise.all(items.map(sanitizePostForClient));
    return res.json(out);
  } catch (err) {
    console.error("[posts:get?ownerUid] error:", err);
    return res.status(500).json({ error: "posts_load_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* CREATE */
/* -------------------------------------------------------------------- */
router.post("/posts", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    let { text = "", media = [], lga = "", isPublic = true, tags = [] } = body;

    const proDoc = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!proDoc) return res.status(403).json({ error: "not_a_pro" });

    text = trim(text || "");
    if (!Array.isArray(media)) media = [];

    // 🚫 NO LEGACY URL MEDIA ALLOWED
    if (
      Array.isArray(media) &&
      media.some((m) => m && typeof m.url === "string" && m.url.trim())
    ) {
      return res.status(400).json({
        error: "legacy_urls_not_allowed",
        message:
          "Use assetId/thumbnailAssetId only. Raw media URLs are no longer supported.",
      });
    }

    media = media
      .map((m) => {
        // NEW: asset-based
        if (m && typeof m.assetId === "string" && isObjId(m.assetId)) {
          return {
            assetId: String(m.assetId),
            ...(isObjId(m.thumbnailAssetId)
              ? { thumbnailAssetId: String(m.thumbnailAssetId) }
              : {}),
            type: m.type === "video" ? "video" : "image",
          };
        }
        return null;
      })
      .filter(Boolean);

    const lgaFinal = toUpper(lga || proDoc.lga || "");

    const post = await Post.create({
      ownerUid: req.user.uid,
      proOwnerUid: req.user.uid,
      createdBy: req.user.uid,

      proId: proDoc._id,
      pro: {
        _id: proDoc._id,
        name: proDoc.name || "Professional",
        lga: proDoc.lga || "",
        photoAssetId: proDoc.photoAssetId || null,
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
      { upsert: true, new: true },
    );

    try {
      const followers = await Follow.find({ targetUid: req.user.uid })
        .select("followerUid -_id")
        .lean();

      if (followers.length) {
        const actorProfile = await ClientProfile.findOne({ uid: req.user.uid })
          .select("username")
          .lean()
          .catch(() => null);

        let previewImage = "";

        if (Array.isArray(post?.media) && post.media.length) {
          const resolved = await expandMediaForClient(post.media.slice(0, 1));
          previewImage =
            resolved?.[0]?.thumbnailUrl || resolved?.[0]?.url || "";
        }

        const bodyText = post.text?.trim() || "Shared a new post";

        await Promise.allSettled(
          followers
            .map((f) => String(f.followerUid || "").trim())
            .filter((uid) => uid && uid !== req.user.uid)
            .map((followerUid) =>
              createNotification({
                ownerUid: followerUid,
                actorUid: req.user.uid,
                type: "new_post",
                title: proDoc.name || "New post",
                body: bodyText.slice(0, 120),
                data: {
                  postId: String(post._id),
                  username: actorProfile?.username || "",
                  postThumbnail: previewImage,
                  message: bodyText.slice(0, 120),
                },
                groupKey: `new_post:${req.user.uid}:${String(post._id)}`,
              }),
            ),
        );
      }
    } catch (e) {
      console.warn(
        "[posts:create] new_post notifications failed:",
        e?.message || e,
      );
    }

    return res.json({ ok: true, post: await sanitizePostForClient(post) });
  } catch (err) {
    console.error("[posts:create] error:", err);
    return res.status(500).json({ error: "post_create_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* PUBLIC FEED */
/* -------------------------------------------------------------------- */
// NOTE: path changed from "/feed/public" → "/posts/public"
router.get("/posts/public", async (req, res) => {
  try {
    const { lga = "", limit = 20, before = null } = req.query;

    const q = {
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
      // exclude stories
      $or: [{ type: { $ne: "story" } }, { type: { $exists: false } }],
    };

    if (lga) q.lga = toUpper(String(lga));
    if (before) q.createdAt = { $lt: new Date(before) };

    const items = await Post.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit) || 20, 50)))
      .lean();

    const out = await Promise.all(items.map(sanitizePostForClient));
    return res.json(out);
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

    const out = await Promise.all(items.map(sanitizePostForClient));
    return res.json(out);
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

    const out = await Promise.all(items.map(sanitizePostForClient));
    return res.json(out);
  } catch (err) {
    console.error("[posts:me] error:", err);
    return res.status(500).json({ error: "posts_load_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* FOR YOU START */
/* -------------------------------------------------------------------- */
router.get("/posts/for-you/start", tryAuth, async (req, res) => {
  try {
    const { lga = "" } = req.query;
    const viewerUid = req.user?.uid || null;

    const baseQuery = {
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
      media: videoElemMatch(),
      $or: [{ type: { $ne: "story" } }, { type: { $exists: false } }],
    };

    if (lga) baseQuery.lga = toUpper(String(lga));

    const seenIds = new Set();
    const candidateIds = [];

    function pushCandidateId(pid) {
      const key = String(pid || "").trim();
      if (!isObjId(key)) return;
      if (seenIds.has(key)) return;
      seenIds.add(key);
      candidateIds.push(new mongoose.Types.ObjectId(key));
    }

    // 1) videos this viewer has liked
    if (viewerUid) {
      const likedStats = await PostStats.find({ likedBy: viewerUid })
        .select("postId -_id")
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();

      likedStats.forEach((s) => pushCandidateId(s?.postId));
    }

    // 2) top trending videos
    const topStats = await PostStats.find({})
      .select("postId -_id")
      .sort({ trendingScore: -1 })
      .limit(100)
      .lean();

    topStats.forEach((s) => pushCandidateId(s?.postId));

    let posts = [];

    if (candidateIds.length) {
      posts = await Post.find({
        _id: { $in: candidateIds },
        ...baseQuery,
      }).lean();

      const order = new Map(candidateIds.map((pid, idx) => [String(pid), idx]));

      posts.sort(
        (a, b) =>
          (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
      );
    }

    // 3) fallback – newest video posts
    if (!posts.length) {
      posts = await Post.find(baseQuery)
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
    }

    if (!posts.length) {
      return res.json({ post: null, next: null });
    }

    // sanitize safely so one bad post does not kill the whole endpoint
    const settled = await Promise.allSettled(
      posts.map((p) => sanitizePostForClient(p)),
    );

    const safePosts = settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value)
      .filter(Boolean)
      .filter((p) => {
        const m = Array.isArray(p.media) && p.media.length ? p.media[0] : null;
        if (!m) return false;
        if (m.type !== "video") return false;
        return !!String(m.hlsUrl || m.url || "").trim();
      });

    if (!safePosts.length) {
      return res.json({ post: null, next: null });
    }

    return res.json({
      post: safePosts[0] || null,
      next: safePosts[1] || null,
    });
  } catch (err) {
    console.error("[posts:for-you:start] error:", err);
    return res.status(500).json({ error: "for_you_start_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* TRENDING */
/* -------------------------------------------------------------------- */
router.get("/posts/trending", async (req, res) => {
  try {
    const { lga = "", limit = 20 } = req.query;
    const lim = Math.max(1, Math.min(Number(limit) || 20, 50));

    const q = {
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
      $or: [{ type: { $ne: "story" } }, { type: { $exists: false } }],
    };

    if (lga) q.lga = toUpper(String(lga));

    const topStats = await PostStats.find({})
      .sort({ trendingScore: -1 })
      .limit(lim * 2)
      .lean();

    const ids = topStats.map((s) => s.postId);
    const posts = await Post.find({ _id: { $in: ids }, ...q }).lean();

    const order = new Map(ids.map((id, idx) => [String(id), idx]));
    posts.sort(
      (a, b) =>
        (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
    );

    const out = await Promise.all(
      posts.slice(0, lim).map(sanitizePostForClient),
    );
    return res.json(out);
  } catch (err) {
    console.error("[posts:trending] error:", err);
    return res.status(500).json({ error: "trending_failed" });
  }
});

// READ: single post (public)
router.get("/posts/:id", tryAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id).lean();
    if (!p || p.hidden || p.deleted) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json(await sanitizePostForClient(p));
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
    if (!current) return res.json({ next: null });

    const viewerUid = req.user?.uid || null;

    const excludeRaw = String(req.query.exclude || "");
    const excludeIds = excludeRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-fA-F]{24}$/.test(s))
      .slice(0, 200);

    const excludeObjectIds = excludeIds.map(
      (x) => new mongoose.Types.ObjectId(x),
    );

    const baseFilter = {
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },

      media: videoElemMatch(),
      $or: [{ type: { $ne: "story" } }, { type: { $exists: false } }],

      _id: { $nin: [current._id, ...excludeObjectIds] },
    };

    // 1) Same pro
    const samePro = await Post.find({
      ...baseFilter,
      proOwnerUid: current.proOwnerUid,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // 2) Same LGA
    const sameLga = await Post.find({ ...baseFilter, lga: current.lga })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // 3) Viewer liked
    let likedPosts = [];
    if (viewerUid) {
      const likedStats = await PostStats.find({ likedBy: viewerUid })
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean();

      const likedIds = likedStats.map((s) => s.postId).filter(Boolean);
      if (likedIds.length) {
        likedPosts = await Post.find({
          ...baseFilter,
          _id: { $in: likedIds, $nin: [current._id, ...excludeObjectIds] },
        }).lean();
      }
    }

    // 4) Trending
    const topStats = await PostStats.find({})
      .sort({ trendingScore: -1 })
      .limit(300)
      .lean();
    const trendingIds = topStats.map((s) => s.postId).filter(Boolean);

    let trendingPosts = [];
    if (trendingIds.length) {
      trendingPosts = await Post.find({
        ...baseFilter,
        _id: { $in: trendingIds, $nin: [current._id, ...excludeObjectIds] },
      }).lean();

      const order = new Map(trendingIds.map((pid, idx) => [String(pid), idx]));
      trendingPosts.sort(
        (a, b) =>
          (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
      );
    }

    // 5) Recent global fallback
    const recentGlobal = await Post.find(baseFilter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const queueRaw = [
      ...likedPosts,
      ...samePro,
      ...sameLga,
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

    // "river never dries" fallback
    if (!next) {
      const loopPick = await Post.findOne({
        isPublic: true,
        hidden: { $ne: true },
        deleted: { $ne: true },
        media: videoElemMatch(),
        $or: [{ type: { $ne: "story" } }, { type: { $exists: false } }],
        _id: { $ne: current._id },
      })
        .sort({ createdAt: -1 })
        .lean();

      return res.json({
        next: loopPick ? await sanitizePostForClient(loopPick) : null,
        looped: !!loopPick,
      });
    }

    return res.json({
      next: await sanitizePostForClient(next),
      looped: false,
    });
  } catch (e) {
    console.error("[posts:next] error", e?.message || e);
    return res.json({ next: null, looped: false });
  }
});

/* -------------------------------------------------------------------- */
/* STORIES */
/* -------------------------------------------------------------------- */
router.get("/stories/public", async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const q = {
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
      type: "story",
      $or: [
        { expiresAt: { $gt: now } },
        { expiresAt: null, createdAt: { $gt: cutoff } },
        { expiresAt: { $exists: false }, createdAt: { $gt: cutoff } },
      ],
    };

    const items = await Post.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit) || 50, 200)))
      .lean();

    const out = await Promise.all(items.map(sanitizePostForClient));
    return res.json(out);
  } catch (err) {
    console.error("[stories:public] error:", err);
    return res.status(500).json({ error: "stories_load_failed" });
  }
});

router.get("/stories/me", requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const items = await Post.find({
      proOwnerUid: req.user.uid,
      deleted: { $ne: true },
      type: "story",
      $or: [
        { expiresAt: { $gt: now } },
        { expiresAt: null, createdAt: { $gt: cutoff } },
        { expiresAt: { $exists: false }, createdAt: { $gt: cutoff } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const out = await Promise.all(items.map(sanitizePostForClient));
    return res.json(out);
  } catch (err) {
    console.error("[stories:me] error:", err);
    return res.status(500).json({ error: "stories_load_failed" });
  }
});

router.get("/stories/me/archived", requireAuth, async (req, res) => {
  try {
    const { limit = 200 } = req.query;
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const q = {
      proOwnerUid: req.user.uid,
      deleted: { $ne: true },
      type: "story",
      $or: [
        { expiresAt: { $lte: now } },
        { expiresAt: null, createdAt: { $lte: cutoff } },
        { expiresAt: { $exists: false }, createdAt: { $lte: cutoff } },
      ],
    };

    const items = await Post.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit) || 200, 500)))
      .lean();

    const out = await Promise.all(items.map(sanitizePostForClient));
    return res.json(out);
  } catch (err) {
    console.error("[stories:me:archived] error:", err);
    return res.status(500).json({ error: "stories_archived_load_failed" });
  }
});

router.post("/stories", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    let { text = "", media = [], lga = "", isPublic = true, tags = [] } = body;

    const proDoc = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!proDoc) return res.status(403).json({ error: "not_a_pro" });

    text = trim(text || "");

    // 🚫 NO LEGACY URL MEDIA ALLOWED
    if (
      Array.isArray(media) &&
      media.some((m) => m && typeof m.url === "string" && m.url.trim())
    ) {
      return res.status(400).json({
        error: "legacy_urls_not_allowed",
        message:
          "Use assetId/thumbnailAssetId only. Raw media URLs are no longer supported.",
      });
    }

    media = Array.isArray(media) ? media : [];
    media = media
      .map((m) => {
        // NEW: asset-based (same as posts)
        if (m && typeof m.assetId === "string" && isObjId(m.assetId)) {
          return {
            assetId: String(m.assetId),
            ...(isObjId(m.thumbnailAssetId)
              ? { thumbnailAssetId: String(m.thumbnailAssetId) }
              : {}),
            type: m.type === "video" ? "video" : "image",
          };
        }

        return null;
      })

      .filter(Boolean);

    tags = Array.isArray(tags)
      ? tags
          .map((t) => String(t || "").trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];

    const lgaFinal = toUpper(lga || proDoc.lga || "");

    const story = await Post.create({
      type: "story",
      ownerUid: req.user.uid,
      proOwnerUid: req.user.uid,
      createdBy: req.user.uid,
      proId: proDoc._id,
      pro: {
        _id: proDoc._id,
        name: proDoc.name || "Professional",
        lga: proDoc.lga || "",
        photoAssetId: proDoc.photoAssetId || null,
      },
      text,
      media,
      tags,
      lga: lgaFinal,
      isPublic: !!isPublic,
    });

    return res.json({ ok: true, story: await sanitizePostForClient(story) });
  } catch (err) {
    console.error("[stories:create] error:", err);
    return res.status(500).json({ error: "story_create_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* OWNER / MODERATION ACTIONS */
/* -------------------------------------------------------------------- */
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

    return res.json({ ok: true, post: await sanitizePostForClient(p) });
  } catch (err) {
    console.error("[posts:hide] error:", err);
    return res.status(500).json({ error: "hide_failed" });
  }
});

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

    return res.json({ ok: true, post: await sanitizePostForClient(p) });
  } catch (err) {
    console.error("[posts:unhide] error:", err);
    return res.status(500).json({ error: "unhide_failed" });
  }
});

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

    return res.json({ ok: true, post: await sanitizePostForClient(p) });
  } catch (err) {
    console.error("[posts:comments:disable] error:", err);
    return res.status(500).json({ error: "comments_disable_failed" });
  }
});

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

    return res.json({ ok: true, post: await sanitizePostForClient(p) });
  } catch (err) {
    console.error("[posts:comments:enable] error:", err);
    return res.status(500).json({ error: "comments_enable_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* INTERACTIONS */
/* -------------------------------------------------------------------- */
router.post("/posts/:id/like", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const upd = await PostStats.updateOne(
      {
        postId: new mongoose.Types.ObjectId(id),
        likedBy: { $ne: req.user.uid },
      },
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
      { upsert: true },
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      { $set: { trendingScore } },
    );

    if (upd.modifiedCount > 0 || upd.upsertedCount > 0) {
      try {
        await postService.notifyOnLike({
          postId: id,
          likerUid: req.user.uid,
        });
      } catch (e) {
        console.warn("[posts:like] notifyOnLike failed:", e?.message || e);
      }
    }

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
      { $pull: { likedBy: req.user.uid }, $inc: { likesCount: -1 } },
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const likesCount = Math.max(0, Number(stats?.likesCount || 0));
    const trendingScore = scoreFrom({ ...stats, likesCount });

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      { $set: { likesCount, trendingScore } },
    );

    return res.json({ ok: true, likesCount, trendingScore });
  } catch (err) {
    console.error("[posts:unlike] error:", err);
    return res.status(500).json({ error: "unlike_failed" });
  }
});

/** VIEW with Redis de-dup */
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
        if (setRes !== "OK") shouldIncrement = false;
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

    await PostStats.updateOne({ postId: postObjectId }, update, {
      upsert: true,
    });

    const stats = await PostStats.findOne({ postId: postObjectId }).lean();
    const trendingScore = scoreFrom(stats);

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      { $set: { trendingScore } },
    );

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
      { upsert: true },
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const trendingScore = scoreFrom(stats);

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      { $set: { trendingScore } },
    );

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
      {
        postId: new mongoose.Types.ObjectId(id),
        savedBy: { $ne: req.user.uid },
      },
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
      { upsert: true },
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const trendingScore = scoreFrom(stats);

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      { $set: { trendingScore } },
    );

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
      { $pull: { savedBy: req.user.uid }, $inc: { savesCount: -1 } },
    );

    const stats = await PostStats.findOne({
      postId: new mongoose.Types.ObjectId(id),
    }).lean();
    const savesCount = Math.max(0, Number(stats?.savesCount || 0));
    const trendingScore = scoreFrom({ ...stats, savesCount });

    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(id) },
      { $set: { savesCount, trendingScore } },
    );

    return res.json({ ok: true, savesCount, trendingScore });
  } catch (err) {
    console.error("[posts:unsave] error:", err);
    return res.status(500).json({ error: "unsave_failed" });
  }
});

/* -------------------------------------------------------------------- */
/* DELETE */
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
