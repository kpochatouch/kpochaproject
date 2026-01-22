// apps/api/routes/payout.js
import express from "express";
import mongoose from "mongoose";
import fetch from "node-fetch";
import { Booking } from "../models/Booking.js";
import { withdrawPendingWithFee } from "../services/walletService.js";
import { WalletTx } from "../models/wallet.js";

export default function payoutRoutes({ requireAuth, Application }) {
  const router = express.Router();
  const t = (v) => String(v ?? "").trim();

  // ----------------------------
  // BANKS (NG) - for dropdown (Paystack)
  // ----------------------------
  router.get("/banks/ng", async (_req, res) => {
    try {
      const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({ error: "paystack_not_configured" });
      }

      const r = await fetch(
        "https://api.paystack.co/bank?currency=NGN&enabled_for_verification=true&perPage=200",
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
      );

      const j = await r.json();
      if (!r.ok || !j?.status) {
        return res.status(502).json({
          error: "banks_fetch_failed",
          details: j?.message || "paystack_error",
        });
      }

      const items = (j.data || [])
        .map((b) => ({ name: b.name, code: b.code }))
        .filter((x) => x.name && x.code);

      res.set("Cache-Control", "public, max-age=3600");
      return res.json({ ok: true, items });
    } catch (e) {
      console.error("[banks/ng] error:", e?.message || e);
      return res.status(500).json({ error: "banks_fetch_failed" });
    }
  });

  // ----------------------------
  // 1) Save/update payout bank details (CANONICAL: Application.payoutBank)
  // - client sends: accountNumber + bankCode
  // - server verifies: resolves accountName
  // - server creates recipient + stores recipientCode for later withdrawals
  // ----------------------------
  router.put("/payout/me", requireAuth, async (req, res) => {
    try {
      const accountNumber = t(req.body?.accountNumber);
      const bankCode = t(req.body?.bankCode);

      if (!/^\d{10}$/.test(accountNumber)) {
        return res.status(400).json({ error: "invalid_account_number" });
      }
      if (!bankCode) {
        return res.status(400).json({ error: "bankCode_required" });
      }

      const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({ error: "paystack_not_configured" });
      }

      // 1) Resolve account name (Paystack)
      const vr = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(
          accountNumber,
        )}&bank_code=${encodeURIComponent(bankCode)}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
      );
      const vj = await vr.json();
      if (!vr.ok || !vj?.status) {
        return res.status(400).json({
          error: "account_resolve_failed",
          details: vj?.message || "resolve_failed",
        });
      }

      const accountName = t(vj?.data?.account_name);
      if (!accountName) {
        return res.status(400).json({ error: "account_name_missing" });
      }

      // 2) Reuse existing recipientCode if same bank details; otherwise create once
      const existing = await Application.findOne({ uid: req.user.uid }).lean();
      const existingPB = existing?.payoutBank || {};

      let recipientCode = t(existingPB?.recipientCode);

      const sameDetails =
        t(existingPB?.accountNumber) === accountNumber &&
        t(existingPB?.code) === bankCode;

      if (!recipientCode || !sameDetails) {
        const rr = await fetch("https://api.paystack.co/transferrecipient", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "nuban",
            name: accountName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency: "NGN",
          }),
        });

        const rj = await rr.json();
        if (!rr.ok || !rj?.status) {
          return res.status(502).json({
            error: "recipient_create_failed",
            details: rj?.message || "recipient_failed",
          });
        }

        recipientCode = t(rj?.data?.recipient_code);
      }

      const doc = await Application.findOneAndUpdate(
        { uid: req.user.uid },
        {
          $set: {
            "payoutBank.accountNumber": accountNumber,
            "payoutBank.code": bankCode,
            "payoutBank.accountName": accountName,
            "payoutBank.recipientCode": recipientCode,
            "payoutBank.verifiedAt": new Date(),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      return res.json({ ok: true, payoutBank: doc?.payoutBank || null });
    } catch (err) {
      console.error("[payout/me] error:", err);
      return res.status(500).json({ error: "server_error" });
    }
  });

  // ✅ Debug: confirm what withdraw sees (Application.payoutBank)
  router.get("/payout/me", requireAuth, async (req, res) => {
    try {
      const doc = await Application.findOne({ uid: req.user.uid }).lean();
      return res.json({ ok: true, payoutBank: doc?.payoutBank || null });
    } catch (e) {
      return res.status(500).json({ error: "server_error" });
    }
  });

  // ----------------------------
  // 2) Pro instant cashout (Pending -> Available) for a specific booking
  //    - True escrow: pro gets pending ONLY after COMPLETED (already in bookings.js)
  //    - Hold: 3 days after completion (configurable)
  //    - Fee: 3% (already in Settings as payouts.instantCashoutFeePercent)
  // ----------------------------
  router.post(
    "/payouts/instant-cashout/:bookingId",
    requireAuth,
    async (req, res) => {
      try {
        const bookingId = String(req.params.bookingId || "").trim();
        if (!/^[0-9a-fA-F]{24}$/.test(bookingId)) {
          return res.status(400).json({ error: "invalid_booking_id" });
        }

        const booking = await Booking.findById(bookingId).lean();
        if (!booking)
          return res.status(404).json({ error: "booking_not_found" });

        // pro-only: must own this booking
        if (String(booking.proOwnerUid || "") !== String(req.user.uid)) {
          return res.status(403).json({ error: "not_your_booking" });
        }

        // must be paid + completed
        if (booking.paymentStatus !== "paid")
          return res.status(400).json({ error: "not_paid" });
        if (booking.status !== "completed")
          return res.status(400).json({ error: "not_completed" });

        // idempotency: already cashed out?
        if (booking?.meta?.instantCashout === true) {
          return res.json({ ok: true, alreadyCashedOut: true });
        }

        // safety hold (default 3 days)
        const Settings = mongoose.models.Settings;
        const s = Settings ? await Settings.findOne().lean() : null;
        const holdDays = Number(s?.payouts?.instantCashoutHoldDays ?? 3);
        const cutoff = Date.now() - holdDays * 24 * 60 * 60 * 1000;

        const completedAtMs = booking.completedAt
          ? new Date(booking.completedAt).getTime()
          : 0;
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
            {
              $set: {
                payoutReleased: true,
                "meta.instantCashout": true,
                "meta.instantCashoutAt": new Date(),
              },
            },
          );
          return res.json({ ok: true, alreadyCashedOut: true });
        }

        // ✅ perform the move: Pending → Available (minus fee)
        const result = await withdrawPendingWithFee(
          req.user.uid,
          creditedKobo,
          {
            bookingId: booking._id.toString(),
            reason: "instant_cashout",
          },
        );

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
          },
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
    },
  );

  return router;
}
