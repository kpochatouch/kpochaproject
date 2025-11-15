import express from "express";
import Notification from "../models/Notification.js";
import { requireAuth } from "../lib/auth.js";
const router = express.Router();

// GET /api/notifications?limit=30&before=<iso>
router.get("/notifications", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 200));
  const q = { ownerUid: uid };
  if (req.query.before) q.createdAt = { $lt: new Date(req.query.before) };
  try {
    const items = await Notification.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json(items);
  } catch (e) {
    console.error("[notifications:list]", e);
    return res.status(500).json({ error: "notifications_load_failed" });
  }
});

// GET /api/notifications/counts  -> { unread }
router.get("/notifications/counts", requireAuth, async (req, res) => {
  try {
    const unread = await Notification.countDocuments({ ownerUid: req.user.uid, seen: false });
    return res.json({ unread });
  } catch (e) {
    console.error("[notifications:counts]", e);
    return res.status(500).json({ unread: 0 });
  }
});

// PUT /api/notifications/:id/read  -> mark read
router.put("/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, ownerUid: req.user.uid }, { $set: { seen: true } });
    // optionally update Redis unread counter (decrement)
    return res.json({ ok: true });
  } catch (e) {
    console.error("[notifications:read]", e);
    return res.status(500).json({ ok: false });
  }
});

// PUT /api/notifications/read-all
router.put("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await Notification.updateMany({ ownerUid: req.user.uid, seen: false }, { $set: { seen: true } });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[notifications:read-all]", e);
    return res.status(500).json({ ok: false });
  }
});

export default router;
