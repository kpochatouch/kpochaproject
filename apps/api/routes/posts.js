// apps/api/routes/posts.js
import express from "express";
import mongoose from "mongoose";
import admin from "firebase-admin";
import { Pro } from "../models.js";

/* --------------------------- Admin helpers --------------------------- */
const ADMIN_UIDS = (process.env.ADMIN_UIDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAdmin(uid) {
  return !!uid && ADMIN_UIDS.includes(uid);
}

/* --------------------------- Auth middleware --------------------------- */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      role: isAdmin(decoded.uid) ? "admin" : "user",
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.uid || !isAdmin(req.user.uid)) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

/* ------------------------------ Model ------------------------------ */
const MediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], default: "image" },
  },
  { _id: false }
);

const CommentSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true },
    name: { type: String, default: "User" },
    text: { type: String, required: true },
  },
  { _id: true, timestamps: true }
);

const ViewPingSchema = new mongoose.Schema(
  {
    uid: { type: String, default: null }, // nullable (anonymous)
    dayKey: { type: String, required: true }, // e.g. "2025-10-22"
  },
  { _id: false }
);

const PostSchema = new mongoose.Schema(
  {
    // ownership
    proOwnerUid: { type: String, required: true, index: true },
    proId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: "Pro" },

    // author snapshot for fast render
    pro: {
      _id: { type: mongoose.Schema.Types.ObjectId, required: true },
      name: { type: String, default: "Professional" },
      lga: { type: String, default: "" },
      photoUrl: { type: String, default: "" },
    },

    // content
    text: { type: String, default: "" },
    media: { type: [MediaSchema], default: [] },
    tags: { type: [String], default: [] },

    // visibility + scoping
    isPublic: { type: Boolean, default: true, index: true },
    hidden: { type: Boolean, default: false, index: true },
    lga: { type: String, default: "", index: true }, // uppercase

    // social
    likes: { type: [String], default: [] }, // array of user UIDs
    likesCount: { type: Number, default: 0, index: true },
    comments: { type: [CommentSchema], default: [] },
    commentsCount: { type: Number, default: 0, index: true },
    viewsCount: { type: Number, default: 0, index: true },
    recentViews: { type: [ViewPingSchema], default: [] }, // small ring buffer to dedupe today
  },
  { timestamps: true }
);

PostSchema.index({ isPublic: 1, hidden: 1, createdAt: -1 });
PostSchema.index({ lga: 1, isPublic: 1, createdAt: -1 });

const Post = mongoose.models.Post || mongoose.model("Post", PostSchema);

/* ------------------------------ Helpers ------------------------------ */
const toUpper = (v) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const trim = (v) => (typeof v === "string" ? v.trim() : v);

/** Best-effort viewer info on public endpoints (no throw) */
async function getViewer(req) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return { uid: null, isAdmin: false };
    const decoded = await admin.auth().verifyIdToken(token);
    return { uid: decoded?.uid || null, isAdmin: isAdmin(decoded?.uid) };
  } catch {
    return { uid: null, isAdmin: false };
  }
}

/** Hide UIDs from non-admins */
function sanitizePostForClient(p, { viewerUid = null, viewerIsAdmin = false } = {}) {
  const obj = typeof p.toObject === "function" ? p.toObject() : { ...p };
  const liked = viewerUid ? (obj.likes || []).includes(viewerUid) : false;

  const base = {
    _id: obj._id,
    pro: obj.pro,
    proId: obj.proId,
    // proOwnerUid: OMIT unless admin
    text: obj.text,
    media: obj.media,
    tags: obj.tags || [],
    lga: obj.lga,
    isPublic: !!obj.isPublic,
    hidden: !!obj.hidden,
    createdAt: obj.createdAt,

    likesCount: obj.likesCount || 0,
    commentsCount: obj.commentsCount || 0,
    viewsCount: obj.viewsCount || 0,
    likedByMe: liked,

    // legacy-friendly fields FeedCard already supports
    authorName: obj.pro?.name || "Professional",
    authorAvatar: obj.pro?.photoUrl || "",
  };

  if (viewerIsAdmin) {
    base.proOwnerUid = obj.proOwnerUid || null;
  }
  return base;
}

/** Hide commenter UID unless admin */
function sanitizeComments(list = [], { viewerIsAdmin = false } = {}) {
  return (list || []).map((c) =>
    viewerIsAdmin
      ? { _id: c._id, uid: c.uid, name: c.name, text: c.text, createdAt: c.createdAt }
      : { _id: c._id, name: c.name, text: c.text, createdAt: c.createdAt }
  );
}

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/* ============================== ROUTER ============================== */
const router = express.Router();

/**
 * POST /api/posts
 * Body: { text?, media?:[{url,type}], lga?, isPublic?:true, tags?:[] }
 * Auth: pro only (must own at least one Pro)
 */
router.post("/posts", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    let { text = "", media = [], lga = "", isPublic = true, tags = [] } = body;

    const proDoc = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!proDoc) return res.status(403).json({ error: "not_a_pro" });

    text = trim(text || "").slice(0, 2000);
    if (!Array.isArray(media)) media = [];
    media = media
      .filter((m) => m && typeof m.url === "string" && m.url.trim())
      .map((m) => ({ url: trim(m.url), type: m.type === "video" ? "video" : "image" }))
      .slice(0, 6);

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

    return res.json({
      ok: true,
      post: sanitizePostForClient(post, { viewerUid: req.user.uid, viewerIsAdmin: req.user.role === "admin" }),
    });
  } catch (err) {
    console.error("[posts:create] error:", err);
    return res.status(500).json({ error: "post_create_failed" });
  }
});

/**
 * GET /api/feed/public?lga=OREDO&limit=20&before=<iso|ts>
 * Returns recent public posts; optionally scoped by LGA.
 */
