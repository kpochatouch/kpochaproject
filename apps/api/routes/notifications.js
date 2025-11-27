// apps/api/routes/notifications.js
import express from "express";
import admin from "firebase-admin";
import {
  markRead,
  unreadCount,
  listNotifications,
} from "../services/notificationService.js";
import Notification from "../models/Notification.js";
import redisClient from "../redis.js";

/* --------------------------- Auth middleware --------------------------- */

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

const router = express.Router();

/**
 * GET /api/notifications
 * Query params:
 *  - limit
 *  - before
 *  - unreadOnly (true/false)
 */
router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const { limit = 50, before = null, unreadOnly = false } = req.query;
    const items = await listNotifications(req.user.uid, {
      limit: Number(limit || 50),
      before,
      unreadOnly: String(unreadOnly) === "true" || unreadOnly === true,
    });
    return res.json(items);
  } catch (e) {
    console.error("[notifications:list]", e?.message || e);
    return res.status(500).json({ error: "notifications_list_failed" });
  }
});

/**
 * GET /api/notifications/counts
 */
router.get("/notifications/counts", requireAuth, async (req, res) => {
  try {
    const cnt = await unreadCount(req.user.uid);
    return res.json({ unread: Number(cnt || 0) });
  } catch (e) {
    console.error("[notifications:counts]", e?.message || e);
    return res.status(500).json({ error: "counts_failed" });
  }
});

/**
 * PUT /api/notifications/:id/read
 * mark a single notification as seen
 */
router.put("/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const n = await markRead(req.params.id, req.user.uid);
    return res.json({ ok: true, id: String(n._id) });
  } catch (e) {
    console.error("[notifications:markRead]", e?.message || e);
    if (e.message === "not_found")
      return res.status(404).json({ error: "not_found" });
    if (e.message === "forbidden")
      return res.status(403).json({ error: "forbidden" });
    return res.status(500).json({ error: "mark_read_failed" });
  }
});

/**
 * PUT /api/notifications/read-all
 * mark all notifications for this user as seen
 */
router.put("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await Notification.updateMany(
      { ownerUid: req.user.uid, seen: { $ne: true } },
      { $set: { seen: true } }
    );

    // reset redis counter
    try {
      if (redisClient) {
        const key = `notifications:unread:${req.user.uid}`;
        await redisClient.set(key, "0");
      }
    } catch (e) {
      // ignore redis errors
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[notifications:readAll]", e?.message || e);
    return res.status(500).json({ error: "read_all_failed" });
  }
});

export default router;
