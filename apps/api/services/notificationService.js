// apps/api/services/notificationService.js
import redisClient from "../redis.js";
import { getIO } from "../sockets/index.js";
import Notification from "../models/Notification.js";

/**
 * Normalize input and support legacy keys
 */
function normalizeCreateArgs(args = {}) {
  const {
    ownerUid,
    actorUid = null,
    type = "generic",
    data = {},
    meta = {},
    toUid,
    fromUid,
    title = "",
    body = "",
    groupKey = null,
    priority = "default",
  } = args;

  const finalOwnerUid = ownerUid || toUid;
  const finalActorUid = actorUid || fromUid || "";

  if (!finalOwnerUid) throw new Error("ownerUid (or toUid) required");

  const dataPayload = {
    ...data,
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
  };

  return {
    ownerUid: finalOwnerUid,
    actorUid: finalActorUid,
    type,
    data: dataPayload,
    meta,
    groupKey,
    priority,
  };
}

/**
 * Increment unread counter in Redis (non-fatal)
 */
async function incrUnreadCounter(uid, delta = 1) {
  if (!redisClient || !uid) return;
  try {
    const key = `notifications:unread:${uid}`;
    // Prefer INCRBY if available
    if (typeof redisClient.incrby === "function") {
      await redisClient.incrby(key, delta);
    } else if (typeof redisClient.incr === "function" && delta === 1) {
      await redisClient.incr(key);
    } else {
      // Fallback: read-modify-write (best-effort)
      const v = Number((await redisClient.get(key)) || "0");
      await redisClient.set(key, String(Math.max(0, v + delta)));
    }
  } catch (err) {
    // non-fatal
    // eslint-disable-next-line no-console
    console.warn("[notificationService] incrUnreadCounter failed", err?.message || err);
  }
}

/**
 * Decrement unread counter safely (clamp at 0)
 */
async function decrUnreadCounter(uid, delta = 1) {
  if (!redisClient || !uid) return;
  try {
    const key = `notifications:unread:${uid}`;
    if (typeof redisClient.decrby === "function") {
      // decrby will allow negative values in some redis clients, clamp later
      await redisClient.decrby(key, delta);
      // clamp to 0
      const current = Number((await redisClient.get(key)) || "0");
      if (current < 0) await redisClient.set(key, "0");
    } else if (typeof redisClient.decr === "function" && delta === 1) {
      await redisClient.decr(key);
      const current = Number((await redisClient.get(key)) || "0");
      if (current < 0) await redisClient.set(key, "0");
    } else {
      // fallback
      const v = Number((await redisClient.get(key)) || "0");
      const next = Math.max(0, v - delta);
      await redisClient.set(key, String(next));
    }
  } catch (err) {
    // non-fatal
    // eslint-disable-next-line no-console
    console.warn("[notificationService] decrUnreadCounter failed", err?.message || err);
  }
}

/**
 * Emit a socket event to a user's personal room.
 * Keep emission best-effort and non-blocking.
 */
