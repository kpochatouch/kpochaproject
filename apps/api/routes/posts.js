// apps/api/routes/posts.js
import express from "express";
import mongoose from "mongoose";
import admin from "firebase-admin";
import { Pro } from "../models.js";

/* --------------------------- Auth middleware --------------------------- */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ------------------------------ Model ------------------------------ */
// Keep the post schema local to this route to minimize integration churn.
// If you already have a Post model elsewhere, feel free to replace this with an import.
const MediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], default: "image" },
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
    text: { type: String, default: "" }, // keep short on FE (e.g., <= 600 chars)
    media: { type: [MediaSchema], default: [] }, // 0 or more
    tags: { type: [String], default: [] },

    // visibility + scoping
    isPublic: { type: Boolean, default: true, index: true },
    lga: { type: String, default: "", index: true }, // UPPERCASE to match your filters

    // moderation flags (future)
    hidden: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

PostSchema.index({ isPublic: 1, hidden: 1, createdAt: -1 });
PostSchema.index({ lga: 1, isPublic: 1, createdAt: -1 });

const Post = mongoose.models.Post || mongoose.model("Post", PostSchema);

/* ------------------------------ Helpers ------------------------------ */
const toUpper = (v) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const trim = (v) => (typeof v === "string" ? v.trim() : v);

function sanitizePostForClient(p) {
  // FE expects:
  // - post.pro { _id, name, lga, photoUrl }
  // - post.media: [{url,type}]
  // - post.text, post.tags, post.createdAt
  // - (optional) post.authorName, post.authorAvatar, post.lga
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
    // legacy-friendly fields FeedCard already knows how to read
    authorName: obj.pro?.name || "Professional",
    authorAvatar: obj.pro?.photoUrl || "",
  };
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

    // Find pro doc for the current user (1:1 ownership assumed; if many, use the first)
    const proDoc = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!proDoc) {
      return res.status(403).json({ error: "not_a_pro" });
    }

    // basic validation / normalization
    text = trim(text || "");
    if (!Array.isArray(media)) media = [];
    media = media
      .filter((m) => m && typeof m.url === "string" && m.url.trim())
      .map((m) => ({ url: trim(m.url), type: m.type === "video" ? "video" : "image" }));

    tags = Array.isArray(tags) ? tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 10) : [];
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

    return res.json({ ok: true, post: sanitizePostForClient(post) });
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
      .limit(Math.max(1, Math.min(Number(limit) || 20, 50)))
      .lean();

    return res.json(items.map(sanitizePostForClient));
  } catch (err) {
    console.error("[feed:public] error:", err);
    return res.status(500).json({ error: "feed_load_failed" });
  }
});

/**
 * GET /api/posts/me
 * List the current pro’s posts (for potential future “My posts” UI).
 */
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

/**
 * DELETE /api/posts/:id
 * Only the owning pro (or future admin middleware) may delete.
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

export default router;
