// apps/api/routes/profile.js
import express from "express";
import admin from "firebase-admin";
import { ClientProfile, ProProfile } from "../models/Profile.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";

const router = express.Router();

/* --------- Auth & Admin helpers (local, like bookings.js) --------- */
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

function requireAdmin(req, res, next) {
  if (!req.user?.uid || !ADMIN_UIDS.includes(req.user.uid)) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

/* -------------------- Utils -------------------- */
function maskClientProfileForClientView(p) {
  if (!p) return null;
  const obj = { ...p };
  if (obj.id?.numberHash) obj.id.numberHash = "****"; // hide internal hash
  return obj;
}

function filterProPublic(p) {
  if (!p) return null;
  return {
    ownerUid: p.ownerUid,
    proId: p.proId?.toString?.() || p.proId,
    shopAddress: p.shopAddress || "",
    shopPhone: p.shopPhone || "",
    whatsapp: p.whatsapp || "",
    bio: p.bio || "",
    gallery: Array.isArray(p.gallery) ? p.gallery : [],
    verified: !!p.verified,
  };
}

/* ============================================================
   CLIENT PROFILE
   ============================================================ */

// Handlers so we can mount both the canonical and alias paths cleanly
async function handleGetClientMe(req, res) {
  try {
    const p = await ClientProfile.findOne({ ownerUid: req.user.uid }).lean();
    return res.json(maskClientProfileForClientView(p));
  } catch {
    return res.status(500).json({ error: "Failed to load profile" });
  }
}

async function handlePutClientMe(req, res) {
  try {
    const payload = req.body || {};
    if (payload.lga) payload.lga = String(payload.lga).toUpperCase();
    const updated = await ClientProfile.findOneAndUpdate(
      { ownerUid: req.user.uid },
      { $set: { ...payload, ownerUid: req.user.uid } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json(maskClientProfileForClientView(updated));
  } catch {
    return res.status(500).json({ error: "Failed to save profile" });
  }
}

// Canonical paths
router.get("/profile/client/me", requireAuth, handleGetClientMe);
router.put("/profile/client/me", requireAuth, handlePutClientMe);

// 🔁 Aliases so frontend calls to /api/profile/me work
router.get("/profile/me", requireAuth, handleGetClientMe);
router.put("/profile/me", requireAuth, handlePutClientMe);

// Admin read (full)
router.get("/profile/client/:uid/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const p = await ClientProfile.findOne({ ownerUid: req.params.uid }).lean();
    return res.json(p || null);
  } catch {
    return res.status(500).json({ error: "Failed to load client profile" });
  }
});

// Pro can view client details after an accepted booking
router.get("/profile/client/:uid/for-booking/:bookingId", requireAuth, async (req, res) => {
  try {
    const b = await Booking.findById(req.params.bookingId).lean();
    if (!b) return res.status(404).json({ error: "Booking not found" });

    const isProOwner = b.proOwnerUid && b.proOwnerUid === req.user.uid;
    const isAccepted = b.status === "accepted";
    if (!(isProOwner && isAccepted)) {
      return res.status(403).json({ error: "Not authorized to view client details for this booking" });
    }
    if (b.clientUid !== req.params.uid) {
      return res.status(400).json({ error: "Client UID does not match booking" });
    }

    const p = await ClientProfile.findOne({ ownerUid: req.params.uid }).lean();
    return res.json(p || null);
  } catch {
    return res.status(500).json({ error: "Failed to load client profile for booking" });
  }
});

/* ============================================================
   PRO PROFILE (EXTRAS)
   ============================================================ */

// Public, client-visible pro profile
router.get("/profile/pro/:proId", async (req, res) => {
  try {
    const p = await ProProfile.findOne({ proId: req.params.proId }).lean();
    if (!p) return res.json(null);
    return res.json(filterProPublic(p));
  } catch {
    return res.status(500).json({ error: "Failed to load pro profile" });
  }
});

// Pro upserts their own extras
router.put("/profile/pro/me", requireAuth, async (req, res) => {
  try {
    const pro = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!pro) return res.status(403).json({ error: "You are not an approved professional" });

    const payload = req.body || {};
    const toSet = { ...payload, ownerUid: req.user.uid, proId: pro._id };
    const updated = await ProProfile.findOneAndUpdate(
      { ownerUid: req.user.uid },
      { $set: toSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json(updated);
  } catch {
    return res.status(500).json({ error: "Failed to save pro profile" });
  }
});

// Admin full view of pro extras
router.get("/profile/pro/:proId/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const p = await ProProfile.findOne({ proId: req.params.proId }).lean();
    return res.json(p || null);
  } catch {
    return res.status(500).json({ error: "Failed to load pro profile" });
  }
});

export default router;