function emitToUser(uid, event, payload) {
  try {
    const io = getIO();
    if (!io || !uid) return;
    io.to(`user:${uid}`).emit(event, payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[notificationService] socket emit failed", err?.message || err);
  }
}

/**
 * Create & persist a notification, increment unread counter, and emit socket.
 * Returns the Notification document (lean object if requested).
 */
export async function createNotification(rawArgs = {}, { lean = false } = {}) {
  const args = normalizeCreateArgs(rawArgs);
  const {
    ownerUid,
    actorUid,
    type,
    data,
    meta,
    groupKey,
    priority,
  } = args;

  // Create DB doc
  const doc = await Notification.create({
    ownerUid,
    actorUid: actorUid || "",
    type,
    seen: false,
    readAt: null,
    data,
    meta,
    groupKey,
    priority,
    deleted: false,
  });

  // Increment unread in Redis (best-effort)
  await incrUnreadCounter(ownerUid, 1);

  // Emit socket event to owner
  emitToUser(ownerUid, "notification:received", {
    id: String(doc._id),
    type: doc.type,
    seen: doc.seen,
    data: doc.data,
    meta: doc.meta,
    actorUid: doc.actorUid,
    createdAt: doc.createdAt,
    groupKey: doc.groupKey || null,
    priority: doc.priority || "default",
  });

  return lean ? doc.toObject() : doc;
}

/**
 * Mark a single notification as read/seen.
 * readerUid optional but enforced if provided.
 */
export async function markRead(notificationId, readerUid = null) {
  if (!notificationId) throw new Error("notificationId required");

  const n = await Notification.findById(notificationId);
  if (!n) throw new Error("not_found");

  if (readerUid && n.ownerUid !== readerUid) {
    throw new Error("forbidden");
  }

  if (!n.seen) {
    n.seen = true;
    n.readAt = new Date();
    await n.save();

    // Decrement unread counter (best-effort)
    await decrUnreadCounter(n.ownerUid, 1);

    // Optionally emit an event to the client so UI can update counters
    emitToUser(n.ownerUid, "notification:read", { id: String(n._id) });
  }

  return n;
}

/**
 * Mark all notifications for a user as read (optionally only by type or groupKey).
 * Returns an object { modifiedCount, matchedCount } for convenience.
 */
export async function markAllRead(uid, { type = null, groupKey = null } = {}) {
  if (!uid) throw new Error("uid required");

  const q = { ownerUid: uid, seen: false, deleted: false };
  if (type) q.type = type;
  if (groupKey) q.groupKey = groupKey;

  const res = await Notification.updateMany(q, { $set: { seen: true, readAt: new Date() } });
  const modified = res.modifiedCount ?? res.nModified ?? 0;

  // Reset redis counter conservatively: set to DB count of remaining unread items
  try {
    if (redisClient) {
      const remaining = await Notification.countDocuments({ ownerUid: uid, seen: false, deleted: false });
      const key = `notifications:unread:${uid}`;
      await redisClient.set(key, String(remaining));
    }
  } catch (err) {
    // ignore
    // eslint-disable-next-line no-console
    console.warn("[notificationService] markAllRead redis sync failed", err?.message || err);
  }

  // Emit event for client to refresh UI
  emitToUser(uid, "notification:all_read", { type, groupKey, modified });

  return { modifiedCount: modified };
}

/**
 * Get unread count; prefer Redis with DB fallback.
 */
export async function unreadCount(uid) {
  if (!uid) return 0;

  // Try Redis first
  try {
    if (redisClient) {
      const key = `notifications:unread:${uid}`;
      const v = await redisClient.get(key);
      if (v != null) return Number(v) || 0;
    }
  } catch (err) {
    // ignore and fallback
    // eslint-disable-next-line no-console
    console.warn("[notificationService] unreadCount redis read failed", err?.message || err);
  }

  // Fallback DB
  try {
    return await Notification.countDocuments({ ownerUid: uid, seen: false, deleted: false });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[notificationService] unreadCount db failed", err?.message || err);
    return 0;
  }
}

/**
 * List notifications (with pagination using before cursor)
 */
export async function listNotifications(uid, { limit = 50, before = null, unreadOnly = false } = {}) {
  if (!uid) throw new Error("uid required");
  const q = { ownerUid: uid, deleted: false };
  if (before) q.createdAt = { $lt: new Date(before) };
  if (unreadOnly) q.seen = false;

  const items = await Notification.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(200, Number(limit || 50))))
    .lean();

  return items;
}

/**
 * Reset unread counter in Redis to match DB (useful for admin/repair)
 */
export async function resetUnreadCounter(uid) {
  if (!uid) return;
  try {
    if (!redisClient) return;
    const remaining = await Notification.countDocuments({ ownerUid: uid, seen: false, deleted: false });
    const key = `notifications:unread:${uid}`;
    await redisClient.set(key, String(remaining));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[notificationService] resetUnreadCounter failed", err?.message || err);
  }
}

/**
 * Export default
 */
export default {
  createNotification,
  markRead,
  markAllRead,
  unreadCount,
  listNotifications,
  resetUnreadCounter,
};
