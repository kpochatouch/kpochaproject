// apps/api/routes/bookings.js
import express from "express";
import admin from "firebase-admin";
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";

const router = express.Router();

/* --------------------------- Auth middleware --------------------------- */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ----------------------------- Helpers ------------------------------ */

// Is the current user an admin? (uses server's ADMIN_UIDS env setup if needed)
function isAdminReq(req) {
  const adminUids = (process.env.ADMIN_UIDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return !!(req?.user?.uid && adminUids.includes(req.user.uid));
}

/**
 * Hide private contact unless:
 *  - caller is admin, OR
 *  - caller is the assigned proOwnerUid AND booking is accepted|completed
 */
function sanitizeBookingFor(req, b) {
  const isAdmin = isAdminReq(req);
  const isProOwner = req?.user?.uid && b?.proOwnerUid && req.user.uid === b.proOwnerUid;

  const obj = typeof b.toObject === "function" ? b.toObject() : { ...b };
  const showPrivate =
    isAdmin || (isProOwner && (b.status === "accepted" || b.status === "completed"));

  if (!showPrivate) {
    if (obj.clientContactPrivate) {
      obj.clientContactPrivate = { phone: "", address: "" };
    }
  }
  return obj;
}

/** Build a service snapshot from either the new payload "service" or legacy {serviceName, amountKobo}. */
function buildServiceSnapshotFromPayload(body = {}) {
  const svc = body.service || {};
  const legacyName = body.serviceName;
  const legacyAmount = body.amountKobo;

  if (svc?.serviceName && Number.isFinite(Number(svc.priceKobo))) {
    return {
      serviceId: svc.serviceId || "",
      serviceName: String(svc.serviceName),
      priceKobo: Number(svc.priceKobo),
    };
  }

  if (legacyName && Number.isFinite(Number(legacyAmount))) {
    return {
      serviceId: "",
      serviceName: String(legacyName),
      priceKobo: Number(legacyAmount),
    };
  }

  return null;
}

const trimStr = (v) => (typeof v === "string" ? v.trim() : v);
const toUpper = (v) => (typeof v === "string" ? v.trim().toUpperCase() : v);

/* ============================== ROUTES ============================== */

/**
 * LEGACY: Create scheduled booking (with scheduledFor).
 * Body:
 *  - { proId, service:{ serviceId?, serviceName, priceKobo } } OR { serviceName, amountKobo }
 *  - scheduledFor (ISO)
 *  - lga, addressText?, notes?
 */
router.post("/bookings", requireAuth, async (req, res) => {
  try {
    const {
      proId,
      scheduledFor,
      lga,
      addressText = "",
      notes = "",
      location = null,
      clientContactPrivate = null,
    } = req.body || {};

    const svcSnap = buildServiceSnapshotFromPayload(req.body);
    if (!proId || !svcSnap || !scheduledFor || !lga) {
      return res.status(400).json({
        error:
          "Missing fields: proId, service (or serviceName+amountKobo), scheduledFor, lga",
      });
    }

    // Fetch pro to attach owner uid
    let proOwnerUid = null;
    try {
      const pro = await Pro.findById(proId).lean();
      proOwnerUid = pro?.ownerUid || null;
    } catch {}

    const b = await Booking.create({
      clientUid: req.user.uid,
      clientEmail: req.user.email || "",
      proId: new mongoose.Types.ObjectId(proId),
      proOwnerUid,
      instant: true, // ← add this line here

      service: svcSnap,
      amountKobo: svcSnap.priceKobo,
      currency: "NGN",

      scheduledFor: new Date(scheduledFor),
      lga: toUpper(lga || ""),
      addressText: trimStr(addressText),
      notes: trimStr(notes),

      location: location || undefined,
      clientContactPrivate: clientContactPrivate || undefined,

      paymentStatus: "pending",
      status: "pending_payment",
    });

    res.json({ ok: true, booking: sanitizeBookingFor(req, b) });
  } catch (err) {
    console.error("[bookings:create] error:", err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

/**
 * NEW: Instant booking (no date/time).
 * Body:
 *  {
 *    proId, serviceName, amountKobo,
 *    country, state, lga, addressText,
 *    clientName, clientPhone,
 *    coords: { lat, lng }?, paymentMethod: 'wallet' | 'card',
 *    clientRequestId?: string (idempotency key),
 *    instant: true
 *  }
 *
 * Response:
 *  - For card: { booking, amountKobo } (FE opens Paystack, then POST /api/payments/verify)
 *  - For wallet: (when implemented) debit wallet, set paid/scheduled and return { ok:true, booking }
 */
router.post("/bookings/instant", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const {
      proId,
      serviceName,
      amountKobo,
      country = "Nigeria",
      state = "",
      lga = "",
      addressText = "",
      clientName = "",
      clientPhone = "",
      coords = null,
      paymentMethod = "card",
      clientRequestId = "", // optional idempotency key from FE
    } = body;

    // Validate basic inputs
    if (!proId || !serviceName || !Number.isFinite(Number(amountKobo))) {
      return res.status(400).json({
        error: "Missing fields: proId, serviceName, amountKobo",
      });
    }

    // Load pro (to attach owner uid and default LGA if missing)
    let proDoc = null;
    try {
      proDoc = await Pro.findById(proId).lean();
      if (!proDoc) {
        return res.status(404).json({ error: "pro_not_found" });
      }
    } catch {
      return res.status(400).json({ error: "invalid_proId" });
    }
    const proOwnerUid = proDoc?.ownerUid || null;

    // Normalize and default region
    const normalizedLga = toUpper(lga || proDoc?.lga || "");
    if (!normalizedLga) {
      return res
        .status(400)
        .json({ error: "Missing lga (and pro has no default LGA)" });
    }

    // Optional idempotency: reuse existing recent booking with same key + user
    if (clientRequestId) {
      const existing = await Booking.findOne({
        clientUid: req.user.uid,
        "meta.clientRequestId": String(clientRequestId),
      })
        .sort({ createdAt: -1 })
        .lean();
      if (existing) {
        return res.json({
          ok: true,
          reused: true,
          booking: sanitizeBookingFor(req, existing),
          amountKobo: existing.amountKobo,
        });
      }
    }

    const svcSnap = {
      serviceId: "",
      serviceName: String(serviceName),
      priceKobo: Number(amountKobo),
    };

    const b = await Booking.create({
      clientUid: req.user.uid,
      clientEmail: req.user.email || "",
      proId: new mongoose.Types.ObjectId(proId),
      proOwnerUid,

      service: svcSnap,
      amountKobo: svcSnap.priceKobo,
      currency: "NGN",

      // No scheduledFor in instant flow
      scheduledFor: null,

      // Region context
      country: trimStr(country) || "Nigeria",
      state: trimStr(state),
      lga: normalizedLga,
      addressText: trimStr(addressText || ""),

      // Private contact snapshot (server-side guards elsewhere will override from verified profile when present)
      clientContactPrivate: {
        phone: String(clientPhone || ""),
        address: String(addressText || ""),
      },

      location: coords
        ? {
            lat: Number(coords.lat),
            lng: Number(coords.lng),
          }
        : undefined,

      paymentStatus: "pending",
      status: "pending_payment", // becomes scheduled/accepted after payment + pro action
      paystackReference: null,
      meta: {
        paymentMethodRequested: paymentMethod,
        clientRequestId: clientRequestId ? String(clientRequestId) : undefined,
      },
    });

    // For card, FE will open Paystack and then call /api/payments/verify
    if (paymentMethod === "card") {
      return res.json({
        ok: true,
        booking: sanitizeBookingFor(req, b),
        amountKobo: b.amountKobo,
      });
    }

    // Wallet path (to be wired when wallet debit is ready)
    // Example:
    //   const ok = await debitClientWallet(req.user.uid, b.amountKobo, { bookingId: b._id });
    //   if (!ok) return res.status(400).json({ ok:false, message:"wallet_debit_failed" });
    //   b.paymentStatus = "paid"; b.status = "scheduled"; await b.save();
    //   return res.json({ ok:true, booking: sanitizeBookingFor(req, b) });
    return res.status(400).json({ ok: false, message: "wallet_not_configured" });
  } catch (err) {
    console.error("[bookings:instant] error:", err);
    res.status(500).json({ error: "Failed to create instant booking" });
  }
});

/** Save Paystack reference (client) */
router.put("/bookings/:id/reference", requireAuth, async (req, res) => {
  try {
    const { paystackReference } = req.body || {};
    if (!paystackReference)
      return res.status(400).json({ error: "Missing paystackReference" });

    const b = await Booking.findById(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    if (b.clientUid !== req.user.uid)
      return res.status(403).json({ error: "Forbidden" });

    b.paystackReference = String(paystackReference);
    await b.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("[bookings:reference] error:", err);
    res.status(500).json({ error: "Failed to save reference" });
  }
});

/** Client: my bookings (list) */
router.get("/bookings/me", requireAuth, async (req, res) => {
  try {
    const items = await Booking.find({ clientUid: req.user.uid })
      .sort({ createdAt: -1 })
      .lean();
    // Client can see their own private contact
    const sanitized = items.map((b) => ({
      ...b,
      clientContactPrivate: b.clientContactPrivate || { phone: "", address: "" },
    }));
    res.json(sanitized);
  } catch (err) {
    console.error("[bookings:me] error:", err);
    res.status(500).json({ error: "Failed to load bookings" });
  }
});

/** Pro: bookings assigned to me (owner) */
router.get("/bookings/pro/me", requireAuth, async (req, res) => {
  try {
    const items = await Booking.find({ proOwnerUid: req.user.uid })
      .sort({ createdAt: -1 })
      .lean();
    const sanitized = items.map((b) => sanitizeBookingFor(req, b));
    res.json(sanitized);
  } catch (err) {
    console.error("[bookings:pro:me] error:", err);
    res.status(500).json({ error: "Failed to load pro bookings" });
  }
});

/** Get a single booking (client or assigned pro or admin) */
router.get("/bookings/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }
    const b = await Booking.findById(id);
    if (!b) return res.status(404).json({ error: "not_found" });

    const isAdmin = isAdminReq(req);
    const isClient = b.clientUid === req.user.uid;
    const isProOwner = b.proOwnerUid && b.proOwnerUid === req.user.uid;

    if (!isAdmin && !isClient && !isProOwner) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(sanitizeBookingFor(req, b));
  } catch (err) {
    console.error("[bookings:getOne] error:", err);
    res.status(500).json({ error: "Failed to load booking" });
  }
});

/** Client: cancel booking (safe states) */
router.put("/bookings/:id/cancel", requireAuth, async (req, res) => {
  try {
    const b = await Booking.findById(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    if (b.clientUid !== req.user.uid)
      return res.status(403).json({ error: "Forbidden" });

    if (!["pending_payment", "scheduled", "accepted"].includes(b.status)) {
      return res
        .status(400)
        .json({ error: `Cannot cancel when status is ${b.status}` });
    }

    b.status = "cancelled";
    await b.save();
    res.json({ ok: true, booking: sanitizeBookingFor(req, b) });
  } catch (err) {
    console.error("[bookings:cancel] error:", err);
    res.status(500).json({ error: "Failed to cancel booking" });
  }
});

/** Pro: accept booking */
router.put("/bookings/:id/accept", requireAuth, async (req, res) => {
  try {
    const b = await Booking.findById(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    if (b.proOwnerUid !== req.user.uid)
      return res.status(403).json({ error: "Forbidden" });

    if (!["scheduled", "pending_payment"].includes(b.status)) {
      return res
        .status(400)
        .json({ error: `Cannot accept when status is ${b.status}` });
    }
    if (b.paymentStatus !== "paid") {
      return res.status(400).json({ error: "Cannot accept before payment" });
    }

    b.status = "accepted";
    await b.save();
    res.json({ ok: true, booking: sanitizeBookingFor(req, b) });
  } catch (err) {
    console.error("[bookings:accept] error:", err);
    res.status(500).json({ error: "Failed to accept booking" });
  }
});

/** Pro: decline booking (with reason) */
router.put("/bookings/:id/decline", requireAuth, async (req, res) => {
  try {
    const { reasonCode = "", reasonText = "" } = req.body || {};
    const b = await Booking.findById(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    if (b.proOwnerUid !== req.user.uid)
      return res.status(403).json({ error: "Forbidden" });

    if (["completed", "cancelled"].includes(b.status)) {
      return res
        .status(400)
        .json({ error: `Cannot decline when status is ${b.status}` });
    }

    b.status = "declined";
    b.decline = { reasonCode, reasonText, at: new Date() };
    await b.save();

    res.json({ ok: true, booking: sanitizeBookingFor(req, b) });
  } catch (err) {
    console.error("[bookings:decline] error:", err);
    res.status(500).json({ error: "Failed to decline booking" });
  }
});

/** Pro: complete booking */
router.put("/bookings/:id/complete", requireAuth, async (req, res) => {
  try {
    const b = await Booking.findById(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    if (b.proOwnerUid !== req.user.uid)
      return res.status(403).json({ error: "Forbidden" });

    if (!["accepted", "scheduled"].includes(b.status)) {
      return res
        .status(400)
        .json({ error: `Cannot complete when status is ${b.status}` });
    }

    b.status = "completed";
    b.completedAt = new Date(); // important for auto-release scheduler
    await b.save();

    res.json({ ok: true, booking: sanitizeBookingFor(req, b) });
  } catch (err) {
    console.error("[bookings:complete] error:", err);
    res.status(500).json({ error: "Failed to complete booking" });
  }
});

export default router;
