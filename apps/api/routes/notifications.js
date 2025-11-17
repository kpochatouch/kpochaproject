import express from 'express';
import { createNotification, markRead, unreadCount, listNotifications } from '../services/notificationService.js';

const router = express.Router();

// list notifications for me
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const { limit = 50, before = null } = req.query;
    const items = await listNotifications(req.user.uid, { limit: Number(limit || 50), before });
    return res.json(items);
  } catch (e) {
    console.error('[notifications:list]', e?.message || e);
    return res.status(500).json({ error: 'notifications_list_failed' });
  }
});

// unread counts
router.get('/notifications/counts', requireAuth, async (req, res) => {
  try {
    const cnt = await unreadCount(req.user.uid);
    return res.json({ unread: Number(cnt || 0) });
  } catch (e) {
    console.error('[notifications:counts]', e?.message || e);
    return res.status(500).json({ error: 'counts_failed' });
  }
});

// mark single notification read
router.put('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const n = await markRead(req.params.id, req.user.uid);
    return res.json({ ok: true, id: String(n._id) });
  } catch (e) {
    console.error('[notifications:markRead]', e?.message || e);
    if (e.message === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (e.message === 'forbidden') return res.status(403).json({ error: 'forbidden' });
    return res.status(500).json({ error: 'mark_read_failed' });
  }
});

// mark all read
router.put('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    // naive update
    const Notification = (await import('../models/Notification.js')).default;
    await Notification.updateMany({ toUid: req.user.uid, read: { $ne: true } }, { $set: { read: true } });
    // reset redis counter
    try {
      const redisClient = (await import('../redis.js')).default;
      if (redisClient) {
        const key = `notifications:unread:${req.user.uid}`;
        await redisClient.set(key, '0').catch(()=>{});
      }
    } catch {}
    return res.json({ ok: true });
  } catch (e) {
    console.error('[notifications:readAll]', e?.message || e);
    return res.status(500).json({ error: 'read_all_failed' });
  }
});

export default router;
