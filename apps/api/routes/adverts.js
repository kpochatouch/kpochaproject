//apps/api/routes/adverts.js
import express from "express";
import admin from "firebase-admin";
import mongoose from "mongoose";
import Advert from "../models/Advert.js";
import MediaAsset from "../models/MediaAsset.js";
import { expandMediaForClient } from "../services/mediaResolver.js";

const router = express.Router();

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

const ADMIN_UIDS = (process.env.ADMIN_UIDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isAdminUser(user = {}) {
  const byUid = !!user?.uid && ADMIN_UIDS.includes(user.uid);
  const byEmail =
    !!user?.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase());
  return byUid || byEmail;
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

function isObjId(v) {
  return typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);
}

const ALLOWED_PLACEMENTS = new Set(["feed", "stories", "right_rail"]);
const ALLOWED_ACTIONS = new Set([
  "profile",
  "booking",
  "chat",
  "post",
  "external_url",
]);

const GOAL_TO_ACTIONS = {
  profile_visits: ["profile"],
  bookings: ["booking", "profile"],
  messages: ["chat"],
  post_views: ["post"],
  website_clicks: ["external_url"],
};

function normalizeAdvertInput(body = {}) {
  return {
    title: String(body.title || "").trim(),
    text: String(body.text || "").trim(),
    media: Array.isArray(body.media) ? body.media : [],
    placements: Array.isArray(body.placements) ? body.placements : [],
    goal: String(body.goal || "").trim(),
    actionType: String(body.actionType || "").trim(),
    actionValue: String(body.actionValue || "").trim(),
    buttonLabel: String(body.buttonLabel || "").trim(),
    status: String(body.status || "").trim(),
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    budget: Number(body.budget || 0),
    currency: String(body.currency || "NGN").trim() || "NGN",
    priority: Number(body.priority || 0),
  };
}

async function assertPublicOwnedReadyAdvertMedia(ownerUid, media = []) {
  if (!Array.isArray(media) || !media.length) {
    return { ok: false, status: 400, error: "media_required" };
  }

  for (const item of media) {
    if (!item || !isObjId(String(item.assetId || ""))) {
      return { ok: false, status: 400, error: "asset_id_required" };
    }

    if (!["image", "video"].includes(String(item.type || ""))) {
      return { ok: false, status: 400, error: "invalid_media_type" };
    }

    if (item.url || item.thumbnailUrl) {
      return { ok: false, status: 400, error: "legacy_urls_not_allowed" };
    }

    const asset = await MediaAsset.findById(item.assetId)
      .select("_id ownerUid visibility type status")
      .lean()
      .catch(() => null);

    if (!asset) {
      return { ok: false, status: 404, error: "asset_not_found" };
    }

    if (String(asset.ownerUid) !== String(ownerUid)) {
      return { ok: false, status: 403, error: "asset_forbidden" };
    }

    if (asset.visibility !== "public") {
      return { ok: false, status: 400, error: "advert_asset_must_be_public" };
    }

    if (asset.status !== "ready") {
      return { ok: false, status: 409, error: "asset_not_ready" };
    }

    if (asset.type !== item.type) {
      return { ok: false, status: 400, error: "asset_type_mismatch" };
    }

    if (
      item.thumbnailAssetId &&
      !isObjId(String(item.thumbnailAssetId || ""))
    ) {
      return { ok: false, status: 400, error: "invalid_thumbnail_asset_id" };
    }
  }

  return { ok: true };
}

function validatePlacements(placements = []) {
  if (!Array.isArray(placements) || !placements.length) return false;
  return placements.every((p) => ALLOWED_PLACEMENTS.has(String(p)));
}

function validateGoalAction(goal, actionType) {
  const allowed = GOAL_TO_ACTIONS[goal] || [];
  return allowed.includes(actionType);
}

function validateDates(startsAt, endsAt) {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime()))
    return false;
  if (!(endsAt instanceof Date) || Number.isNaN(endsAt.getTime())) return false;
  return startsAt.getTime() < endsAt.getTime();
}

function validateActionValue(actionType, actionValue) {
  if (!actionType) return false;
  if (!actionValue) return false;

  if (actionType === "external_url") {
    return /^https?:\/\/.+/i.test(actionValue);
  }

  return String(actionValue).trim().length > 0;
}

