import mongoose from 'mongoose';
import redisClient from '../redis.js';
import { getIO } from '../sockets/index.js';

let Notification;
try {
  Notification = (await import('../models/Notification.js')).default;
} catch (e) {
  // fallback: use mongoose collection if model file not available
  try {
    Notification = mongoose.model('Notification');
  } catch {
    const Schema = new mongoose.Schema({
      toUid: String,
      fromUid: String,
      type: String,
      title: String,
      body: String,
      data: mongoose.Schema.Types.Mixed,
      read: { type: Boolean, default: false },
    }, { timestamps: true, collection: 'notifications' });
    Notification = mongoose.models.Notification || mongoose.model('Notification', Schema);
  }
}

export async function createNotification({ toUid, fromUid = null, type = 'generic', title = '', body = '', data = {} } = {}) {
  if (!toUid) throw new Error('toUid required');

  const doc = await Notification.create({
    toUid,
    fromUid,
    type,
    title,
    body,
    data,
    read: false,
  });

  // increment unread counter in Redis (optional)
  try {
    if (redisClient) {
      const key = `notifications:unread:${toUid}`;
      await redisClient.incr(key);
    }
  } catch (e) {
    console.warn('[notificationService] redis incr failed', e?.message || e);
  }

  // emit socket event if sockets available
  try {
    const io = getIO();
    if (io) {
      io.to(`user:${toUid}`).emit('notification:received', {
        id: String(doc._id),
        type: doc.type,
        title: doc.title,
        body: doc.body,
        data: doc.data,
        createdAt: doc.createdAt,
      });
    }
  } catch (e) {
    // non-fatal
  }

  return doc;
}

export async function markRead(notificationId, readerUid = null) {
  if (!notificationId) throw new Error('notificationId required');
  const n = await Notification.findById(notificationId);
  if (!n) throw new Error('not_found');

  if (readerUid && n.toUid !== readerUid) {
    // don't allow marking others' notifications (enforce in route too)
    throw new Error('forbidden');
  }

  if (!n.read) {
    n.read = true;
    await n.save();

    // decrement redis counter
    try {
      if (redisClient) {
        const key = `notifications:unread:${n.toUid}`;
        await redisClient.decr(key).catch(()=>{});
      }
    } catch {}
  }
  return n;
}

export async function unreadCount(uid) {
  if (!uid) return 0;

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
    return await Notification.countDocuments({ toUid: uid, read: { $ne: true } });
  } catch (e) {
    return 0;
  }
}

export async function listNotifications(uid, { limit = 50, before } = {}) {
  if (!uid) throw new Error('uid required');
  const q = { toUid: uid };
  if (before) q.createdAt = { $lt: new Date(before) };
  const items = await Notification.find(q).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(200, Number(limit || 50)))).lean();
  return items;
}

export default {
  createNotification,
  markRead,
  unreadCount,
  listNotifications,
};
