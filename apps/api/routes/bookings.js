// apps/api/routes/bookings.js
import express from "express";
import admin from "firebase-admin";
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";
import Thread from "../models/Thread.js";

import redisClient from "../redis.js";
import { getIO } from "../sockets/index.js";
import { ClientProfile } from "../models/Profile.js";
import { cancelBookingAndRefund } from "../services/walletService.js";
import { createNotification } from "../services/notificationService.js";
import { creditProPendingForBooking } from "../services/walletService.js";


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
 * Hide private contact depending on viewer:
 *
 * - Admin: sees everything.
 * - Client (booking.clientUid): sees their full phone + address.
 * - Pro owner:
 *      • Before ACCEPTED: sees no phone, no address.
 *      • When ACCEPTED or COMPLETED: sees address only (never phone).
 * - Any other user: no phone, no address.
 */
function sanitizeBookingFor(req, b) {
  const isAdmin = isAdminReq(req);
  const isClient = req?.user?.uid && b?.clientUid && req.user.uid === b.clientUid;
  const isProOwner =
    req?.user?.uid && b?.proOwnerUid && req.user.uid === b.proOwnerUid;

  const obj = typeof b.toObject === "function" ? b.toObject() : { ...b };
  const status = b.status;

  // Admin: full access
  if (isAdmin) {
    return obj;
  }

  // Client: always sees their own contact
  if (isClient) {
    if (!obj.clientContactPrivate) {
      obj.clientContactPrivate = {
        phone: "",
        address: obj.addressText || "",
      };
    }
    return obj;
  }

  // Pro owner: never sees phone; only sees address after accept/completed
  if (isProOwner) {
    const original = obj.clientContactPrivate || {};
    const canSeeAddress = status === "accepted" || status === "completed";

    obj.clientContactPrivate = {
      phone: "", // always hidden from pro
      address: canSeeAddress
        ? original.address || obj.addressText || ""
        : "",
    };
    return obj;
  }

  // Any other authenticated user: strip contact data
  if (obj.clientContactPrivate) {
    obj.clientContactPrivate = { phone: "", address: "" };
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

/**
 * Try to resolve a display name for the client from:
 *   - body.clientName
 *   - ClientProfile (fullName, displayName, firstName + lastName)
 */
async function resolveClientName(uid, fallbackName = "") {
  if (fallbackName && typeof fallbackName === "string") {
    return fallbackName.trim();
  }

  try {
    // Profiles are keyed by `uid` (not ownerUid). Use .lean() for speed.
    const prof = await ClientProfile.findOne({ uid: uid })
      .select("fullName displayName firstName lastName")
      .lean();
    if (!prof) return "";

    return (
      prof.fullName ||
      prof.displayName ||
      [prof.firstName, prof.lastName].filter(Boolean).join(" ") ||
      ""
    ).trim();
  } catch (err) {
    console.warn("[bookings] resolveClientName failed:", err?.message || err);
    return "";
  }
}


/* ============================== ROUTES ============================== */

/**
 * LEGACY: Create scheduled booking (with scheduledFor).
 * Body:
 *  - { proId, service:{ serviceId?, serviceName, priceKobo } } OR { serviceName, amountKobo }
 *  - scheduledFor (ISO)
 *  - lga, addressText?, notes?
 *  - OPTIONAL: clientName (otherwise resolved from profile)
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
      clientName: rawClientName = "",
    } = req.body || {};

    const svcSnap = buildServiceSnapshotFromPayload(req.body);
    if (!proId || !svcSnap || !scheduledFor || !lga) {
      return res.status(400).json({
        error:
          "Missing fields: proId, service (or serviceName+amountKobo), scheduledFor, lga",
      });
    }

    // Resolve client display name
    const clientName = await resolveClientName(req.user.uid, rawClientName);

    // Fetch pro to attach owner uid
    let proOwnerUid = null;
    try {
      const pro = await Pro.findById(proId).lean();
      proOwnerUid = pro?.ownerUid || null;
    } catch {}

    const b = await Booking.create({
      clientUid: req.user.uid,
      clientEmail: req.user.email || "",
      clientName: clientName || undefined,

      proId: new mongoose.Types.ObjectId(proId),
      proOwnerUid,
      instant: false, // scheduled booking (not instant)

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

        // 🔔 Notify pro owner about new scheduled booking (pending payment)
    try {
      if (proOwnerUid) {
        await createNotification({
          toUid: proOwnerUid,
          fromUid: req.user.uid,
          type: "booking_created",
          title: "New booking request",
          body:
            (clientName || "A client") +
            ` requested ${svcSnap.serviceName} in ${toUpper(lga || "")}.`,
          data: {
            bookingId: b._id.toString(),
            status: b.status,
            paymentStatus: b.paymentStatus,
            kind: "scheduled",
          },
        });
      }
    } catch (notifyErr) {
      console.warn(
        "[bookings:create] notify pro failed:",
        notifyErr?.message || notifyErr
      );
    }

    // create booking thread + snapshot (best-effort)
try {
  const room = `booking:${b._id.toString()}`;

  // touchLastMessage will create a minimal thread if missing.
  await Thread.touchLastMessage(room, {
    lastMessageId: null,
    lastMessageAt: b.createdAt || new Date(),
    lastMessagePreview: "Booking created",
    lastMessageFrom: req.user?.uid || null,
    incrementFor: b.proOwnerUid ? [String(b.proOwnerUid)] : null,
  }).catch(() => null);

  // get mongoose doc so we can add participants (instance helper)
  const t = await Thread.findOne({ room }).catch(() => null);
  if (t) {
    if (b.proOwnerUid) await t.addParticipant(String(b.proOwnerUid)).catch(() => null);
    if (b.clientUid) await t.addParticipant(String(b.clientUid)).catch(() => null);
  }
} catch (e) {
  console.warn("[bookings:create] ensure booking thread failed:", e?.message || e);
}



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
      clientName: rawClientName = "",
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

    // Resolve client display name
    const clientName = await resolveClientName(req.user.uid, rawClientName);

    const svcSnap = {
      serviceId: "",
      serviceName: String(serviceName),
      priceKobo: Number(amountKobo),
    };

    const b = await Booking.create({
      clientUid: req.user.uid,
      clientEmail: req.user.email || "",
      clientName: clientName || undefined,

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

      // Normalize coords coming from the client. Accept either { lat, lng } or { lat, lon }.
      // If values are not finite numbers, omit `location` to avoid Mongoose casting errors.
      location: (function () {
        try {
          if (!coords || typeof coords !== "object") return undefined;
          const latNum = Number(coords.lat);
          // support both `lng` and legacy `lon`
          const lngNum =
            typeof coords.lng !== "undefined"
              ? Number(coords.lng)
              : typeof coords.lon !== "undefined"
              ? Number(coords.lon)
              : NaN;
          if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return undefined;
          return { lat: latNum, lng: lngNum };
        } catch {
          return undefined;
        }
      })(),

      paymentStatus: "pending",
      status: "pending_payment", // becomes scheduled/accepted after payment + pro action
      paystackReference: null,
      meta: {
        paymentMethodRequested: paymentMethod,
        clientRequestId: clientRequestId ? String(clientRequestId) : undefined,
      },
    });

        // 🔔 Notify pro owner about new instant booking (pending payment)
    try {
      if (proOwnerUid) {
        await createNotification({
          toUid: proOwnerUid,
          fromUid: req.user.uid,
          type: "booking_created",
          title: "New booking request",
          body:
            (clientName || "A client") +
            ` requested ${svcSnap.serviceName} in ${normalizedLga}.`,
          data: {
            bookingId: b._id.toString(),
            status: b.status,
            paymentStatus: b.paymentStatus,
            kind: "instant",
          },
        });
      }
    } catch (notifyErr) {
      console.warn(
        "[bookings:instant] notify pro failed:",
        notifyErr?.message || notifyErr
      );
    }

    // create booking thread + snapshot (best-effort)
try {
  const room = `booking:${b._id.toString()}`;

  await Thread.touchLastMessage(room, {
    lastMessageId: null,
    lastMessageAt: b.createdAt || new Date(),
    lastMessagePreview: "Instant booking requested",
    lastMessageFrom: req.user?.uid || null,
    incrementFor: b.proOwnerUid ? [String(b.proOwnerUid)] : null,
  }).catch(() => null);

  const t = await Thread.findOne({ room }).catch(() => null);
  if (t) {
    if (b.proOwnerUid) await t.addParticipant(String(b.proOwnerUid)).catch(() => null);
    if (b.clientUid) await t.addParticipant(String(b.clientUid)).catch(() => null);
  }
} catch (e) {
  console.warn("[bookings:instant] ensure booking thread failed:", e?.message || e);
}




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
    // Client can see their own private contact (full)
    const sanitized = items.map((b) => ({
      ...b,
      clientContactPrivate: b.clientContactPrivate || {
        phone: "",
        address: b.addressText || "",
      },
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
    const reason =
      (req.body && (req.body.reason || req.body.reasonText || "")) || "";

    const b = await Booking.findById(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    if (b.clientUid !== req.user.uid)
      return res.status(403).json({ error: "Forbidden" });

    if (!["pending_payment", "scheduled", "accepted"].includes(b.status)) {
      return res
        .status(400)
        .json({ error: `Cannot cancel when status is ${b.status}` });
    }

    // ✅ This will:
    // - Under Option A, pro is NOT funded at payment/accept, so cancellation does not reverse pro funds.
    // - Refund comes from escrow to client wallet (minus possible cancel fee after accept).
    // - only apply fee when client cancels AFTER accept (booking.status === "accepted")
    // - set booking.status = "cancelled" and paymentStatus = "refunded"
    const refundInfo = await cancelBookingAndRefund(b, {
      cancelledBy: "client",
      reason,
    });

    // 🔔 Notify pro owner that client cancelled
    try {
      if (b.proOwnerUid) {
        const feeAppliedKobo = Number(refundInfo?.cancelFeeKobo || 0);
const platformFeeKobo = Math.floor(feeAppliedKobo / 2);
const proCompKobo = Math.max(0, feeAppliedKobo - platformFeeKobo);

const base = "The client cancelled a booking for " + (b?.service?.serviceName || "a service");
const reasonTxt = reason ? ` (reason: ${reason})` : "";

const body =
  feeAppliedKobo > 0
    ? `${base}. Cancel fee applied: ₦${(feeAppliedKobo / 100).toFixed(2)}. ` +
      (b.proOwnerUid
        ? `You received compensation: ₦${(proCompKobo / 100).toFixed(2)} (added to pending).`
        : `Compensation could not be credited (missing proOwnerUid).`) +
      reasonTxt
    : `${base}. No cancellation fee applied.` + reasonTxt;


    await createNotification({
      toUid: b.proOwnerUid,
      fromUid: req.user.uid,
      type: "booking_cancelled",
      title: "Booking cancelled",
      body,
      data: {
        bookingId: b._id.toString(),
        status: b.status,
        paymentStatus: b.paymentStatus,
        cancelFeeKobo: feeAppliedKobo,
        proCompKobo,
        platformFeeKobo,
        refundedAmountKobo: Number(refundInfo?.refundAmountKobo || 0),
      },
    });

      }
    } catch (notifyErr) {
      console.warn(
        "[bookings:cancel] notify pro failed:",
        notifyErr?.message || notifyErr
      );
    }

    res.json({
      ok: true,
      booking: sanitizeBookingFor(req, b),
      refund: refundInfo,
    });
  } catch (err) {
    console.error("[bookings:cancel] error:", err);
    res.status(500).json({ error: "Failed to cancel booking" });
  }
});

/** Pro: cancel booking (after scheduled or accepted) */
router.put("/bookings/:id/cancel-by-pro", requireAuth, async (req, res) => {
  try {
    const reason =
      (req.body && (req.body.reason || req.body.reasonText || "")) || "";

    const b = await Booking.findById(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });

    // only assigned pro can cancel
    if (b.proOwnerUid !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // only allow in these states
    if (!["scheduled", "accepted"].includes(b.status)) {
      return res.status(400).json({ error: `Cannot cancel when status is ${b.status}` });
    }

    // ✅ this triggers FULL refund (no fee) because cancelledBy !== "client"
    const refundInfo = await cancelBookingAndRefund(b, {
      cancelledBy: "pro",
      reason,
    });

    // apology notification to client
    try {
      if (b.clientUid) {
        const amt = Number(refundInfo?.refundAmountKobo || 0);
        await createNotification({
          toUid: b.clientUid,
          fromUid: b.proOwnerUid,
          type: "booking_cancelled",
          title: "Booking cancelled by professional",
          body:
            "Sorry — the professional cancelled this booking. " +
            `Refund: ₦${(amt / 100).toFixed(2)} has been sent to your wallet.`,
          data: {
            bookingId: b._id.toString(),
            refundAmountKobo: amt,
            cancelledBy: "pro",
            reason,
          },
        });
      }
    } catch {}

    return res.json({ ok: true, booking: sanitizeBookingFor(req, b), refund: refundInfo });
  } catch (err) {
    console.error("[bookings:cancel-by-pro] error:", err);
    return res.status(500).json({ error: "Failed to cancel booking" });
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
    b.acceptedAt = new Date(); // for ring-timeout / analytics
    await b.save();


    // --- Socket: notify both client and pro so chat can open ---
    try {
      const io = getIO();
      const payload = {
        bookingId: b._id.toString(),
        status: b.status,
        clientUid: b.clientUid,
        proOwnerUid: b.proOwnerUid,
      };

      // Both sides listen on user:<uid> to react (e.g. open chat)
      if (b.clientUid) {
        io.to(`user:${b.clientUid}`).emit("booking:accepted", payload);
      }
      if (b.proOwnerUid) {
        io.to(`user:${b.proOwnerUid}`).emit("booking:accepted", payload);
      }
      // Optional: booking-scoped room for future
      io.to(`booking:${b._id.toString()}`).emit("booking:accepted", payload);
    } catch (err) {
      console.warn(
        "[bookings:accept] socket emit failed:",
        err?.message || err
      );
    }
    // --- end socket block ---

    // ensure booking thread exists and add participants (best-effort)
try {
  const room = `booking:${b._id.toString()}`;

  await Thread.touchLastMessage(room, {
    lastMessageId: null,
    lastMessageAt: b.acceptedAt || new Date(),
    lastMessagePreview: "Booking accepted",
    lastMessageFrom: req.user?.uid || null,
    incrementFor: b.clientUid ? [String(b.clientUid)] : null,
  }).catch(() => null);

  const t = await Thread.findOne({ room }).catch(() => null);
  if (t) {
    if (b.clientUid) await t.addParticipant(String(b.clientUid)).catch(() => null);
    if (b.proOwnerUid) await t.addParticipant(String(b.proOwnerUid)).catch(() => null);
  }
} catch (e) {
  console.warn("[bookings:accept] ensure booking thread failed:", e?.message || e);
}


    // 🔔 Notify client that pro accepted
    try {
      if (b.clientUid) {
        await createNotification({
          toUid: b.clientUid,
          fromUid: req.user.uid,
          type: "booking_accepted",
          title: "Booking accepted",
          body:
            "Your professional accepted your booking for " +
            (b?.service?.serviceName || "a service") +
            ". You can now chat or call in the app.",
          data: {
            bookingId: b._id.toString(),
            status: b.status,
            paymentStatus: b.paymentStatus,
          },
        });
      }
    } catch (notifyErr) {
      console.warn(
        "[bookings:accept] notify client failed:",
        notifyErr?.message || notifyErr
      );
    }

    res.json({ ok: true, booking: sanitizeBookingFor(req, b) });
  } catch (err) {
    console.error("[bookings:accept] error:", err);
    res.status(500).json({ error: "Failed to accept booking" });
  }
});

/**
 * Client or Pro: complete booking.
 *
 * - Only allowed from ACCEPTED state.
 * - Either client or pro (or admin) can call it.
 * - We record who completed it in booking.meta.completedBy.
 * - Optional: completionNote / note is saved as booking.meta.completionNote.
 */
router.put("/bookings/:id/complete", requireAuth, async (req, res) => {
  try {
    const { completionNote = "", note = "" } = req.body || {};

    const b = await Booking.findById(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });

    const isClient = b.clientUid === req.user.uid;
    const isProOwner = b.proOwnerUid === req.user.uid;
    const isAdmin = isAdminReq(req);

    if (!isClient && !isProOwner && !isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Only allow completion from ACCEPTED state
    if (b.status !== "accepted") {
      return res
        .status(400)
        .json({ error: `Cannot complete when status is ${b.status}` });
    }

    if (b.paymentStatus !== "paid") {
  return res.status(400).json({ error: "Cannot complete before payment" });
}

    b.status = "completed";
    b.completedAt = new Date(); // important for auto-release scheduler

    const meta = b.meta || {};
    meta.completedBy = isClient ? "client" : isProOwner ? "pro" : "admin";
    const finalNote = (completionNote || note || "").trim();
    if (finalNote) {
      meta.completionNote = finalNote;
    }
    b.meta = meta;

    await b.save();

    // ✅ move escrow → pro pending AFTER completion (true escrow)
    try {
      await creditProPendingForBooking(b, { reason: "completed" });
    } catch (e) {
      console.error("[bookings:complete] creditProPendingForBooking failed:", e?.message || e);
    }


    // --- update Pro jobsCompleted metric, invalidate cache and emit socket update ---
    try {
      const updatedPro = await Pro.findOneAndUpdate(
        { ownerUid: b.proOwnerUid },
        { $inc: { "metrics.jobsCompleted": 1 } },
        { new: true }
      )
        .lean()
        .catch(() => null);

      // compute fallback jobsCompleted if pro metrics absent
      let newJobsCompletedCount = updatedPro?.metrics?.jobsCompleted ?? null;
      if (newJobsCompletedCount === null) {
        try {
          newJobsCompletedCount = await Booking.countDocuments({
            proOwnerUid: b.proOwnerUid,
            status: "completed",
          });
        } catch (e) {
          newJobsCompletedCount = 0;
        }
      }

      // invalidate public profile cache
      try {
        const prof = await ClientProfile.findOne({ uid: b.proOwnerUid })
          .select("username")
          .lean()
          .catch(() => null);
        if (redisClient && prof?.username) {
          await redisClient.del(
            `public:profile:${String(prof.username).toLowerCase()}`
          );
        }
      } catch (err) {
        console.warn(
          "[public/profile] invalidate after booking completion failed:",
          err?.message || err
        );
      }

      // emit socket update
      try {
        const io = getIO();
        io.to(`profile:${b.proOwnerUid}`).emit("profile:stats", {
          ownerUid: b.proOwnerUid,
          jobsCompleted: newJobsCompletedCount,
        });
      } catch (err) {
        console.warn(
          "[public/profile] socket emit after booking complete failed:",
          err?.message || err
        );
      }
    } catch (err) {
      // non-fatal: log and continue returning booking to client
      console.warn(
        "[bookings:complete] post-complete update failed:",
        err?.message || err
      );
    }

    // --- end post-complete block ---

    // 🔔 Notify both sides about completion + prompt for reviews
    try {
      const baseBody =
        "A booking for " +
        (b?.service?.serviceName || "a service") +
        " was marked as completed.";
      const completedBy = meta.completedBy || "unknown";

      // If client completed -> notify pro
      if (b.proOwnerUid && completedBy === "client") {
        await createNotification({
          toUid: b.proOwnerUid,
          fromUid: b.clientUid || null,
          type: "booking_completed",
          title: "Job completed by client",
          body:
            baseBody +
            " You can now leave a review for this client.",
          data: {
            bookingId: b._id.toString(),
            completedBy,
            completionNote: meta.completionNote || "",
            role: "pro",
          },
        });
      }

      // If pro completed -> notify client
      if (b.clientUid && completedBy === "pro") {
        await createNotification({
          toUid: b.clientUid,
          fromUid: b.proOwnerUid || null,
          type: "booking_completed",
          title: "Job completed by your professional",
          body:
            baseBody +
            " Please remember to leave a review for your professional.",
          data: {
            bookingId: b._id.toString(),
            completedBy,
            completionNote: meta.completionNote || "",
            role: "client",
          },
        });
      }

      // If admin completed -> notify both
      if (completedBy === "admin") {
        if (b.clientUid) {
          await createNotification({
            toUid: b.clientUid,
            fromUid: null,
            type: "booking_completed",
            title: "Job marked as completed",
            body:
              baseBody +
              " Our team closed this booking. You may leave a review.",
            data: {
              bookingId: b._id.toString(),
              completedBy,
              completionNote: meta.completionNote || "",
              role: "client",
            },
          });
        }
        if (b.proOwnerUid) {
          await createNotification({
            toUid: b.proOwnerUid,
            fromUid: null,
            type: "booking_completed",
            title: "Job marked as completed",
            body:
              baseBody +
              " Our team closed this booking. You may leave a review.",
            data: {
              bookingId: b._id.toString(),
              completedBy,
              completionNote: meta.completionNote || "",
              role: "pro",
            },
          });
        }
      }
    } catch (notifyErr) {
      console.warn(
        "[bookings:complete] notify failed:",
        notifyErr?.message || notifyErr
      );
    }

    res.json({ ok: true, booking: sanitizeBookingFor(req, b) });
  } catch (err) {
    console.error("[bookings:complete] error:", err);
    res.status(500).json({ error: "Failed to complete booking" });
  }
});


export default router;
