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
      const { bookingId, amountKobo, email } = req.body || {};
      if (!bookingId || !amountKobo) {
        return res.status(400).json({ error: "bookingId and amountKobo required" });
      }
      if (!process.env.PAYSTACK_SECRET_KEY) {
        return res.status(500).json({ error: "paystack_secret_missing" });
      }

      const booking = await Booking.findById(bookingId);
      if (!booking) return res.status(404).json({ error: "booking_not_found" });

      const initResp = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email || req.user.email || "customer@example.com",
          amount: Number(amountKobo), // kobo
          reference: `BOOKING-${booking._id}`,
          metadata: {
            custom_fields: [
              { display_name: "Booking", variable_name: "bookingId", value: String(booking._id) }
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

      booking.paystackReference = initJson.data.reference || `BOOKING-${booking._id}`;
      if (booking.paymentStatus !== "paid") {
        booking.paymentStatus = "pending";
        booking.status = booking.status === "scheduled" ? booking.status : "pending_payment";
      }
      await booking.save();

      return res.json({
        authorization_url: initJson.data.authorization_url,
        reference: initJson.data.reference,
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



      if (booking.amountKobo && Number(amount) !== Number(booking.amountKobo)) {
        console.warn(
          "[paystack] amount mismatch",
          amount,
          "vs",
          booking.amountKobo
        );
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
