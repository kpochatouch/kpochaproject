//apps/api/routes/push.js
import express from "express";
import admin from "firebase-admin";
import PushSubscription from "../models/PushSubscription.js";
import DevicePushToken from "../models/DevicePushToken.js";

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
    const deviceId = String(req.body?.deviceId || "");
    const surfaceType = req.body?.surfaceType === "pwa" ? "pwa" : "browser";
    const surfaceKey = String(req.body?.surfaceKey || "");

    if (!subscription)
      return res.status(400).json({ error: "subscription_required" });

    const endpoint = subscription?.endpoint || "";
    const p256dh = subscription?.keys?.p256dh || "";
    const auth = subscription?.keys?.auth || "";

    if (!endpoint)
      return res.status(400).json({ error: "subscription_endpoint_required" });

    await PushSubscription.findOneAndUpdate(
      { ownerUid: req.user.uid, endpoint },
      {
        $set: {
          ownerUid: req.user.uid,
          deviceId,
          surfaceType,
          surfaceKey,
          endpoint,
          p256dh,
          auth,
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
    await PushSubscription.updateMany(
      { ownerUid: req.user.uid },
      { $set: { disabled: true } },
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[push/unsubscribe] error:", e?.message || e);
    return res.status(500).json({ error: "unsubscribe_failed" });
  }
});

/**
 * POST /api/push/device-token
 * body: { token, platform }
 */
router.post("/push/device-token", requireAuth, async (req, res) => {
  try {
    const { token, platform, deviceId, surfaceType, surfaceKey } =
      req.body || {};
    const did = String(deviceId || "");
    if (!token) return res.status(400).json({ error: "token_required" });
    if (!["android", "ios"].includes(platform))
      return res.status(400).json({ error: "platform_required" });

    // ✅ Keep 1 active token per deviceId+platform (prevents duplicates when token rotates)
    if (did) {
      await DevicePushToken.updateMany(
        {
          ownerUid: req.user.uid,
          platform,
          deviceId: did,
          token: { $ne: token },
        },
        { $set: { disabled: true } },
      );
    }

    await DevicePushToken.findOneAndUpdate(
      { ownerUid: req.user.uid, platform, token },
      {
        $set: {
          ownerUid: req.user.uid,
          platform,
          token,
          deviceId: did,
          surfaceType: surfaceType || "native",
          surfaceKey: String(surfaceKey || did || ""),
          userAgent: req.headers["user-agent"] || "",
          disabled: false,
        },
      },
      { upsert: true, new: true },
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[push/device-token] error:", e?.message || e);
    return res.status(500).json({ error: "device_token_save_failed" });
  }
});

export default router;
