// apps/api/routes/comments.js
import express from "express";
import mongoose from "mongoose";
import admin from "firebase-admin";
import Comment from "../models/Comment.js";
import PostStats from "../models/PostStats.js";
import Post from "../models/Post.js"; // 👈 make sure this is here
import { ClientProfile } from "../models/Profile.js";
import { getIO } from "../sockets/index.js";
import { scoreFrom } from "../services/postScoring.js";

const router = express.Router();

const isObjId = (v) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);

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

// normalize a comment for client
function shapeComment(c, profile = null) {
  const obj = typeof c.toObject === "function" ? c.toObject() : c;
  return {
    _id: obj._id,
    postId: obj.postId,
    parentId: obj.parentId || null,
    ownerUid: obj.ownerUid,
    text: obj.text,
    attachments: obj.attachments || [],
    createdAt: obj.createdAt,
    authorName: profile?.fullName || "",
    authorAvatar: profile?.photoUrl || "",
  };
}

/* ------------------------------------------------------------ */
/* GET /api/posts/:postId/comments                              */
/* ------------------------------------------------------------ */
router.get("/posts/:postId/comments", async (req, res) => {
  try {
    const { postId } = req.params;
    if (!isObjId(postId))
      return res.status(400).json({ error: "invalid_post_id" });

    const items = await Comment.find({ postId, parentId: null })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    // fetch all profiles for these commenters in one go
    const uids = [...new Set(items.map((c) => c.ownerUid).filter(Boolean))];
    const profiles = uids.length
      ? await ClientProfile.find({ ownerUid: { $in: uids } })
          .select("ownerUid fullName photoUrl")
          .lean()
      : [];

    const profileMap = new Map(profiles.map((p) => [p.ownerUid, p]));

    const shaped = items.map((c) =>
      shapeComment(c, profileMap.get(c.ownerUid) || null),
    );

    return res.json(shaped);
  } catch (err) {
    console.error("[comments:list] error:", err);
    return res.status(500).json({ error: "comments_load_failed" });
  }
});

/* ------------------------------------------------------------ */
/* POST /api/posts/:postId/comments                             */
/* ------------------------------------------------------------ */
router.post("/posts/:postId/comments", requireAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    if (!isObjId(postId))
      return res.status(400).json({ error: "invalid_post_id" });

    // 🔴 this is the piece you were missing
    // check post exists, not hidden/deleted, and comments aren’t disabled for others
    const post = await Post.findById(postId)
      .select("proOwnerUid commentsDisabled hidden deleted")
      .lean();
    if (!post || post.deleted || post.hidden) {
      return res.status(404).json({ error: "post_not_found" });
    }
    if (post.commentsDisabled && post.proOwnerUid !== req.user.uid) {
      return res.status(403).json({ error: "comments_disabled" });
    }

    const { text = "", attachments = [], parentId = null } = req.body || {};

    const comment = await Comment.create({
      postId: new mongoose.Types.ObjectId(postId),
      ownerUid: req.user.uid,
      text: String(text || "").trim(),
      attachments: Array.isArray(attachments) ? attachments : [],
      parentId:
        parentId && isObjId(parentId)
          ? new mongoose.Types.ObjectId(parentId)
          : null,
    });

    // bump stats
    const stats = await PostStats.findOneAndUpdate(
      { postId: new mongoose.Types.ObjectId(postId) },
      {
        $inc: { commentsCount: 1 },
        $set: { lastEngagedAt: new Date() },
      },
      { new: true, upsert: true },
    ).lean();

    const trendingScore = scoreFrom(stats);
    await PostStats.updateOne(
      { postId: new mongoose.Types.ObjectId(postId) },
      { $set: { trendingScore } },
    );

    // fetch profile for this user so UI can show avatar immediately
    const profile =
      (await ClientProfile.findOne({ ownerUid: req.user.uid })
        .select("ownerUid fullName photoUrl")
        .lean()
        .catch(() => null)) || null;

    const shaped = shapeComment(comment, profile);

    // broadcast over socket (optional)
    const io = getIO();
    io?.emit("comment:created", {
      postId,
      comment: shaped,
      commentsCount: stats?.commentsCount || 1,
      trendingScore,
    });

    return res.json({
      ok: true,
      comment: shaped,
      commentsCount: stats?.commentsCount || 1,
      trendingScore,
    });
  } catch (err) {
    console.error("[comments:create] error:", err);
    return res.status(500).json({ error: "comment_create_failed" });
  }
});

/* ------------------------------------------------------------ */
/* DELETE /api/comments/:id                                     */
/* ------------------------------------------------------------ */
router.delete("/comments/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id))
      return res.status(400).json({ error: "invalid_comment_id" });

    const comment = await Comment.findById(id);
    if (!comment) return res.status(404).json({ error: "not_found" });
    if (comment.ownerUid !== req.user.uid) {
      return res.status(403).json({ error: "forbidden" });
    }

    await Comment.deleteOne({ _id: id });

    // lower commentsCount but don’t let it go below 0
    const stats = await PostStats.findOneAndUpdate(
      { postId: comment.postId },
      {
        $inc: { commentsCount: -1 },
        $set: { lastEngagedAt: new Date() },
      },
      { new: true },
    ).lean();

    const fixedComments = Math.max(0, Number(stats?.commentsCount || 0));
    const trendingScore = scoreFrom({ ...stats, commentsCount: fixedComments });

    await PostStats.updateOne(
      { postId: comment.postId },
      { $set: { commentsCount: fixedComments, trendingScore } },
    );

    const io = getIO();
    io?.emit("comment:deleted", {
      postId: String(comment.postId),
      commentId: id,
      commentsCount: fixedComments,
      trendingScore,
    });

    return res.json({ ok: true, commentsCount: fixedComments, trendingScore });
  } catch (err) {
    console.error("[comments:delete] error:", err);
    return res.status(500).json({ error: "comment_delete_failed" });
  }
});

export default router;
