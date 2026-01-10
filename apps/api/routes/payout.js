// apps/api/routes/payout.js
import express from "express";
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { withdrawPendingWithFee } from "../services/walletService.js";
import { WalletTx } from "../models/wallet.js";

export default function payoutRoutes({ requireAuth, Application }) {
  const router = express.Router();
  const t = (v) => String(v ?? "").trim();

  // ----------------------------
  // 1) Save/update payout bank details for the signed-in user
  // ----------------------------
  router.put("/payout/me", requireAuth, async (req, res) => {
    try {
      const accountNumber = t(req.body?.accountNumber);
      const bankCode = t(req.body?.bankCode);
      const bankName = t(req.body?.bankName);
      const accountName = t(req.body?.accountName);

      if (!accountNumber || !bankCode || !bankName || !accountName) {
        return res.status(400).json({ error: "all_fields_required" });
      }

      const doc = await Application.findOneAndUpdate(
        { uid: req.user.uid },
        {
          $set: {
            "payoutBank.accountNumber": accountNumber,
            "payoutBank.code": bankCode,
            "payoutBank.name": bankName,
            "payoutBank.accountName": accountName,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      return res.json({ ok: true, payoutBank: doc?.payoutBank || null });
    } catch (err) {
      console.error("[payout/me] error:", err);
      return res.status(500).json({ error: "server_error" });
    }
  });

  // ----------------------------
  // 2) Pro instant cashout (Pending -> Available) for a specific booking
  //    - True escrow: pro gets pending ONLY after COMPLETED (already in bookings.js)
  //    - Hold: 3 days after completion (configurable)
  //    - Fee: 3% (already in Settings as payouts.instantCashoutFeePercent)
  // ----------------------------
    router.post("/payouts/instant-cashout/:bookingId", requireAuth, async (req, res) => {
    try {
      const bookingId = String(req.params.bookingId || "").trim();
      if (!/^[0-9a-fA-F]{24}$/.test(bookingId)) {
        return res.status(400).json({ error: "invalid_booking_id" });
      }

      const booking = await Booking.findById(bookingId).lean();
      if (!booking) return res.status(404).json({ error: "booking_not_found" });

      // pro-only: must own this booking
      if (String(booking.proOwnerUid || "") !== String(req.user.uid)) {
        return res.status(403).json({ error: "not_your_booking" });
      }

      // must be paid + completed
      if (booking.paymentStatus !== "paid") return res.status(400).json({ error: "not_paid" });
      if (booking.status !== "completed") return res.status(400).json({ error: "not_completed" });

      // idempotency: already cashed out?
      if (booking?.meta?.instantCashout === true) {
        return res.json({ ok: true, alreadyCashedOut: true });
      }

      // safety hold (default 3 days)
      const Settings = mongoose.models.Settings;
      const s = Settings ? await Settings.findOne().lean() : null;
      const holdDays = Number(s?.payouts?.instantCashoutHoldDays ?? 3);
      const cutoff = Date.now() - holdDays * 24 * 60 * 60 * 1000;

      const completedAtMs = booking.completedAt ? new Date(booking.completedAt).getTime() : 0;
      if (!completedAtMs || completedAtMs > cutoff) {
        return res.status(400).json({
          error: "hold_active",
          message: `Instant cashout available after ${holdDays} day(s) from completion.`,
        });
      }

      // ✅ pull exact amount credited for THIS booking (no guessing)
      const fundTx = await WalletTx.findOne({
        ownerUid: req.user.uid,
        type: "booking_fund",
        "meta.bookingId": booking._id.toString(),
      })
        .sort({ createdAt: 1 })
        .lean();

      const creditedKobo = Math.floor(Number(fundTx?.amountKobo || 0));
      if (!creditedKobo || creditedKobo <= 0) {
        return res.status(400).json({ error: "not_funded_yet" });
      }

      // ✅ strong idempotency: block if already cashed out in ledger
      const already = await WalletTx.findOne({
        ownerUid: req.user.uid,
        type: "withdraw_pending",
        "meta.bookingId": booking._id.toString(),
        "meta.reason": "instant_cashout",
      }).lean();

      if (already) {
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { payoutReleased: true, "meta.instantCashout": true, "meta.instantCashoutAt": new Date() } }
        );
        return res.json({ ok: true, alreadyCashedOut: true });
      }

      // ✅ perform the move: Pending → Available (minus fee)
      const result = await withdrawPendingWithFee(req.user.uid, creditedKobo, {
        bookingId: booking._id.toString(),
        reason: "instant_cashout",
      });

      // lock booking so auto-release cron won’t touch it later
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: {
            payoutReleased: true,
            "meta.instantCashout": true,
            "meta.instantCashoutAt": new Date(),
            "meta.instantCashoutFeeKobo": result?.feeKobo ?? 0,
            "meta.instantCashoutNetKobo": result?.creditedAvailableKobo ?? 0,
          },
        }
      );

      return res.json({
        ok: true,
        bookingId: booking._id.toString(),
        ...result,
      });
    } catch (e) {
      console.error("[payouts/instant-cashout] error:", e?.message || e);
      return res.status(500).json({ error: "instant_cashout_failed" });
    }
  });

  return router;
}