router.get("/feed/public", async (req, res) => {
  try {
    const { lga = "", limit = 20, before = null } = req.query;
    const q = { isPublic: true, hidden: { $ne: true } };
    if (lga) q.lga = toUpper(String(lga));
    if (before) q.createdAt = { $lt: new Date(before) };

    const items = await Post.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit) || 20, 50)));

    const viewer = await getViewer(req);

    return res.json(items.map((p) => sanitizePostForClient(p, viewer)));
  } catch (err) {
    console.error("[feed:public] error:", err);
    return res.status(500).json({ error: "feed_load_failed" });
  }
});

/**
 * GET /api/posts/me
 * List the current pro’s posts (no UID leakage)
 */
router.get("/posts/me", requireAuth, async (req, res) => {
  try {
    const items = await Post.find({ proOwnerUid: req.user.uid })
      .sort({ createdAt: -1 })
      .limit(100);
    const viewer = { viewerUid: req.user.uid, viewerIsAdmin: req.user.role === "admin" };
    return res.json(items.map((p) => sanitizePostForClient(p, viewer)));
  } catch (err) {
    console.error("[posts:me] error:", err);
    return res.status(500).json({ error: "posts_load_failed" });
  }
});

/**
 * DELETE /api/posts/:id
 * Only the owning pro may delete.
 */
router.delete("/posts/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id);
    if (!p) return res.status(404).json({ error: "not_found" });
    if (p.proOwnerUid !== req.user.uid) return res.status(403).json({ error: "forbidden" });

    await Post.deleteOne({ _id: p._id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[posts:delete] error:", err);
    return res.status(500).json({ error: "delete_failed" });
  }
});

/* ---------------------------- Social actions ---------------------------- */

/** POST /api/posts/:id/like  (toggle) */
router.post("/posts/:id/like", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id);
    if (!p || p.hidden || !p.isPublic) return res.status(404).json({ error: "not_found" });

    const has = p.likes.includes(req.user.uid);
    if (has) {
      p.likes = p.likes.filter((u) => u !== req.user.uid);
    } else {
      p.likes.push(req.user.uid);
    }
    p.likesCount = p.likes.length;
    await p.save();
    return res.json({ ok: true, liked: !has, likesCount: p.likesCount });
  } catch (err) {
    console.error("[posts:like] error:", err);
    return res.status(500).json({ error: "like_failed" });
  }
});

/** GET /api/posts/:id/comments  */
router.get("/posts/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_id" });
    const p = await Post.findById(id).lean();
    if (!p || p.hidden || !p.isPublic) return res.status(404).json({ error: "not_found" });

    const viewer = await getViewer(req);
    const items = sanitizeComments((p.comments || []).slice(-100), viewer);
    return res.json(items);
  } catch (err) {
    console.error("[posts:comments:list] error:", err);
    return res.status(500).json({ error: "comments_load_failed" });
  }
});

/** POST /api/posts/:id/comments {text} */
router.post("/posts/:id/comments", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const text = trim(req.body?.text || "").slice(0, 500);
    if (!text) return res.status(400).json({ error: "empty" });
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findById(id);
    if (!p || p.hidden || !p.isPublic) return res.status(404).json({ error: "not_found" });

    p.comments.push({ uid: req.user.uid, name: req.user.name || "User", text });
    p.comments = p.comments.slice(-200); // trim
    p.commentsCount = p.comments.length;
    await p.save();

    const last = p.comments[p.comments.length - 1];
    const viewerIsAdmin = req.user.role === "admin";
    const comment = viewerIsAdmin
      ? { _id: last._id, uid: last.uid, name: last.name, text: last.text, createdAt: last.createdAt }
      : { _id: last._id, name: last.name, text: last.text, createdAt: last.createdAt };

    return res.json({ ok: true, comment, commentsCount: p.commentsCount });
  } catch (err) {
    console.error("[posts:comments:add] error:", err);
    return res.status(500).json({ error: "comment_failed" });
  }
});

/** POST /api/posts/:id/view  (counts once per user per day) */
router.post("/posts/:id/view", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_id" });

    // best effort: identify user if token is present
    let uid = null;
    try {
      const h = req.headers.authorization || "";
      const token = h.startsWith("Bearer ") ? h.slice(7) : null;
      if (token) {
        const decoded = await admin.auth().verifyIdToken(token);
        uid = decoded?.uid || null;
      }
    } catch {}

    const day = todayKey();
    const p = await Post.findById(id);
    if (!p || p.hidden || !p.isPublic) return res.status(404).json({ error: "not_found" });

    const already = (p.recentViews || []).some((v) => v.uid === uid && v.dayKey === day);
    if (!already) {
      p.viewsCount += 1;
      p.recentViews.push({ uid, dayKey: day });
      // keep buffer small (last ~500 pings)
      if (p.recentViews.length > 500) p.recentViews = p.recentViews.slice(-500);
      await p.save();
    }
    return res.json({ ok: true, viewsCount: p.viewsCount });
  } catch (err) {
    console.error("[posts:view] error:", err);
    return res.status(500).json({ error: "view_failed" });
  }
});

/* --------------------------- Admin moderation --------------------------- */

/** PUT /api/posts/:id/hide {hidden:true|false} */
router.put("/posts/:id/hide", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { hidden = true } = req.body || {};
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_id" });

    const p = await Post.findByIdAndUpdate(id, { $set: { hidden: !!hidden } }, { new: true });
    if (!p) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, post: sanitizePostForClient(p, { viewerIsAdmin: true }) });
  } catch (err) {
    console.error("[posts:hide] error:", err);
    return res.status(500).json({ error: "moderation_failed" });
  }
});

export default router;
