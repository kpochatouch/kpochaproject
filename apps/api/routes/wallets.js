// apps/api/routes/wallets.js
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import fetch from "node-fetch";
import { Application } from "../models.js";
import { Wallet, WalletTx } from "../models/wallet.js";
import { Booking } from "../models/Booking.js";
import {
  getOrCreateWallet,
  holdFundsInEscrowForBooking,
  // Option A escrow: for pay-booking we must NOT credit pro pending here anymore
} from "../services/walletService.js";
import { createNotification } from "../services/notificationService.js";
import { getIO } from "../sockets/index.js";

/* ----------------------------- helpers ----------------------------- */
const isPosInt = (n) => Number.isInteger(n) && n > 0;
const koboInt = (v) => Math.round(Number(v || 0)) || 0;

async function ensureWallet(uid) {
  return getOrCreateWallet(uid);
}

async function verifyPinForUid(uid, pin) {
  const appDoc = await Application.findOne({ uid }).lean();
  if (!appDoc?.withdrawPinHash) return { ok: false, code: "no_pin" };
  const ok = await bcrypt.compare(
    String(pin || ""),
    String(appDoc.withdrawPinHash || "")
  );
  return { ok, code: ok ? "ok" : "invalid_pin" };
}

function requirePaystackKey(res) {
  const key = process.env.PAYSTACK_SECRET_KEY || "";
  if (!key) {
    res.status(500).json({ error: "paystack_not_configured" });
    return null;
  }
  return key;
}

function makeTopupReference(uid) {
  return `TOPUP-${uid}-${Date.now()}`;
}

