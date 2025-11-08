// apps/api/routes/Profile.js
import express from "express";
import admin from "firebase-admin";
import { ClientProfile, ProProfile } from "../models/Profile.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";
import mongoose from "mongoose";

const router = express.Router();

/* ------------------------------------------------------------------
   AUTH HELPERS
   ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------
   UTILS
   ------------------------------------------------------------------ */
function maskClientProfileForClientView(p) {
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

/* ------------------------------------------------------------------
   1) ENSURE PROFILE (this is the ONLY one allowed to CREATE)
   ------------------------------------------------------------------ */
router.post("/profile/ensure", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    if (!uid) return res.status(400).json({ error: "missing_uid" });

    // see if we already have a client profile (old code may have used uid OR ownerUid)
    const existing = await ClientProfile.findOne({
      $or: [{ ownerUid: uid }, { uid }],
    }).lean();

    if (!existing) {
      // create minimal doc
      const base = {
        uid,
        ownerUid: uid,
        fullName: (req.user.email || "").split("@")[0] || "",
      };
      await ClientProfile.create(base);

      // also update raw "profiles" collection used by server.js/admin
      try {
        const col = mongoose.connection.db.collection("profiles");
        await col.updateOne({ uid }, { $set: base }, { upsert: true });
      } catch (e) {
        console.warn("[profile:ensure] raw sync skipped:", e?.message || e);
      }

      return res.json({ ok: true, created: true });
    }

    // profile exists → make sure raw collection also has it
    try {
      const col = mongoose.connection.db.collection("profiles");
      await col.updateOne(
        { uid },
        {
          $set: {
            uid,
            ownerUid: uid,
            fullName: existing.fullName || "",
            phone: existing.phone || "",
            state: existing.state || "",
            lga: existing.lga || "",
            address: existing.address || "",
            photoUrl: existing.photoUrl || "",
            ...(existing.identity ? { identity: existing.identity } : {}),
          },
        },
        { upsert: true }
      );
    } catch (e) {
      console.warn("[profile:ensure-existing] raw sync skipped:", e?.message || e);
    }

    return res.json({ ok: true, created: false });
  } catch (e) {
    console.warn("[profile:ensure] error", e?.message || e);
    return res.status(500).json({ error: "ensure_failed" });
  }
});

/* ------------------------------------------------------------------
   2) CLIENT PROFILE - GET
   ------------------------------------------------------------------ */
async function handleGetClientMe(req, res) {
  try {
    const p = await ClientProfile.findOne({ ownerUid: req.user.uid }).lean();

    // also expose pro info (some frontend bits show if user is pro)
    const pro = await Pro.findOne({ ownerUid: req.user.uid })
      .select("_id name photoUrl status")
      .lean()
      .catch(() => null);

    const masked = maskClientProfileForClientView(p) || {};

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

/* ------------------------------------------------------------------
   3) CLIENT PROFILE - UPDATE ONLY (no create here)
   ------------------------------------------------------------------ */
async function handlePutClientMe(req, res) {
  try {
    const payload = req.body || {};

    // normalize casing only if present
    if (payload.lga) payload.lga = String(payload.lga).toUpperCase();
    if (payload.state) payload.state = String(payload.state).toUpperCase();

    // build a selective $set — only non-empty fields overwrite
    const clientSet = {
      ownerUid: req.user.uid,
      uid: req.user.uid,
    };

    if (payload.fullName && payload.fullName.trim()) {
      clientSet.fullName = payload.fullName.trim();
    }
    if (payload.phone && payload.phone.trim()) {
      clientSet.phone = payload.phone.trim();
    }
    if (payload.state) {
      clientSet.state = payload.state;
    }
    if (payload.lga) {
      clientSet.lga = payload.lga;
    }
    if (typeof payload.address === "string" && payload.address.trim()) {
      clientSet.address = payload.address.trim();
    }
    if (payload.photoUrl && payload.photoUrl.trim()) {
      clientSet.photoUrl = payload.photoUrl.trim();
    }
    if (payload.identity && typeof payload.identity === "object") {
      clientSet.identity = payload.identity;
      if (payload.identity.photoUrl && payload.identity.photoUrl.trim()) {
        clientSet.photoUrl = payload.identity.photoUrl.trim();
      }
    }
    if (payload.kyc) clientSet.kyc = payload.kyc;
    if (typeof payload.acceptedTerms === "boolean")
      clientSet.acceptedTerms = payload.acceptedTerms;
    if (typeof payload.acceptedPrivacy === "boolean")
      clientSet.acceptedPrivacy = payload.acceptedPrivacy;
    if (payload.agreements) clientSet.agreements = payload.agreements;

    // IMPORTANT: do NOT create here — frontend must have called /profile/ensure first
    const updated = await ClientProfile.findOneAndUpdate(
      { ownerUid: req.user.uid },
      { $set: clientSet },
      { new: true } // ← no upsert
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: "profile_not_found" });
    }

    // keep the shared "profiles" collection in sync (this is your single source)
    try {
      const col = mongoose.connection.db.collection("profiles");
      const $set = {
        uid: req.user.uid,
        ownerUid: req.user.uid,
      };

      // reuse your helper to only pick present fields
      const fromPayload = buildProfilesSetFromPayload(payload);
      Object.assign($set, fromPayload);

      await col.updateOne(
        { uid: req.user.uid },
        { $set },
        { upsert: true }
      );
    } catch (e) {
      console.warn("[profile->profiles col sync] skipped:", e?.message || e);
    }

    // ✨ NOTE: we removed the part that was mirroring client → Pro
    // so client saves will no longer overwrite pro name/photo/etc.

    const masked = maskClientProfileForClientView(updated) || {};
    return res.json({ ...masked, email: req.user.email || "" });
  } catch (e) {
    console.warn("[profile:put/me] error", e?.message || e);
    return res.status(500).json({ error: "Failed to save profile" });
  }
}

/* ------------------------------------------------------------------
   REGISTER ROUTES (same paths as before, so other code stays working)
   ------------------------------------------------------------------ */
router.get("/profile/client/me", requireAuth, handleGetClientMe);
router.put("/profile/client/me", requireAuth, handlePutClientMe);

// aliases kept for old frontend code
router.get("/profile/me", requireAuth, handleGetClientMe);
router.put("/profile/me", requireAuth, handlePutClientMe);

/* ------------------------------------------------------------------
   ADMIN READ (kept exactly as before)
   ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------
   PRO CAN VIEW CLIENT FOR A BOOKING (kept)
   ------------------------------------------------------------------ */
router.get(
  "/profile/client/:uid/for-booking/:bookingId",
  requireAuth,
  async (req, res) => {
    try {
      const b = await Booking.findById(req.params.bookingId).lean();
      if (!b) return res.status(404).json({ error: "Booking not found" });

      let isProOwner = false;

      if (b.proOwnerUid && b.proOwnerUid === req.user.uid) {
        isProOwner = true;
      } else if (b.proId) {
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
        return res.status(400).json({ error: "Client UID does not match booking" });
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

/* ------------------------------------------------------------------
   PRO PROFILE (extras) — kept exactly
   ------------------------------------------------------------------ */
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
    if (!pro) {
      return res.status(403).json({ error: "You are not an approved professional" });
    }

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
