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

/* ============================================================
   CLIENT PROFILE
   ============================================================ */

async function handleGetClientMe(req, res) {
  try {
    const p = await ClientProfile.findOne({ ownerUid: req.user.uid }).lean();
    const masked = maskClientProfileForClientView(p, { includeEmail: true }) || {};
    return res.json({ ...masked, email: req.user.email || "" });
  } catch {
    return res.status(500).json({ error: "Failed to load profile" });
  }
}

async function handlePutClientMe(req, res) {
  try {
    const payload = req.body || {};
    if (payload.lga) payload.lga = String(payload.lga).toUpperCase();

    // 1) save / upsert client profile
    const updated = await ClientProfile.findOneAndUpdate(
      { ownerUid: req.user.uid },
      { $set: { ...payload, ownerUid: req.user.uid } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    // 2) 🔁 mirror to Pro if this user is already a Pro
    //    (this is the "pro uses client profile" rule)
    try {
      const pro = await Pro.findOne({ ownerUid: req.user.uid }).lean();
      if (pro) {
        // pull the freshest profile directly from the "profiles" collection
        const col = mongoose.connection.db.collection("profiles");
        const fresh = await col.findOne({ ownerUid: req.user.uid });

        // if for any reason we cannot read the fresh profile, stop here
        if (!fresh) {
          console.warn(
            "[profile->pro sync] no fresh profile found for",
            req.user.uid
          );
        } else {
          const name =
            fresh.fullName ||
            fresh.displayName ||
            fresh.name ||
            [
              fresh?.identity?.firstName,
              fresh?.identity?.lastName,
            ]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            "";

          const phone =
            fresh.phone ||
            fresh?.identity?.phone ||
            "";

          const lga = (
            fresh.lga ||
            fresh.state ||
            fresh?.identity?.lga ||
            fresh?.identity?.state ||
            ""
          )
            .toString()
            .toUpperCase();

          const mirror = {};
          if (name) mirror.name = name;
          if (phone) mirror.phone = phone;
          if (lga) mirror.lga = lga;

          // merge identity but don't destroy existing pro.identity
          mirror.identity = {
            ...(pro.identity || {}),
            ...(fresh.identity || {}),
          };

          await Pro.updateOne(
            { ownerUid: req.user.uid },
            { $set: mirror }
          );
        }
      }
    } catch (e) {
      console.warn("[profile->pro sync] skipped:", e?.message || e);
    }

    const masked = maskClientProfileForClientView(updated, { includeEmail: true }) || {};
    return res.json({ ...masked, email: req.user.email || "" });
  } catch (e) {
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
      const p = await ClientProfile.findOne({ ownerUid: req.params.uid }).lean();
      return res.json(p || null);
    } catch {
      return res.status(500).json({ error: "Failed to load client profile" });
    }
  }
);

// Pro can view client for a booking
router.get(
  "/profile/client/:uid/for-booking/:bookingId",
  requireAuth,
  async (req, res) => {
    try {
      const b = await Booking.findById(req.params.bookingId).lean();
      if (!b) return res.status(404).json({ error: "Booking not found" });

      const isProOwner = b.proOwnerUid && b.proOwnerUid === req.user.uid;
      const canView = ["pending_payment", "scheduled", "accepted", "completed"].includes(
        b.status
      );
      if (!(isProOwner && canView)) {
        return res
          .status(403)
          .json({ error: "Not authorized to view client details for this booking" });
      }

      if (b.clientUid !== req.params.uid) {
        return res.status(400).json({ error: "Client UID does not match booking" });
      }

      const p = await ClientProfile.findOne({ ownerUid: req.params.uid }).lean();
      const masked = maskClientProfileForClientView(p) || null;
      return res.json(masked);
    } catch {
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
    const p = await ProProfile.findOne({ proId: req.params.proId }).lean();
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
      return res.status(403).json({ error: "You are not an approved professional" });

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
      const p = await ProProfile.findOne({ proId: req.params.proId }).lean();
      return res.json(p || null);
    } catch {
      return res.status(500).json({ error: "Failed to load pro profile" });
    }
  }
);

export default router;