async function sanitizeAdvertForClient(ad) {
  const obj = typeof ad.toObject === "function" ? ad.toObject() : { ...ad };

  const mediaExpanded = await expandMediaForClient(
    (obj.media || []).map((m) => ({
      assetId: m.assetId,
      thumbnailAssetId: m.thumbnailAssetId,
      type: m.type,
    })),
  );

  return {
    _id: obj._id,
    ownerUid: obj.ownerUid,
    title: obj.title,
    text: obj.text,
    media: mediaExpanded,
    placements: obj.placements || [],
    goal: obj.goal,
    actionType: obj.actionType,
    actionValue: obj.actionValue,
    buttonLabel: obj.buttonLabel,
    status: obj.status,
    startsAt: obj.startsAt,
    endsAt: obj.endsAt,
    budget: obj.budget,
    currency: obj.currency,
    rejectionReason: obj.rejectionReason || "",
    priority: obj.priority || 0,
    impressionsCount: obj.impressionsCount || 0,
    clicksCount: obj.clicksCount || 0,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

router.post("/adverts", requireAuth, async (req, res) => {
  try {
    const body = normalizeAdvertInput(req.body || {});

    const mediaCheck = await assertPublicOwnedReadyAdvertMedia(
      req.user.uid,
      body.media,
    );
    if (!mediaCheck.ok) {
      return res.status(mediaCheck.status).json({ error: mediaCheck.error });
    }

    if (!validatePlacements(body.placements)) {
      return res.status(400).json({ error: "invalid_placements" });
    }

    if (!GOAL_TO_ACTIONS[body.goal]) {
      return res.status(400).json({ error: "invalid_goal" });
    }

    if (!ALLOWED_ACTIONS.has(body.actionType)) {
      return res.status(400).json({ error: "invalid_action_type" });
    }

    if (!validateGoalAction(body.goal, body.actionType)) {
      return res.status(400).json({ error: "goal_action_mismatch" });
    }

    if (!validateActionValue(body.actionType, body.actionValue)) {
      return res.status(400).json({ error: "invalid_action_value" });
    }

    if (!validateDates(body.startsAt, body.endsAt)) {
      return res.status(400).json({ error: "invalid_date_range" });
    }

    const advert = await Advert.create({
      ownerUid: req.user.uid,
      title: body.title,
      text: body.text,
      media: body.media.map((m) => ({
        assetId: m.assetId,
        thumbnailAssetId: m.thumbnailAssetId || null,
        type: m.type,
      })),
      placements: body.placements,
      goal: body.goal,
      actionType: body.actionType,
      actionValue: body.actionValue,
      buttonLabel: body.buttonLabel || "Learn more",
      status: "draft",
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      budget: body.budget,
      currency: body.currency || "NGN",
      priority: 0,
    });

    return res.json({
      ok: true,
      advert: await sanitizeAdvertForClient(advert),
    });
  } catch (err) {
    console.error("[adverts:create] error:", err);
    return res.status(500).json({ error: "advert_create_failed" });
  }
});

router.get("/adverts/me", requireAuth, async (req, res) => {
  try {
    const items = await Advert.find({ ownerUid: req.user.uid })
      .sort({ createdAt: -1 })
      .lean();

    const out = await Promise.all(items.map(sanitizeAdvertForClient));
    return res.json(out);
  } catch (err) {
    console.error("[adverts:me] error:", err);
    return res.status(500).json({ error: "adverts_load_failed" });
  }
});

router.get("/adverts/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const ad = await Advert.findById(id);
    if (!ad) return res.status(404).json({ error: "not_found" });

    if (ad.ownerUid !== req.user.uid && !isAdminUser(req.user)) {
      return res.status(403).json({ error: "forbidden" });
    }

    return res.json(await sanitizeAdvertForClient(ad));
  } catch (err) {
    console.error("[adverts:read] error:", err);
    return res.status(500).json({ error: "advert_load_failed" });
  }
});

router.patch("/adverts/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const ad = await Advert.findById(id);
    if (!ad) return res.status(404).json({ error: "not_found" });
    if (ad.ownerUid !== req.user.uid) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (!["draft", "rejected", "submitted"].includes(ad.status)) {
      return res.status(400).json({ error: "status_not_editable" });
    }

    const body = normalizeAdvertInput(req.body || {});

    const mediaCheck = await assertPublicOwnedReadyAdvertMedia(
      req.user.uid,
      body.media,
    );
    if (!mediaCheck.ok) {
      return res.status(mediaCheck.status).json({ error: mediaCheck.error });
    }

    if (!validatePlacements(body.placements)) {
      return res.status(400).json({ error: "invalid_placements" });
    }

    if (!GOAL_TO_ACTIONS[body.goal]) {
      return res.status(400).json({ error: "invalid_goal" });
    }

    if (!ALLOWED_ACTIONS.has(body.actionType)) {
      return res.status(400).json({ error: "invalid_action_type" });
    }

    if (!validateGoalAction(body.goal, body.actionType)) {
      return res.status(400).json({ error: "goal_action_mismatch" });
    }

    if (!validateActionValue(body.actionType, body.actionValue)) {
      return res.status(400).json({ error: "invalid_action_value" });
    }

    if (!validateDates(body.startsAt, body.endsAt)) {
      return res.status(400).json({ error: "invalid_date_range" });
    }

    ad.title = body.title;
    ad.text = body.text;
    ad.media = body.media.map((m) => ({
      assetId: m.assetId,
      thumbnailAssetId: m.thumbnailAssetId || null,
      type: m.type,
    }));
    ad.placements = body.placements;
    ad.goal = body.goal;
    ad.actionType = body.actionType;
    ad.actionValue = body.actionValue;
    ad.buttonLabel = body.buttonLabel || "Learn more";
    ad.startsAt = body.startsAt;
    ad.endsAt = body.endsAt;
    ad.budget = body.budget;
    ad.currency = body.currency || "NGN";
    ad.rejectionReason = "";

    if (ad.status === "rejected") ad.status = "draft";

    await ad.save();

    return res.json({ ok: true, advert: await sanitizeAdvertForClient(ad) });
  } catch (err) {
    console.error("[adverts:update] error:", err);
    return res.status(500).json({ error: "advert_update_failed" });
  }
});

