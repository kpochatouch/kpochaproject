// apps/api/routes/follow.js
import express from "express";
import admin from "firebase-admin";
import Follow from "../models/Follow.js";
import { Pro } from "../models.js";

const router = express.Router();

/* --------------------------- Auth helpers --------------------------- */
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

async function tryAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (token) {
      const decoded = await admin.auth().verifyIdToken(token);
      req.user = { uid: decoded.uid, email: decoded.email || null };
    }
  } catch {}
  next();
}

/* --------------------------- Helpers --------------------------- */
async function resolveTargetUid({ targetUid, proId }) {
  if (targetUid) return String(targetUid);
  if (proId) {
    const pro = await Pro.findById(proId).lean();
    return pro?.ownerUid || null;
  }
  return null;
}

/* ============================== ROUTES ============================== */

// POST /api/follow  body: { targetUid? , proId? }
router.post("/follow", requireAuth, async (req, res) => {
  try {
    const followerUid = req.user.uid;
    const targetUid = await resolveTargetUid(req.body || {});
    if (!targetUid) return res.status(400).json({ error: "target_required" });
    if (targetUid === followerUid)
      return res.status(400).json({ error: "cannot_follow_self" });

    await Follow.findOneAndUpdate(
      { followerUid, targetUid },
      { $setOnInsert: { followerUid, targetUid } },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, following: true });
  } catch (e) {
    return res.status(500).json({ error: "follow_failed" });
  }
});

// DELETE /api/follow  body: { targetUid? , proId? }
router.delete("/follow", requireAuth, async (req, res) => {
  try {
    const followerUid = req.user.uid;
    const targetUid = await resolveTargetUid(req.body || {});
    if (!targetUid) return res.status(400).json({ error: "target_required" });

    await Follow.deleteOne({ followerUid, targetUid });
    return res.json({ ok: true, following: false });
  } catch {
    return res.status(500).json({ error: "unfollow_failed" });
  }
});

// GET /api/follow/state?targetUid=...&proId=...
router.get("/follow/state", requireAuth, async (req, res) => {
  try {
    const followerUid = req.user.uid;
    const targetUid = await resolveTargetUid(req.query || {});
    if (!targetUid) return res.json({ following: false });
    const exists = await Follow.exists({ followerUid, targetUid });
    return res.json({ following: !!exists });
  } catch {
    return res.json({ following: false });
  }
});

// GET /api/follow/counts?targetUid=...&proId=...
router.get("/follow/counts", tryAuth, async (req, res) => {
  try {
    const targetUid = await resolveTargetUid(req.query || {});
    if (!targetUid) return res.json({ followers: 0 });
    const followers = await Follow.countDocuments({ targetUid });
    return res.json({ followers });
  } catch {
    return res.json({ followers: 0 });
  }
});

// GET /api/following  (list of target UIDs I follow)
router.get("/following", requireAuth, async (req, res) => {
  try {
    const list = await Follow.find({ followerUid: req.user.uid })
      .select("targetUid -_id")
      .lean();
    const uids = list.map((x) => x.targetUid);
    return res.json({ uids });
  } catch {
    return res.status(500).json({ error: "following_load_failed" });
  }
});

export default router;
