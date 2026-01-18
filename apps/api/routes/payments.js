// apps/api/routes/payments.js
import express from "express";
import fetch from "node-fetch"; // ✅ ensure fetch is available (consistent with other files)
import { Booking } from "../models/Booking.js";
import { getIO } from "../sockets/index.js";
import crypto from "crypto";
import { PaymentSession } from "../models/PaymentSession.js";
import { fundEscrowFromPaystackForBooking } from "../services/walletService.js";
import { createNotification } from "../services/notificationService.js";

function makeState() {
  return crypto.randomBytes(18).toString("hex"); // 36 chars
}

// Allow callbackUrl only if it matches your CORS allow-list policy (plus vercel previews if enabled)
function callbackAllowed(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.host;

    const allow = (process.env.CORS_ORIGIN || "http://localhost:5173")
      .split(/[,\s]+/g)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const o of allow) {
      try {
        if (new URL(o).host === host) return true;
      } catch {}
    }

    if ((process.env.ALLOW_VERCEL_PREVIEWS || "true") !== "false") {
      if (host.endsWith(".vercel.app")) return true;
    }
  } catch {}
  return false;
}

/**
 * Export a router factory so we can inject requireAuth from the host app.
 * Usage in server.js: app.use("/api", paymentsRouter({ requireAuth }))
 */