router.patch("/adverts/:id/submit", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    const ad = await Advert.findById(id);
    if (!ad) return res.status(404).json({ error: "not_found" });
    if (ad.ownerUid !== req.user.uid) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (!["draft", "rejected"].includes(ad.status)) {
      return res.status(400).json({ error: "submit_not_allowed" });
    }

    ad.status = "submitted";
    ad.rejectionReason = "";
    await ad.save();

    return res.json({ ok: true, advert: await sanitizeAdvertForClient(ad) });
  } catch (err) {
    console.error("[adverts:submit] error:", err);
    return res.status(500).json({ error: "advert_submit_failed" });
  }
});

router.get(
  "/adverts/admin/list",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();

      const q = status ? { status } : {};
      const items = await Advert.find(q).sort({ createdAt: -1 }).lean();

      const out = await Promise.all(items.map(sanitizeAdvertForClient));
      return res.json(out);
    } catch (err) {
      console.error("[adverts:admin:list] error:", err);
      return res.status(500).json({ error: "admin_adverts_load_failed" });
    }
  },
);

router.patch(
  "/adverts/:id/approve",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

      const ad = await Advert.findById(id);
      if (!ad) return res.status(404).json({ error: "not_found" });

      if (ad.status !== "submitted") {
        return res.status(400).json({ error: "approve_not_allowed" });
      }

      ad.status = "approved";
      ad.rejectionReason = "";
      await ad.save();

      return res.json({ ok: true, advert: await sanitizeAdvertForClient(ad) });
    } catch (err) {
      console.error("[adverts:approve] error:", err);
      return res.status(500).json({ error: "advert_approve_failed" });
    }
  },
);

router.patch(
  "/adverts/:id/reject",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const reason = String(req.body?.reason || "").trim();

      if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });
      if (!reason) return res.status(400).json({ error: "reason_required" });

      const ad = await Advert.findById(id);
      if (!ad) return res.status(404).json({ error: "not_found" });

      ad.status = "rejected";
      ad.rejectionReason = reason;
      await ad.save();

      return res.json({ ok: true, advert: await sanitizeAdvertForClient(ad) });
    } catch (err) {
      console.error("[adverts:reject] error:", err);
      return res.status(500).json({ error: "advert_reject_failed" });
    }
  },
);

router.patch(
  "/adverts/:id/status",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const nextStatus = String(req.body?.status || "").trim();

      if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });
      if (!["active", "paused", "ended"].includes(nextStatus)) {
        return res.status(400).json({ error: "invalid_status" });
      }

      const ad = await Advert.findById(id);
      if (!ad) return res.status(404).json({ error: "not_found" });

      if (
        nextStatus === "active" &&
        !["approved", "paused", "active"].includes(ad.status)
      ) {
        return res.status(400).json({ error: "activate_not_allowed" });
      }

      if (
        nextStatus === "paused" &&
        !["approved", "active"].includes(ad.status)
      ) {
        return res.status(400).json({ error: "pause_not_allowed" });
      }

      ad.status = nextStatus;
      await ad.save();

      return res.json({ ok: true, advert: await sanitizeAdvertForClient(ad) });
    } catch (err) {
      console.error("[adverts:status] error:", err);
      return res.status(500).json({ error: "advert_status_update_failed" });
    }
  },
);

router.get("/adverts/active/list", async (req, res) => {
  try {
    const placement = String(req.query.placement || "").trim();
    if (!ALLOWED_PLACEMENTS.has(placement)) {
      return res.status(400).json({ error: "invalid_placement" });
    }

    const now = new Date();

    const items = await Advert.find({
      placements: placement,
      status: "active",
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    })
      .sort({ priority: -1, createdAt: -1 })
      .limit(20)
      .lean();

    const out = await Promise.all(items.map(sanitizeAdvertForClient));
    return res.json(out);
  } catch (err) {
    console.error("[adverts:active:list] error:", err);
    return res.status(500).json({ error: "active_adverts_load_failed" });
  }
});

router.post("/adverts/:id/impression", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    await Advert.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $inc: { impressionsCount: 1 } },
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[adverts:impression] error:", err);
    return res.status(500).json({ error: "advert_impression_failed" });
  }
});

router.post("/adverts/:id/click", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ error: "invalid_id" });

    await Advert.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $inc: { clicksCount: 1 } },
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[adverts:click] error:", err);
    return res.status(500).json({ error: "advert_click_failed" });
  }
});

export default router;
