import express from 'express';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import Follow from '../models/Follow.js';
import Booking from '../models/Booking.js';
import Notification from '../models/Notification.js';
import { tryAuth } from '../lib/auth.js';

const router = express.Router();

/**
 * GET /api/activity/:uid
 * Returns mixed recent activity for a profile:
 * - recent posts (public)
 * - recent comments (on their posts)
 * - recent follows (new followers)
 * - recent bookings (completed or recent)
 * - recent notifications (to that uid)
 *
 * This is intentionally simple: it fetches small pages from each source
 * and merges them by createdAt descending.
 */
router.get('/activity/:uid', tryAuth, async (req, res) => {
  try {
    const uid = String(req.params.uid || '');
    if (!uid) return res.status(400).json({ error: 'uid_required' });

    const limit = Math.max(5, Math.min(50, Number(req.query.limit || 20)));

    const [posts, comments, follows, bookings, notifications] = await Promise.all([
      Post.find({ proOwnerUid: uid, isPublic: true, hidden: { $ne: true } }).sort({ createdAt: -1 }).limit(limit).lean().catch(()=>[]),
      Comment.find({ 'postOwnerUid': uid }).sort({ createdAt: -1 }).limit(limit).lean().catch(()=>[]),
      Follow.find({ toUid: uid }).sort({ createdAt: -1 }).limit(limit).lean().catch(()=>[]),
      Booking.find({ proOwnerUid: uid }).sort({ createdAt: -1 }).limit(limit).lean().catch(()=>[]),
      Notification.find({ toUid: uid }).sort({ createdAt: -1 }).limit(limit).lean().catch(()=>[]),
    ]);

    const normalized = [];

    posts.forEach(p => normalized.push({ kind: 'post', createdAt: p.createdAt, payload: { id: p._id, text: p.text, media: p.media, proOwnerUid: p.proOwnerUid } }));
    comments.forEach(c => normalized.push({ kind: 'comment', createdAt: c.createdAt, payload: c }));
    follows.forEach(f => normalized.push({ kind: 'follow', createdAt: f.createdAt, payload: f }));
    bookings.forEach(b => normalized.push({ kind: 'booking', createdAt: b.createdAt, payload: b }));
    notifications.forEach(n => normalized.push({ kind: 'notification', createdAt: n.createdAt, payload: n }));

    normalized.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({ items: normalized.slice(0, limit) });
  } catch (e) {
    console.error('[activity] error', e?.message || e);
    return res.status(500).json({ error: 'activity_failed' });
  }
});

export default router;