export default function paymentsRouter({ requireAuth }) {
  const router = express.Router();

  /** Init (for redirect fallback) */
  router.post("/payments/init", requireAuth, async (req, res) => {
    try {
      const { bookingId, email, callbackUrl } = req.body || {};
      if (!bookingId) {
        return res.status(400).json({ error: "bookingId required" });
      }

      const booking = await Booking.findById(bookingId);
      if (!booking) return res.status(404).json({ error: "booking_not_found" });

      // 🔒 Only the booking owner can init payment
      if (String(booking.clientUid) !== String(req.user.uid)) {
        return res.status(403).json({ error: "not_your_booking" });
      }

      // 🔒 Guard: prevent mixing payment methods
      const requested = String(
        booking?.meta?.paymentMethodRequested || ""
      ).toLowerCase();
      if (requested === "wallet") {
        return res.status(400).json({
          error: "wallet_only_booking",
          message:
            "This booking was created for wallet payment. Please pay from wallet.",
        });
      }

      // ✅ Always bill the real booking amount (never trust client body)
      const amountKobo = Math.floor(Number(booking.amountKobo || 0));
      if (!amountKobo || amountKobo <= 0) {
        return res.status(400).json({ error: "invalid_booking_amount" });
      }

      const reference = `BOOKING-${booking._id}-${Date.now()}`;

      const state = makeState();

      // Determine where Paystack should return the user
      let base = "";

      // 1) Prefer client-provided callbackUrl (must be allowed)
      if (callbackUrl && callbackAllowed(callbackUrl)) {
        base = String(callbackUrl).trim();
      }

      // 2) Fallback to backend env if provided
      if (!base && process.env.FRONTEND_ORIGIN) {
        base = String(process.env.FRONTEND_ORIGIN).trim();
      }

      base = base.replace(/\/+$/, "");

      if (!base) {
        return res.status(500).json({
          error: "callback_url_missing",
          message:
            "Provide callbackUrl from frontend (recommended for previews) or set FRONTEND_ORIGIN in backend env.",
        });
      }

      // If caller passed full path (/payment/confirm), keep it.
      // Else assume base is origin and append the route.
      const callback_url = base.includes("/payment/confirm")
        ? `${base}?state=${encodeURIComponent(state)}`
        : `${base}/payment/confirm?state=${encodeURIComponent(state)}`;

      // Save PaymentSession so confirm works even if user returns in a different browser/app context
      await PaymentSession.create({
        state,
        kind: "booking_card",
        bookingId: booking._id,
        reference,
        clientUid: String(booking.clientUid),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000), // 20 minutes
      });

      if (!process.env.PAYSTACK_SECRET_KEY) {
        return res.status(500).json({ error: "paystack_secret_missing" });
      }

      const initResp = await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email || req.user.email || "customer@example.com",
            amount: amountKobo,
            reference,
            callback_url,
            metadata: {
              bookingId: String(booking._id),
              clientUid: String(booking.clientUid || ""),
              custom_fields: [
                {
                  display_name: "Booking",
                  variable_name: "bookingId",
                  value: String(booking._id),
                },
              ],
            },
          }),
        }
      );

      const initJson = await initResp.json();
      if (
        !initResp.ok ||
        !initJson?.status ||
        !initJson?.data?.authorization_url
      ) {
        return res.status(400).json({
          error: "init_failed",
          details: initJson?.message || "unknown_error",
        });
      }

      booking.paystackReference = initJson?.data?.reference || reference;
      if (booking.paymentStatus !== "paid") {
        booking.paymentStatus = "pending";
        booking.status =
          booking.status === "scheduled" ? booking.status : "pending_payment";
      }
      await booking.save();

      return res.json({
        authorization_url: initJson.data.authorization_url,
        reference: booking.paystackReference, // always defined now
        state,
      });
    } catch (e) {
      console.error("[payments/init] error:", e);
      res.status(500).json({ error: "init_error" });
    }
  });

  // Confirm (post-redirect) — DOES NOT REQUIRE AUTH
  // Uses state token so it works even if Paystack returns in a different browser/app context.
  router.post("/payments/confirm", async (req, res) => {
    try {
      const state = String(req.body?.state || "").trim();
      if (!state) return res.status(400).json({ error: "state_required" });

      if (!process.env.PAYSTACK_SECRET_KEY) {
        return res.status(500).json({ error: "paystack_secret_missing" });
      }

      const sess = await PaymentSession.findOne({ state });
      if (!sess) return res.status(404).json({ error: "session_not_found" });

      // expiry
      if (sess.expiresAt && new Date(sess.expiresAt).getTime() < Date.now()) {
        return res.status(400).json({ error: "session_expired" });
      }

      // idempotent — but still repair escrow if it was missed earlier
      if (sess.usedAt) {
        try {
          const booking = await Booking.findById(sess.bookingId);
          if (booking) {
            // ensure booking has ringingStartedAt (optional repair)
            if (booking.paymentStatus === "paid" && !booking.ringingStartedAt) {
              booking.ringingStartedAt = new Date();
              await booking.save();
            }

            // repair escrow (idempotent)
            if (booking.paymentStatus === "paid") {
              await fundEscrowFromPaystackForBooking(booking, {
                reference: sess.reference,
              });
            }
          }
        } catch (e) {
          console.warn(
            "[payments/confirm] (alreadyConfirmed) repair failed:",
            e?.message || e
          );
        }

        return res.json({
          ok: true,
          status: "success",
          bookingId: String(sess.bookingId),
          alreadyConfirmed: true,
        });
      }

      const booking = await Booking.findById(sess.bookingId);
      if (!booking) return res.status(404).json({ error: "booking_not_found" });

      // Guard: do not confirm cancelled/refunded
      if (
        booking.status === "cancelled" ||
        booking.paymentStatus === "refunded"
      ) {
        return res.status(400).json({ error: "booking_not_payable" });
      }

      // Verify Paystack using server-stored reference (NOT from client)
      const r = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(
          sess.reference
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

      // amount check
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

      // finalize booking (idempotent)
      booking.meta = booking.meta || {};
      booking.meta.paymentMethodUsed = "card";
      booking.meta.paymentMethodRequested =
        booking.meta.paymentMethodRequested || "card";

      booking.paymentStatus = "paid";
      if (booking.status === "pending_payment") booking.status = "scheduled";
      booking.paystackReference = sess.reference;

      if (!booking.ringingStartedAt) booking.ringingStartedAt = new Date();
      await booking.save();

      // fund escrow ledger (idempotent)
      try {
        await fundEscrowFromPaystackForBooking(booking, {
          reference: sess.reference,
        });
      } catch (e) {
        console.error(
          "[payments/confirm] fundEscrowFromPaystackForBooking failed:",
          e?.message || e
        );
        // fail-soft to avoid trapping users after Paystack success
      }

      // notify pro (idempotent)
      try {
        booking.meta = booking.meta || {};
        if (!booking.meta.notifiedProOnPaid) {
          if (booking.proOwnerUid) {
            await createNotification({
              toUid: booking.proOwnerUid,
              fromUid: booking.clientUid || null,
              type: "booking_paid",
              title: "New paid booking",
              body: "A client has paid. Please accept or decline in the app.",
              data: {
                bookingId: booking._id.toString(),
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                paymentMethod: "card",
                source: "payments_confirm",
              },
            });
          }
          booking.meta.notifiedProOnPaid = true;
          await booking.save();
        }
      } catch (e) {
        console.warn("[payments/confirm] notify pro failed:", e?.message || e);
      }

      // sockets (best-effort)
      try {
        const io = getIO();
        if (io) {
          const payload = {
            bookingId: booking._id.toString(),
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            proOwnerUid: booking.proOwnerUid,
            clientUid: booking.clientUid,
          };
          if (booking.proOwnerUid)
            io.to(`user:${booking.proOwnerUid}`).emit("booking:paid", payload);
          if (booking.clientUid)
            io.to(`user:${booking.clientUid}`).emit("booking:paid", payload);
          io.to(`booking:${booking._id.toString()}`).emit(
            "booking:paid",
            payload
          );
        }
      } catch {}

      // mark session used
      sess.usedAt = new Date();
      await sess.save();

      return res.json({
        ok: true,
        status: "success",
        bookingId: booking._id.toString(),
      });
    } catch (e) {
      console.error("[payments/confirm] error:", e);
      return res.status(500).json({ error: "confirm_failed" });
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
      if (
        booking.status === "cancelled" ||
        booking.paymentStatus === "refunded"
      ) {
        return res.status(400).json({ error: "booking_not_payable" });
      }

      // 🔒 Only the booking owner can verify
      if (String(booking.clientUid) !== String(req.user.uid)) {
        return res.status(403).json({ error: "not_your_booking" });
      }

      // 🔒 Guard: prevent mixing payment methods
      const requested = String(
        booking?.meta?.paymentMethodRequested || ""
      ).toLowerCase();
      if (requested === "wallet") {
        return res.status(400).json({
          error: "wallet_only_booking",
          message:
            "This booking was created for wallet payment. Please pay from wallet.",
        });
      }

      // ✅ Use server-stored reference as canonical (prevents client sending a random reference)
      if (
        booking.paystackReference &&
        booking.paystackReference !== reference
      ) {
        return res.status(400).json({
          error: "reference_mismatch",
          expected: booking.paystackReference,
        });
      }

      if (
        booking.paymentStatus === "paid" &&
        booking.paystackReference === reference
      ) {
        // ✅ repair missing ringingStartedAt (idempotent)
        if (!booking.ringingStartedAt) {
          booking.ringingStartedAt = new Date();
          await booking.save();
        }

        // ✅ CRITICAL: repair escrow if it was missed earlier (idempotent)
        try {
          await fundEscrowFromPaystackForBooking(booking, { reference });
        } catch (e) {
          console.error(
            "[payments/verify] (alreadyPaid) fundEscrowFromPaystackForBooking failed:",
            e?.message || e
          );
        }

        // ✅ Always re-emit booking:paid (idempotent) so pro alert is still instant on retries
        try {
          const io = getIO();
          if (io) {
            const payload = {
              bookingId: booking._id.toString(),
              status: booking.status,
              paymentStatus: booking.paymentStatus,
              proOwnerUid: booking.proOwnerUid,
              clientUid: booking.clientUid,
            };

            if (booking.proOwnerUid)
              io.to(`user:${booking.proOwnerUid}`).emit(
                "booking:paid",
                payload
              );
            if (booking.clientUid)
              io.to(`user:${booking.clientUid}`).emit("booking:paid", payload);
            io.to(`booking:${booking._id.toString()}`).emit(
              "booking:paid",
              payload
            );
          }
        } catch {}

        return res.json({ ok: true, status: "success", alreadyPaid: true });
      }

      booking.meta = booking.meta || {};
      booking.meta.paymentMethodUsed = "card";
      booking.meta.paymentMethodRequested =
        booking.meta.paymentMethodRequested || "card";

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
        console.error(
          "[payments/verify] fundEscrowFromPaystackForBooking failed:",
          e?.message || e
        );
        // Decide your policy:
        // - If you want to be strict: return 500 and treat payment as not finalized
        // - If you want to be fail-soft: continue (booking is paid, but escrow ledger missing)
        //
        // I recommend FAIL-SOFT for now so users don't get stuck after Paystack success.
      }

      // ✅ Notify pro ONLY after payment is confirmed (idempotent)
      try {
        if (!booking.meta.notifiedProOnPaid) {
          if (booking.proOwnerUid) {
            await createNotification({
              toUid: booking.proOwnerUid,
              fromUid: booking.clientUid || null,
              type: "booking_paid",
              title: "New paid booking",
              body: "A client has paid. Please accept or decline in the app.",
              data: {
                bookingId: booking._id.toString(),
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                paymentMethod: "card",
                source: "payments_verify",
              },
            });
          }

          booking.meta.notifiedProOnPaid = true;
          await booking.save();
        }
      } catch (e) {
        console.warn("[payments/verify] notify pro failed:", e?.message || e);
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

        io.to(`booking:${booking._id.toString()}`).emit(
          "booking:paid",
          payload
        );
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
