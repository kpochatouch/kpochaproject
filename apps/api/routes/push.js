//apps/api/routes/push.js
import express from "express";
import admin from "firebase-admin";
import PushSubscription from "../models/PushSubscription.js";

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
 * POST /api/push/subscribe
 * body: { subscription }
 */
router.post("/push/subscribe", requireAuth, async (req, res) => {
  try {
    const subscription = req.body?.subscription;
    if (!subscription)
      return res.status(400).json({ error: "subscription_required" });

    await PushSubscription.findOneAndUpdate(
      { ownerUid: req.user.uid },
      {
        $set: {
          ownerUid: req.user.uid,
          subscription,
          userAgent: req.headers["user-agent"] || "",
          disabled: false,
        },
      },
      { upsert: true, new: true },
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[push/subscribe] error:", e?.message || e);
    return res.status(500).json({ error: "subscribe_failed" });
  }
});

/**
 * POST /api/push/unsubscribe
 */
router.post("/push/unsubscribe", requireAuth, async (req, res) => {
  try {
    await PushSubscription.findOneAndUpdate(
      { ownerUid: req.user.uid },
      { $set: { disabled: true } },
      { new: true },
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[push/unsubscribe] error:", e?.message || e);
    return res.status(500).json({ error: "unsubscribe_failed" });
  }
});

export default router;
