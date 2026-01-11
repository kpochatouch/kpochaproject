// apps/api/routes/payments.js
import express from "express";
import fetch from "node-fetch"; // ✅ ensure fetch is available (consistent with other files)
import { Booking } from "../models/Booking.js";
import { getIO } from "../sockets/index.js";
import { fundEscrowFromPaystackForBooking } from "../services/walletService.js";

/**
 * Export a router factory so we can inject requireAuth from the host app.
 * Usage in server.js: app.use("/api", paymentsRouter({ requireAuth }))
 */
export default function paymentsRouter({ requireAuth }) {
  const router = express.Router();

  /** Init (for redirect fallback) */
  router.post("/payments/init", requireAuth, async (req, res) => {
    try {
      const { bookingId, email } = req.body || {};
if (!bookingId) {
  return res.status(400).json({ error: "bookingId required" });
}

const booking = await Booking.findById(bookingId);
if (!booking) return res.status(404).json({ error: "booking_not_found" });

// 🔒 Only the booking owner can init payment
if (String(booking.clientUid) !== String(req.user.uid)) {
  return res.status(403).json({ error: "not_your_booking" });
}

// ✅ Always bill the real booking amount (never trust client body)
const amountKobo = Math.floor(Number(booking.amountKobo || 0));
if (!amountKobo || amountKobo <= 0) {
  return res.status(400).json({ error: "invalid_booking_amount" });
}

const reference = `BOOKING-${booking._id}-${Date.now()}`;

if (!process.env.PAYSTACK_SECRET_KEY) {
  return res.status(500).json({ error: "paystack_secret_missing" });
}

const initResp = await fetch("https://api.paystack.co/transaction/initialize", {

  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: email || req.user.email || "customer@example.com",
    amount: amountKobo,
    reference,
    metadata: {
      bookingId: String(booking._id),
      clientUid: String(booking.clientUid || ""),
      custom_fields: [
        { display_name: "Booking", variable_name: "bookingId", value: String(booking._id) },
      ],
    },
  }),
});


      const initJson = await initResp.json();
      if (!initResp.ok || !initJson?.status || !initJson?.data?.authorization_url) {
        return res.status(400).json({
          error: "init_failed",
          details: initJson?.message || "unknown_error",
        });
      }

      booking.paystackReference = initJson?.data?.reference || reference;
      if (booking.paymentStatus !== "paid") {
        booking.paymentStatus = "pending";
        booking.status = booking.status === "scheduled" ? booking.status : "pending_payment";
      }
      await booking.save();

      return res.json({
      authorization_url: initJson.data.authorization_url,
      reference: booking.paystackReference, // always defined now
    });

    } catch (e) {
      console.error("[payments/init] error:", e);
      res.status(500).json({ error: "init_error" });
    }
  });

    /** Verify (used by inline & post-redirect confirmation) — authenticated */
  router.post("/payments/verify", requireAuth, async (req, res) => {
    try {
      const { bookingId, reference } = req.body || {};
      if (!bookingId || !reference) {
        return res
          .status(400)
          .json({ error: "bookingId and reference required" });
      }
      if (!process.env.PAYSTACK_SECRET_KEY) {
        return res.status(500).json({ error: "paystack_secret_missing" });
      }

      const r = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(
          reference
        )}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const verify = await r.json();

      const status = verify?.data?.status;
      const amount = verify?.data?.amount;
      if (status !== "success") {
        return res.json({ ok: false, status: status || "unknown" });
      }

      const booking = await Booking.findById(bookingId);
      if (!booking) {
        return res.status(404).json({ error: "booking_not_found" });
      }


      // ✅ Guard: don’t allow paying for cancelled/refunded bookings
      if (booking.status === "cancelled" || booking.paymentStatus === "refunded") {
        return res.status(400).json({ error: "booking_not_payable" });
      }

       // 🔒 Only the booking owner can verify
      if (String(booking.clientUid) !== String(req.user.uid)) {
        return res.status(403).json({ error: "not_your_booking" });
      }

      // ✅ Use server-stored reference as canonical (prevents client sending a random reference)
      if (booking.paystackReference && booking.paystackReference !== reference) {
        return res.status(400).json({
          error: "reference_mismatch",
          expected: booking.paystackReference,
        });
      }


        if (
        booking.paymentStatus === "paid" &&
        booking.paystackReference === reference
      ) {
        if (!booking.ringingStartedAt) {
          booking.ringingStartedAt = new Date();
          await booking.save();
        }
        return res.json({ ok: true, status: "success", alreadyPaid: true });
      }



      const expected = Math.floor(Number(booking.amountKobo || 0));
      const paid = Math.floor(Number(amount || 0));

      if (!expected || expected <= 0) {
        return res.status(400).json({ error: "invalid_booking_amount" });
      }

      if (paid !== expected) {
        return res.status(400).json({
          error: "amount_mismatch",
          expectedKobo: expected,
          paidKobo: paid,
        });
      }


      booking.paymentStatus = "paid";
      if (booking.status === "pending_payment") booking.status = "scheduled";
      booking.paystackReference = reference;

      // ✅ mark ringing start (used by ring-timeout cron)
      if (!booking.ringingStartedAt) booking.ringingStartedAt = new Date();

      await booking.save();


      // ✅ Fund platform escrow ledger for CARD payments (idempotent)
try {
  await fundEscrowFromPaystackForBooking(booking, { reference });
} catch (e) {
  console.error("[payments/verify] fundEscrowFromPaystackForBooking failed:", e?.message || e);
  // Decide your policy:
  // - If you want to be strict: return 500 and treat payment as not finalized
  // - If you want to be fail-soft: continue (booking is paid, but escrow ledger missing)
  //
  // I recommend FAIL-SOFT for now so users don't get stuck after Paystack success.
}


      // 🔔 Notify both pro + client in real-time that payment is confirmed
      try {
        const io = getIO();
        if (!io) throw new Error("io_not_ready");

        const payload = {
          bookingId: booking._id.toString(),
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          proOwnerUid: booking.proOwnerUid,
          clientUid: booking.clientUid,
        };

        if (booking.proOwnerUid) {
          io.to(`user:${booking.proOwnerUid}`).emit("booking:paid", payload);
        }
        if (booking.clientUid) {
          io.to(`user:${booking.clientUid}`).emit("booking:paid", payload);
        }

        io.to(`booking:${booking._id.toString()}`).emit("booking:paid", payload);
      } catch (err) {
        console.warn(
          "[payments/verify] socket emit booking:paid failed:",
          err?.message || err
        );
      }

      return res.json({ ok: true, status: "success" });
    } catch (e) {
      console.error("[payments/verify] error:", e);
      return res.status(500).json({ error: "verify_failed" });
    }
  });

  return router;
}
