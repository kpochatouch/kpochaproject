// apps/api/routes/Profile.js
import express from "express";
import admin from "firebase-admin";
import { ClientProfile, ProProfile } from "../models/Profile.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";
import mongoose from "mongoose";

const router = express.Router();

/* --------- Auth & Admin helpers --------- */
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

/* -------------------- Utils -------------------- */
function maskClientProfileForClientView(p, { includeEmail = false } = {}) {
  if (!p) return null;
  const obj = { ...p };
  delete obj.ownerUid;
  delete obj.uid;
  if (obj.id?.numberHash) obj.id.numberHash = "****";
  return obj;
}

function filterProPublic(p) {
  if (!p) return null;
  return {
    proId: p.proId?.toString?.() || p.proId,
    shopAddress: p.shopAddress || "",
    shopPhone: p.shopPhone || "",
    whatsapp: p.whatsapp || "",
    bio: p.bio || "",
    gallery: Array.isArray(p.gallery) ? p.gallery : [],
    verified: !!p.verified,
  };
}

function buildProfilesSetFromPayload(payload = {}) {
  const set = {};
  if (payload.fullName) set.fullName = payload.fullName;
  if (payload.phone) set.phone = payload.phone;
  if (payload.state) set.state = String(payload.state).toUpperCase();
  if (payload.lga) set.lga = String(payload.lga).toUpperCase();
  if (payload.address) set.address = payload.address;
  if (payload.photoUrl) set.photoUrl = payload.photoUrl;
  if (payload.identity && typeof payload.identity === "object") {
    set.identity = payload.identity;
    if (payload.identity.photoUrl) set.photoUrl = payload.identity.photoUrl;
  }
  if (payload.kyc) set.kyc = payload.kyc;
  if (typeof payload.acceptedTerms === "boolean")
    set.acceptedTerms = payload.acceptedTerms;
  if (typeof payload.acceptedPrivacy === "boolean")
    set.acceptedPrivacy = payload.acceptedPrivacy;
  if (payload.agreements) set.agreements = payload.agreements;
  return set;
}

/* ============================================================
   CLIENT PROFILE
   ============================================================ */

async function handleGetClientMe(req, res) {
  try {
    const p = await ClientProfile.findOne({ ownerUid: req.user.uid }).lean();

    // also tell the UI whether this user is a pro, and the pro photo
    const pro = await Pro.findOne({ ownerUid: req.user.uid })
      .select("_id name photoUrl status")
      .lean()
      .catch(() => null);

    const masked =
      maskClientProfileForClientView(p, { includeEmail: true }) || {};

    return res.json({
      ...masked,
      email: req.user.email || "",
      pro: pro
        ? {
            id: pro._id.toString(),
            name: pro.name || "",
            status: pro.status || "approved",
            photoUrl: pro.photoUrl || "",
          }
        : null,
    });
  } catch (e) {
    console.warn("[profile:get/me] error", e?.message || e);
    return res.status(500).json({ error: "Failed to load profile" });
  }
}

