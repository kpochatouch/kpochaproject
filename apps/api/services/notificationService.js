// apps/api/services/notificationService.js
import redisClient from "../redis.js";
import { getIO } from "../sockets/index.js";
import Notification from "../models/Notification.js";

/**
 * createNotification
 *
 * Canonical shape is:
 *  - ownerUid: who will receive this notification (REQUIRED)
 *  - actorUid: who triggered it (optional)
 *  - type: string label, e.g. "post_like", "follow", "booking_created", "chat_message"
 *  - data: arbitrary payload (postId, bookingId, message, room, etc.)
 *  - meta: optional extra info (priority, category, etc.)
 *
 * For "chat_message" we expect callers (e.g. sockets) to pass:
 *  - type: "chat_message"
 *  - data: {
 *      room,        // "dm:uidA:uidB"
 *      fromUid,     // sender UID
 *      bodyPreview, // text.slice(0, 140)
 *    }
 *
 * For backward compatibility, it also accepts:
 *  - toUid  -> ownerUid
 *  - fromUid -> actorUid
 *  - title/body -> merged into data.title / data.body
 */
export async function createNotification({
  ownerUid,
  actorUid = null,
  type = "generic",
  data = {},
  meta = {},
  // legacy names:
  toUid,
  fromUid,
  title = "",
  body = "",
} = {}) {
  const finalOwnerUid = ownerUid || toUid;
  const finalActorUid = actorUid || fromUid;

  if (!finalOwnerUid) throw new Error("ownerUid (or toUid) required");

  const dataPayload = {
    ...data,
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
  };

  const doc = await Notification.create({
    ownerUid: finalOwnerUid,
    actorUid: finalActorUid || "",
    type,
    seen: false,
    data: dataPayload,
    meta,
  });

  // increment unread counter in Redis (optional)
  try {
    if (redisClient) {
      const key = `notifications:unread:${finalOwnerUid}`;
      await redisClient.incr(key);
    }
  } catch (e) {
    console.warn("[notificationService] redis incr failed", e?.message || e);
  }

  // emit socket event if sockets available
  try {
    const io = getIO();
    if (io) {
      io.to(`user:${finalOwnerUid}`).emit("notification:received", {
        id: String(doc._id),
        type: doc.type,
        seen: doc.seen,
        data: doc.data,
        meta: doc.meta,
        actorUid: doc.actorUid,
        createdAt: doc.createdAt,
      });
    }
  } catch (e) {
    // non-fatal
  }

  return doc;
}

export async function markRead(notificationId, readerUid = null) {
  if (!notificationId) throw new Error("notificationId required");
  const n = await Notification.findById(notificationId);
  if (!n) throw new Error("not_found");

  if (readerUid && n.ownerUid !== readerUid) {
    // don't allow marking others' notifications
    throw new Error("forbidden");
  }

  if (!n.seen) {
    n.seen = true;
    await n.save();

    // decrement redis counter (clamped at 0)
    try {
      if (redisClient) {
        const key = `notifications:unread:${n.ownerUid}`;
        const current = Number((await redisClient.get(key)) || "0");
        const next = current > 0 ? current - 1 : 0;
        await redisClient.set(key, String(next));
      }
    } catch (e) {
      // ignore redis errors
    }
  }
  return n;
}

export async function unreadCount(uid) {
  if (!uid) return 0;

  // try Redis first
  try {
    if (redisClient) {
      const key = `notifications:unread:${uid}`;
      const v = await redisClient.get(key);
      if (v != null) return Number(v) || 0;
    }
  } catch (e) {
    // ignore redis errors
  }

  // fallback to DB count
  try {
    return await Notification.countDocuments({ ownerUid: uid, seen: false });
  } catch (e) {
    return 0;
  }
}

export async function listNotifications(
  uid,
  { limit = 50, before = null, unreadOnly = false } = {}
) {
  if (!uid) throw new Error("uid required");
  const q = { ownerUid: uid };
  if (before) q.createdAt = { $lt: new Date(before) };
  if (unreadOnly) q.seen = false;

  const items = await Notification.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(200, Number(limit || 50))))
    .lean();

  return items;
}

export default {
  createNotification,
  markRead,
  unreadCount,
  listNotifications,
};