/* ------------------------------------------------------------------ */
export function withAuth(requireAuth, requireAdmin) {
  const router = express.Router();

  /* ======================= CLIENT FUNDING ENDPOINTS ======================= */

  /**
   * GET /api/wallet/client/me
   * - For client Wallet screen (balance usable for bookings + activity feed)
   */
  router.get("/wallet/client/me", requireAuth, async (req, res) => {
    try {
      const w = await ensureWallet(req.user.uid);
      // Return last 50, newest first (consistent with your ClientWallet page)
      const tx = await WalletTx.find({ ownerUid: req.user.uid })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      res.json({
        creditsKobo: Number(w.availableKobo || 0),
        transactions: tx.map((t) => ({
          id: String(t._id),
          type: t.type,
          direction: t.direction, // "credit" | "debit"
          amountKobo: t.amountKobo,
          ts: t.createdAt,
          meta: t.meta || {},
        })),
      });
    } catch (e) {
      console.error("[wallet/client/me] error:", e);
      res.status(500).json({ error: "wallet_load_failed" });
    }
  });

  /**
   * GET /api/wallet/topup/init
   * Query: amountKobo, callbackUrl?
   * - Initializes a Paystack *redirect* checkout (fallback if inline fails).
   * - Records a 'topup_init' txn with the reference (for traceability).
   * Returns: { authorization_url, reference }
   */
  router.get("/wallet/topup/init", requireAuth, async (req, res) => {
    try {
      const amt = koboInt(req.query.amountKobo);
      const callbackUrl = req.query.callbackUrl;
      if (!isPosInt(amt))
        return res.status(400).json({ error: "amount_invalid" });

      const PAYSTACK_SECRET_KEY = requirePaystackKey(res);
      if (!PAYSTACK_SECRET_KEY) return;

      const w = await ensureWallet(req.user.uid);
      const reference = makeTopupReference(req.user.uid);

      await WalletTx.create({
        ownerUid: req.user.uid,
        type: "topup_init",
        direction: "neutral",
        amountKobo: 0,
        balancePendingKobo: Number(w.pendingKobo || 0),
        balanceAvailableKobo: Number(w.availableKobo || 0),
        meta: {
          reference,
          status: "init",
          amountKobo: amt, // intended amount (real topup)
        },
      });

      // Init Paystack
      const psResp = await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: req.user.email || "customer@example.com",
            amount: amt,
            reference,
            callback_url:
              callbackUrl ||
              process.env.PAYSTACK_WALLET_CALLBACK_URL ||
              undefined,
            metadata: {
              type: "wallet_topup",
              ownerUid: req.user.uid,
            },
          }),
        }
      );
      const data = await psResp.json();
      if (!psResp.ok || !data?.status || !data?.data?.authorization_url) {
        console.error("[wallet/topup/init] paystack init failed:", data);

        // 🔧 mark the init tx as failed (best-effort)
        try {
          await WalletTx.updateOne(
            {
              ownerUid: req.user.uid,
              type: "topup_init",
              "meta.reference": reference,
            },
            {
              $set: {
                "meta.status": "failed",
                "meta.error": data?.message || "init_failed",
              },
            }
          );
        } catch {}

        return res.status(502).json({ error: "paystack_init_failed" });
      }

      res.json({
        authorization_url: data.data.authorization_url,
        reference,
      });
    } catch (e) {
      console.error("[wallet/topup/init] error:", e);
      res.status(500).json({ error: "topup_init_failed" });
    }
  });

  /**
   * GET /api/wallet/topup/verify
   * Query: reference
   * - Verifies a Paystack reference and credits the wallet exactly once.
   * Returns: { ok: true, credited: boolean, creditsKobo }
   */
  router.get("/wallet/topup/verify", requireAuth, async (req, res) => {
    try {
      const reference = req.query.reference;
      if (!reference)
        return res.status(400).json({ error: "reference_required" });

      const PAYSTACK_SECRET_KEY = requirePaystackKey(res);
      if (!PAYSTACK_SECRET_KEY) return;

      // Verify on Paystack
      const vResp = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(
          reference
        )}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
      );
      const verify = await vResp.json();
      if (!vResp.ok || !verify?.status) {
        console.error("[wallet/topup/verify] paystack verify failed:", verify);
        return res.status(502).json({ error: "paystack_verify_failed" });
      }

      const ps = verify.data || {};
      if (ps.status !== "success") {
        return res
          .status(400)
          .json({ error: "payment_not_successful", status: ps.status });
      }

      // Amount is in kobo
      const paidKobo = koboInt(ps.amount);
      if (!isPosInt(paidKobo)) {
        return res.status(400).json({ error: "amount_invalid" });
      }

      // Idempotency: only credit once per (ownerUid, reference)
      const w = await ensureWallet(req.user.uid);

      const alreadyCredited = await WalletTx.findOne({
        ownerUid: req.user.uid,
        type: "topup_credit",
        reference,
      }).lean();

      let credited = false;

      if (!alreadyCredited) {
        try {
          // 1) Atomically credit wallet balance
          const after = await Wallet.findOneAndUpdate(
            { ownerUid: req.user.uid },
            { $inc: { availableKobo: paidKobo } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
          );

          // 2) Write the ledger tx (protected by unique index)
          await WalletTx.create({
            ownerUid: req.user.uid,
            type: "topup_credit",
            direction: "credit",
            amountKobo: paidKobo,
            reference, // <-- top-level field (important)
            balancePendingKobo: Number(after.pendingKobo || 0),
            balanceAvailableKobo: Number(after.availableKobo || 0),
            meta: {
              gateway: "paystack",
              currency: ps.currency,
              paid_at: ps.paid_at,
              channel: ps.channel,
              customer: ps.customer,
              authorization: ps.authorization,
            },
          });

          credited = true;

          // keep w updated for response
          w.availableKobo = after.availableKobo;
          w.pendingKobo = after.pendingKobo;
        } catch (err) {
          // If duplicate key error => another request already credited this reference.
          if (
            err &&
            (err.code === 11000 || String(err.message || "").includes("E11000"))
          ) {
            credited = false;
          } else {
            throw err;
          }
        }
      }

      return res.json({
        ok: true,
        credited,
        creditsKobo: Number(w.availableKobo || 0),
      });
    } catch (e) {
      console.error("[wallet/topup/verify] error:", e);
      return res.status(500).json({ error: "topup_verify_failed" });
    }
  });

  /* ======================= EXISTING PRO WALLET ENDPOINTS ======================= */

  /** GET /api/wallet/me
   *  - Keeps your existing pro-style summary (pending/available/withdrawn/earned).
   */
  router.get("/wallet/me", requireAuth, async (req, res) => {
    try {
      const w = await ensureWallet(req.user.uid);
      const tx = await WalletTx.find({ ownerUid: req.user.uid })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      res.json({
        wallet: {
          pendingKobo: w.pendingKobo,
          availableKobo: w.availableKobo,
          withdrawnKobo: w.withdrawnKobo,
          earnedKobo: w.earnedKobo,
        },
        transactions: tx,
      });
    } catch (e) {
      console.error("[wallet/me] error:", e);
      res.status(500).json({ error: "wallet_load_failed" });
    }
  });

  /**
   * GET /api/wallet/escrow
   * Admin-only: view the platform escrow wallet (__ESCROW__) and recent ledger tx
   */
  router.get("/wallet/escrow", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const ESCROW_UID = "__ESCROW__";

      const w = await ensureWallet(ESCROW_UID);
      const tx = await WalletTx.find({ ownerUid: ESCROW_UID })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      return res.json({
        wallet: {
          pendingKobo: Number(w.pendingKobo || 0),
          availableKobo: Number(w.availableKobo || 0),
          withdrawnKobo: Number(w.withdrawnKobo || 0),
          earnedKobo: Number(w.earnedKobo || 0),
        },
        transactions: tx,
      });
    } catch (e) {
      console.error("[wallet/escrow] error:", e?.message || e);
      return res.status(500).json({ error: "escrow_wallet_failed" });
    }
  });

  /**
   * GET /api/wallet/platform
   * Admin-only: view platform commission wallet (__PLATFORM__) and recent ledger tx
   */
  router.get(
    "/wallet/platform",
    requireAuth,
    requireAdmin,
    async (_req, res) => {
      try {
        const PLATFORM_UID = "__PLATFORM__";

        const w = await ensureWallet(PLATFORM_UID);
        const tx = await WalletTx.find({ ownerUid: PLATFORM_UID })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean();

        return res.json({
          wallet: {
            pendingKobo: Number(w.pendingKobo || 0),
            availableKobo: Number(w.availableKobo || 0),
            withdrawnKobo: Number(w.withdrawnKobo || 0),
            earnedKobo: Number(w.earnedKobo || 0),
          },
          transactions: tx,
        });
      } catch (e) {
        console.error("[wallet/platform] error:", e?.message || e);
        return res.status(500).json({ error: "platform_wallet_failed" });
      }
    }
  );

  async function getPlatformRecipientCode() {
    try {
      const SettingsModel = mongoose.models.Settings;
      if (!SettingsModel) return null;
      const s = await SettingsModel.findOne().lean();
      return String(s?.payouts?.platformRecipientCode || "").trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * POST /api/wallet/platform/recipient
   * Admin-only: save Paystack recipient_code for platform payouts in Mongo Settings
   * Body: { recipientCode }
   */
  router.post(
    "/wallet/platform/recipient",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const recipientCode = String(req.body?.recipientCode || "").trim();
        if (!recipientCode)
          return res.status(400).json({ error: "recipient_required" });

        const SettingsModel = mongoose.models.Settings;
        if (!SettingsModel)
          return res.status(500).json({ error: "settings_model_missing" });

        await SettingsModel.updateOne(
          {},
          { $set: { "payouts.platformRecipientCode": recipientCode } },
          { upsert: true }
        );

        return res.json({ ok: true, recipientCode });
      } catch (e) {
        console.error("[wallet/platform/recipient] error:", e?.message || e);
        return res.status(500).json({ error: "set_platform_recipient_failed" });
      }
    }
  );

  /**
   * POST /api/wallet/platform/withdraw
   * Admin-only: withdraw from __PLATFORM__ wallet to platform bank via Paystack transfer
   * Body: { amountKobo }
   */
  router.post(
    "/wallet/platform/withdraw",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const PLATFORM_UID = "__PLATFORM__";
        const amt = Math.floor(Number(req.body?.amountKobo));

        if (!Number.isInteger(amt) || amt <= 0) {
          return res.status(400).json({ error: "amount_required" });
        }

        const PAYSTACK_SECRET_KEY = requirePaystackKey(res);
        if (!PAYSTACK_SECRET_KEY) return;

        const recipientCode = await getPlatformRecipientCode();
        if (!recipientCode) {
          return res.status(400).json({
            error: "platform_recipient_not_set",
            message: "Set it first via POST /api/wallet/platform/recipient",
          });
        }

        // 1) Reserve funds from platform wallet
        const w = await Wallet.findOneAndUpdate(
          { ownerUid: PLATFORM_UID, availableKobo: { $gte: amt } },
          { $inc: { availableKobo: -amt } },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        if (!w)
          return res
            .status(400)
            .json({ error: "insufficient_platform_balance" });

        await WalletTx.create({
          ownerUid: PLATFORM_UID,
          type: "platform_withdraw_reserve",
          direction: "debit",
          amountKobo: amt,
          balancePendingKobo: Number(w.pendingKobo || 0),
          balanceAvailableKobo: Number(w.availableKobo || 0),
          meta: { stage: "reserved" },
        });

        // 2) Paystack transfer (from Paystack balance -> your bank)
        const payReq = await fetch("https://api.paystack.co/transfer", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source: "balance",
            amount: amt,
            recipient: recipientCode,
            reason: "Platform commission withdrawal",
          }),
        });

        const payData = await payReq.json();

        if (!payData?.status) {
          // refund reserved funds
          const afterRefund = await Wallet.findOneAndUpdate(
            { ownerUid: PLATFORM_UID },
            { $inc: { availableKobo: amt } },
            { new: true }
          );

          await WalletTx.create({
            ownerUid: PLATFORM_UID,
            type: "platform_withdraw_refund",
            direction: "credit",
            amountKobo: amt,
            balancePendingKobo: Number(afterRefund?.pendingKobo || 0),
            balanceAvailableKobo: Number(afterRefund?.availableKobo || 0),
            meta: { stage: "transfer_failed", paystack: payData },
          });

          return res.status(400).json({
            error: "platform_transfer_failed",
            details: payData?.message || "transfer_failed",
          });
        }

        // mark withdrawn
        w.withdrawnKobo = Math.max(0, Number(w.withdrawnKobo || 0) + amt);
        await w.save();

        await WalletTx.create({
          ownerUid: PLATFORM_UID,
          type: "platform_withdraw_transfer",
          direction: "debit",
          amountKobo: amt,
          balancePendingKobo: Number(w.pendingKobo || 0),
          balanceAvailableKobo: Number(w.availableKobo || 0),
          meta: { recipientCode, paystack: payData?.data || payData },
        });

        return res.json({
          ok: true,
          platformWallet: {
            availableKobo: Number(w.availableKobo || 0),
            withdrawnKobo: Number(w.withdrawnKobo || 0),
          },
          transfer: payData?.data || null,
        });
      } catch (e) {
        console.error("[wallet/platform/withdraw] error:", e?.message || e);
        return res.status(500).json({ error: "platform_withdraw_failed" });
      }
    }
  );

  /** POST /api/wallet/withdraw
   *  - Initiates a Paystack transfer (pro cashout) from available balance.
   */
  router.post("/wallet/withdraw", requireAuth, async (req, res) => {
    try {
      const { amountKobo, pin } = req.body || {};
      const amt = Math.floor(Number(amountKobo));
      if (!isPosInt(amt))
        return res.status(400).json({ error: "amount_required" });

      const pinRes = await verifyPinForUid(req.user.uid, pin);
      if (!pinRes.ok) return res.status(400).json({ error: pinRes.code });

      const PAYSTACK_SECRET_KEY = requirePaystackKey(res);
      if (!PAYSTACK_SECRET_KEY) return;

      // Get user's payout account (MUST be checked before reserving funds)
      const appDoc = await Application.findOne({ uid: req.user.uid }).lean();
      const bank = appDoc?.payoutBank || {};
      if (!bank.accountNumber || !bank.code) {
        return res.status(400).json({ error: "no_payout_account" });
      }

      // ✅ Reserve funds AFTER prerequisites to prevent "stuck" deductions
      const w = await Wallet.findOneAndUpdate(
        { ownerUid: req.user.uid, availableKobo: { $gte: amt } },
        { $inc: { availableKobo: -amt } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      if (!w) return res.status(400).json({ error: "insufficient_available" });

      // (optional but useful) record that we reserved funds
      try {
        await WalletTx.create({
          ownerUid: req.user.uid,
          type: "cashout_reserve",
          direction: "debit",
          amountKobo: amt,
          balancePendingKobo: Number(w.pendingKobo || 0),
          balanceAvailableKobo: Number(w.availableKobo || 0),
          meta: { stage: "reserved" },
        });
      } catch {}

      // Create recipient
      const createRecipient = await fetch(
        "https://api.paystack.co/transferrecipient",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "nuban",
            name: bank.accountName || "Recipient",
            account_number: bank.accountNumber,
            bank_code: bank.code,
            currency: "NGN",
          }),
        }
      );
      const recData = await createRecipient.json();
      if (!recData.status) {
        console.error("[paystack recipient failed]", recData);

        // refund reserved funds
        try {
          const afterRefund = await Wallet.findOneAndUpdate(
            { ownerUid: req.user.uid },
            { $inc: { availableKobo: amt } },
            { new: true }
          );
          await WalletTx.create({
            ownerUid: req.user.uid,
            type: "cashout_reserve_refund",
            direction: "credit",
            amountKobo: amt,
            balancePendingKobo: Number(afterRefund?.pendingKobo || 0),
            balanceAvailableKobo: Number(afterRefund?.availableKobo || 0),
            meta: { stage: "recipient_create_failed", paystack: recData },
          });
        } catch {}

        return res
          .status(400)
          .json({ error: "recipient_create_failed", details: recData.message });
      }

      // Initiate transfer
      const payReq = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "balance",
          amount: amt,
          recipient: recData.data.recipient_code,
          reason: "Kpocha Touch withdrawal",
        }),
      });
      const payData = await payReq.json();
      if (!payData.status) {
        console.error("[paystack transfer failed]", payData);

        // refund reserved funds
        try {
          const afterRefund = await Wallet.findOneAndUpdate(
            { ownerUid: req.user.uid },
            { $inc: { availableKobo: amt } },
            { new: true }
          );
          await WalletTx.create({
            ownerUid: req.user.uid,
            type: "cashout_reserve_refund",
            direction: "credit",
            amountKobo: amt,
            balancePendingKobo: Number(afterRefund?.pendingKobo || 0),
            balanceAvailableKobo: Number(afterRefund?.availableKobo || 0),
            meta: { stage: "transfer_failed", paystack: payData },
          });
        } catch {}

        return res
          .status(400)
          .json({ error: "transfer_failed", details: payData.message });
      }

      // ✅ Paystack succeeded: finalize by moving reserved amount into withdrawnKobo
      w.withdrawnKobo = Math.max(0, Number(w.withdrawnKobo || 0) + amt);
      await w.save();

      await WalletTx.create({
        ownerUid: req.user.uid,
        type: "cashout_transfer",
        direction: "neutral", // ✅ finalization only; reserve already debited
        amountKobo: 0, // ✅ prevents “double debit” confusion
        balancePendingKobo: Number(w.pendingKobo || 0),
        balanceAvailableKobo: Number(w.availableKobo || 0),
        meta: { paystack: payData.data, reservedAmountKobo: amt },
      });

      res.json({ ok: true, transfer: payData.data });
    } catch (e) {
      console.error("[wallet/withdraw] error:", e);
      res.status(500).json({ error: "withdraw_failed" });
    }
  });

  /** POST /api/wallet/release (admin only)
   *  - Moves ALL pending → available (admin action).
   */
  router.post(
    "/wallet/release",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const { uid = req.user.uid } = req.body || {};
        // ✅ Atomic release: move ALL pending -> available in one DB operation
        const before = await ensureWallet(uid); // ensures wallet exists; gives us the pending amount for logging
        const amt = Number(before.pendingKobo || 0);
        if (!amt) return res.json({ ok: true, releasedKobo: 0 });

        const after = await Wallet.findOneAndUpdate(
          { ownerUid: uid, pendingKobo: { $gte: amt } },
          { $inc: { pendingKobo: -amt, availableKobo: amt } },
          { new: true }
        );

        if (!after) return res.json({ ok: true, releasedKobo: 0 });

        await WalletTx.create({
          ownerUid: uid,
          type: "admin_release",
          direction: "credit",
          amountKobo: amt,
          balancePendingKobo: Number(after.pendingKobo || 0),
          balanceAvailableKobo: Number(after.availableKobo || 0),
          meta: { source: "admin_release" },
        });

        return res.json({ ok: true, releasedKobo: amt });
      } catch (e) {
        console.error("[wallet/release] error:", e);
        res.status(500).json({ error: "release_failed" });
      }
    }
  );

  /**
   * POST /api/wallet/pay-booking
   * Body: { bookingId }
   * - Debits client wallet (available)
   * - Holds funds in platform escrow (__ESCROW__)
   * - Marks booking as paid (scheduled)
   * - Does NOT credit pro pending here
   * - Pro pending is credited ONLY after booking is marked COMPLETED
   *   (in bookings.js via creditProPendingForBooking)
   */

  router.post("/wallet/pay-booking", requireAuth, async (req, res) => {
    try {
      const { bookingId } = req.body || {};
      if (!bookingId) {
        return res.status(400).json({ error: "bookingId_required" });
      }

      // 1. Load booking
      const booking = await Booking.findById(bookingId);
      if (!booking) return res.status(404).json({ error: "booking_not_found" });

      // Only the client who owns the booking can pay
      if (String(booking.clientUid) !== String(req.user.uid)) {
        return res.status(403).json({ error: "not_your_booking" });
      }

      booking.meta = booking.meta || {};

      // 🔒 Guard: prevent mixing payment methods
      const requested = String(
        booking.meta.paymentMethodRequested || ""
      ).toLowerCase();
      if (requested === "card") {
        return res.status(400).json({
          error: "card_only_booking",
          message:
            "This booking was created for card payment. Please pay with card.",
        });
      }

      // Already paid? (idempotent return) — but still re-emit booking:paid so pro alert is instant on retries
      if (booking.paymentStatus === "paid") {
        try {
          const io = getIO();
          if (io) {
            const payload = {
              bookingId: booking._id.toString(),
              status: booking.status,
              paymentStatus: booking.paymentStatus,
              proOwnerUid: booking.proOwnerUid,
              clientUid: booking.clientUid,
              paymentMethod: booking?.meta?.paymentMethodUsed || "wallet",
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

        // keep response idempotent
        return res.json({ ok: true, alreadyPaid: true, booking });
      }

      const amountKobo = Math.floor(Number(booking.amountKobo || 0));
      if (!amountKobo || amountKobo <= 0) {
        return res.status(400).json({ error: "invalid_amount" });
      }

      // 2) Hold funds in PLATFORM ESCROW (client.available -> __ESCROW__.available)
      // This is the real "platform escrow" balance.
      await holdFundsInEscrowForBooking(booking);

      // 3. Mark booking paid
      booking.paymentStatus = "paid";
      booking.status =
        booking.status === "pending_payment" ? "scheduled" : booking.status;
      booking.paystackReference = `WALLET-${Date.now()}`;

      // Record which method actually paid
      booking.meta.paymentMethodUsed = "wallet";
      booking.meta.paymentMethodRequested =
        booking.meta.paymentMethodRequested || "wallet";

      // ✅ START connection window immediately (same as Paystack flow)
      if (!booking.ringingStartedAt) {
        booking.ringingStartedAt = new Date();
      }

      await booking.save();

      // ✅ Notify pro ONLY after wallet payment succeeds (idempotent)
      try {
        if (!booking.meta.notifiedProOnPaid) {
          if (booking.proOwnerUid) {
            await createNotification({
              toUid: booking.proOwnerUid,
              fromUid: booking.clientUid || null,
              type: "booking_paid",
              title: "New paid booking",
              body: "A client has paid. Please open the app to accept the booking.",
              data: {
                bookingId: booking._id.toString(),
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                paymentMethod: "wallet",
              },
            });
          }
          booking.meta.notifiedProOnPaid = true;
          await booking.save(); // persist idempotency flag
          // 🔔 Realtime: match /payments/verify so pro alert is instant (wallet payment)
          try {
            const io = getIO();
            if (io) {
              const payload = {
                bookingId: booking._id.toString(),
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                proOwnerUid: booking.proOwnerUid,
                clientUid: booking.clientUid,
                paymentMethod: "wallet",
              };

              if (booking.proOwnerUid)
                io.to(`user:${booking.proOwnerUid}`).emit(
                  "booking:paid",
                  payload
                );
              if (booking.clientUid)
                io.to(`user:${booking.clientUid}`).emit(
                  "booking:paid",
                  payload
                );

              io.to(`booking:${booking._id.toString()}`).emit(
                "booking:paid",
                payload
              );
            }
          } catch (err) {
            console.warn(
              "[wallet/pay-booking] socket emit booking:paid failed:",
              err?.message || err
            );
          }
        }
      } catch (e) {
        console.warn(
          "[wallet/pay-booking] notify pro failed:",
          e?.message || e
        );
      }

      // Option A escrow: do NOT credit pro pending on payment.
      // Pro pending is credited only when booking is marked COMPLETED (in bookings.js).

      res.json({ ok: true, booking });
    } catch (err) {
      console.error("[wallet/pay-booking] error:", err);
      res.status(500).json({ error: "wallet_booking_failed" });
    }
  });

  return router;
}