async function handlePutClientMe(req, res) {
  try {
    const payload = req.body || {};
    if (payload.lga) payload.lga = String(payload.lga).toUpperCase();
    if (payload.state) payload.state = String(payload.state).toUpperCase();

    // 1) save / upsert client profile in the mongoose model
    const updated = await ClientProfile.findOneAndUpdate(
      { ownerUid: req.user.uid },
      { $set: { ...payload, ownerUid: req.user.uid } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    // 1b) also keep the raw "profiles" collection in sync
    try {
      const col = mongoose.connection.db.collection("profiles");
      const $set = buildProfilesSetFromPayload(payload);
      if (Object.keys($set).length > 0) {
        await col.updateOne(
          { uid: req.user.uid },
          { $set: $set },
          { upsert: true }
        );
      }
    } catch (e) {
      console.warn("[profile->profiles col sync] skipped:", e?.message || e);
    }

    // 2) mirror to Pro if user already has a Pro
    try {
      const pro = await Pro.findOne({ ownerUid: req.user.uid }).lean();
      if (pro) {
        const col = mongoose.connection.db.collection("profiles");
        const fresh = await col.findOne({ uid: req.user.uid }).catch(() => null);

        const mirror = {};

        const nameFromFresh =
          fresh?.fullName ||
          fresh?.displayName ||
          fresh?.name ||
          [
            fresh?.identity?.firstName,
            fresh?.identity?.lastName,
          ]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          "";

        const nameFromPayload =
          payload.fullName ||
          (payload.identity &&
            [
              payload.identity.firstName,
              payload.identity.lastName,
            ]
              .filter(Boolean)
              .join(" ")
              .trim()) ||
          "";

        const name = nameFromPayload || nameFromFresh;
        if (name) mirror.name = name;

        const phone =
          payload.phone ||
          payload.identity?.phone ||
          fresh?.phone ||
          fresh?.identity?.phone ||
          "";
        if (phone) mirror.phone = phone;

        const lga =
          (payload.lga ||
            payload.state ||
            payload.identity?.lga ||
            payload.identity?.state ||
            fresh?.lga ||
            fresh?.state ||
            fresh?.identity?.lga ||
            fresh?.identity?.state ||
            "")
            .toString()
            .toUpperCase();
        if (lga) mirror.lga = lga;

        const photoUrl =
          payload.photoUrl ||
          payload.identity?.photoUrl ||
          fresh?.photoUrl ||
          fresh?.identity?.photoUrl ||
          "";
        if (photoUrl) mirror.photoUrl = photoUrl;

        mirror.identity = {
          ...(pro.identity || {}),
          ...(fresh?.identity || {}),
          ...(payload.identity || {}),
        };

        await Pro.updateOne({ ownerUid: req.user.uid }, { $set: mirror });
      }
    } catch (e) {
      console.warn("[profile->pro sync] skipped:", e?.message || e);
    }

    const masked =
      maskClientProfileForClientView(updated, { includeEmail: true }) || {};
    return res.json({ ...masked, email: req.user.email || "" });
  } catch (e) {
    console.warn("[profile:put/me] error", e?.message || e);
    return res.status(500).json({ error: "Failed to save profile" });
  }
}

// Canonical paths
router.get("/profile/client/me", requireAuth, handleGetClientMe);
router.put("/profile/client/me", requireAuth, handlePutClientMe);

// Aliases
router.get("/profile/me", requireAuth, handleGetClientMe);
router.put("/profile/me", requireAuth, handlePutClientMe);

// Admin read
router.get(
  "/profile/client/:uid/admin",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const p = await ClientProfile.findOne({
        ownerUid: req.params.uid,
      }).lean();
      return res.json(p || null);
    } catch {
      return res.status(500).json({ error: "Failed to load client profile" });
    }
  }
);

// Pro can view client for a booking (safe version)
router.get(
  "/profile/client/:uid/for-booking/:bookingId",
  requireAuth,
  async (req, res) => {
    try {
      const b = await Booking.findById(req.params.bookingId).lean();
      if (!b) return res.status(404).json({ error: "Booking not found" });

      let isProOwner = false;

      // old way: booking saved proOwnerUid
      if (b.proOwnerUid && b.proOwnerUid === req.user.uid) {
        isProOwner = true;
      } else if (b.proId) {
        // also allow if this user owns the pro in the booking
        const pro = await Pro.findOne({
          _id: b.proId,
          ownerUid: req.user.uid,
        })
          .select("_id")
          .lean();
        if (pro) isProOwner = true;
      }

      const canView = [
        "pending_payment",
        "scheduled",
        "accepted",
        "completed",
      ].includes(b.status);

      if (!(isProOwner && canView)) {
        return res.status(403).json({
          error: "Not authorized to view client details for this booking",
        });
      }

      if (b.clientUid !== req.params.uid) {
        return res
          .status(400)
          .json({ error: "Client UID does not match booking" });
      }

      const p = await ClientProfile.findOne({
        ownerUid: req.params.uid,
      }).lean();
      const masked = maskClientProfileForClientView(p) || null;
      return res.json(masked);
    } catch (e) {
      return res
        .status(500)
        .json({ error: "Failed to load client profile for booking" });
    }
  }
);

/* ============================================================
   PRO PROFILE (EXTRAS)
   ============================================================ */
router.get("/profile/pro/:proId", async (req, res) => {
  try {
    const p = await ProProfile.findOne({
      proId: req.params.proId,
    }).lean();
    if (!p) return res.json(null);
    return res.json(filterProPublic(p));
  } catch {
    return res.status(500).json({ error: "Failed to load pro profile" });
  }
});

router.put("/profile/pro/me", requireAuth, async (req, res) => {
  try {
    const pro = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!pro)
      return res
        .status(403)
        .json({ error: "You are not an approved professional" });

    const payload = req.body || {};
    const toSet = { ...payload, ownerUid: req.user.uid, proId: pro._id };
    const updated = await ProProfile.findOneAndUpdate(
      { ownerUid: req.user.uid },
      { $set: toSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const { ownerUid, ...safe } = updated || {};
    return res.json(safe || null);
  } catch {
    return res.status(500).json({ error: "Failed to save pro profile" });
  }
});

router.get(
  "/profile/pro/:proId/admin",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const p = await ProProfile.findOne({
        proId: req.params.proId,
      }).lean();
      return res.json(p || null);
    } catch {
      return res.status(500).json({ error: "Failed to load pro profile" });
    }
  }
);

export default router;
