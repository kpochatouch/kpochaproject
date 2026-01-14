// apps/api/services/postService.js
import Post from "../models/Post.js";
import PostStats from "../models/PostStats.js";
import { createNotification } from "./notificationService.js";
import { getIO } from "../sockets/index.js";

/**
 * createPost(payload, proOwnerUid)
 * - creates post, ensures PostStats
 * - emits post:created to profile:{proOwnerUid} room
 */
export async function createPost({ payload = {}, proOwnerUid }) {
  const post = await Post.create({
    proOwnerUid,
    proId: payload.proId,
    pro: payload.pro,
    text: payload.text || "",
    media: payload.media || [],
    tags: payload.tags || [],
    lga: payload.lga || "",
    isPublic: payload.isPublic !== false,
  });

  await PostStats.findOneAndUpdate(
    { postId: post._id },
    { $setOnInsert: { postId: post._id, trendingScore: 0 } },
    { upsert: true, new: true },
  );

  // emit socket event for feed listeners
  try {
    const io = getIO();
    if (io) {
      io.to(`profile:${proOwnerUid}`).emit("post:created", {
        id: String(post._id),
        proOwnerUid,
        text: post.text,
        media: post.media,
        createdAt: post.createdAt,
      });
    }
  } catch (e) {}

  return post;
}

/**
 * notifyOnLike({ postId, likerUid })
 * - creates a notification to post owner
 * - emits a post:engagement socket event
 */
export async function notifyOnLike({ postId, likerUid }) {
  const post = await Post.findById(postId).lean();
  if (!post) return null;
  const ownerUid = post.proOwnerUid;
  if (!ownerUid || ownerUid === likerUid) return null;

  await createNotification({
    ownerUid,
    actorUid: likerUid,
    type: "post_like",
    data: {
      postId: String(postId),
      message: "Your post got a new like.",
    },
  });

  try {
    const io = getIO();
    if (io) {
      io.to(`user:${ownerUid}`).emit("post:engagement", {
        postId: String(postId),
        type: "like",
        from: likerUid,
      });
    }
  } catch (e) {}
}

export default {
  createPost,
  notifyOnLike,
};
