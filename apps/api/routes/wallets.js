// apps/api/routes/wallets.js
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import fetch from "node-fetch";
import { Application } from "../models.js";

/**
 * Wallet + Txn schemas (UI-compatible).
 */
const TxnSchema = new mongoose.Schema(
  {
    type: { type: String, default: "" },
    direction: { type: String, default: "debit" },
    amountKobo: { type: Number, default: 0 },
    meta: { type: Object, default: {} },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true }
);

const WalletSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, unique: true, index: true },
    pendingKobo: { type: Number, default: 0 },
    availableKobo: { type: Number, default: 0 },
    withdrawnKobo: { type: Number, default: 0 },
    earnedKobo: { type: Number, default: 0 },
    transactions: { type: [TxnSchema], default: [] },
  },
  { timestamps: true }
);

const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", WalletSchema);

/**
 * Settings model (for payout fee %).
 */
let Settings = null;
try {
  Settings = mongoose.models.Settings || null;
} catch {}

const isPosInt = (n) => Number.isInteger(n) && n > 0;

async function getFeePercent() {
  try {
    if (!Settings) return 3;
    const s = await Settings.findOne().lean();
    const pct = Number(s?.payouts?.instantCashoutFeePercent);
    return Number.isFinite(pct) ? pct : 3;
  } catch {
    return 3;
  }
}

async function ensureWallet(uid) {
  let w = await Wallet.findOne({ ownerUid: uid });
  if (!w) w = await Wallet.create({ ownerUid: uid });
  return w;
}

async function verifyPinForUid(uid, pin) {
  const appDoc = await Application.findOne({ uid }).lean();
  if (!appDoc?.withdrawPinHash) return { ok: false, code: "no_pin" };
  const ok = await bcrypt.compare(String(pin || ""), String(appDoc.withdrawPinHash || ""));
  return { ok, code: ok ? "ok" : "invalid_pin" };
}

/* ------------------------------------------------------------------ */
export function withAuth(requireAuth, requireAdmin) {
  const router = express.Router();

  /** GET /api/wallet/me */
  router.get("/wallet/me", requireAuth, async (req, res) => {
    try {
      const w = await ensureWallet(req.user.uid);
      const tx = (w.transactions || []).slice(-50).reverse();
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

  /** POST /api/wallet/withdraw-pending */
  router.post("/wallet/withdraw-pending", requireAuth, async (req, res) => {
    try {
      const { amountKobo, pin } = req.body || {};
      const amt = Math.floor(Number(amountKobo));
      if (!isPosInt(amt)) return res.status(400).json({ error: "amount_required" });

      const pinRes = await verifyPinForUid(req.user.uid, pin);
      if (!pinRes.ok) return res.status(400).json({ error: pinRes.code });

      const w = await ensureWallet(req.user.uid);
      if (amt > w.pendingKobo) return res.status(400).json({ error: "insufficient_pending" });

      const feePct = await getFeePercent();
      const fee = Math.floor((amt * feePct) / 100);
      const net = amt - fee;

      w.pendingKobo -= amt;
      w.availableKobo += net;

      w.transactions.push(
        { type: "withdraw_pending", direction: "neutral", amountKobo: amt, meta: { feeKobo: fee } },
        { type: "fee", direction: "debit", amountKobo: fee, meta: { source: "withdraw_pending", pct: feePct } },
        { type: "credit_available", direction: "credit", amountKobo: net }
      );

      await w.save();
      res.json({ ok: true, feeKobo: fee, creditedKobo: net });
    } catch (e) {
      console.error("[wallet/withdraw-pending] error:", e);
      res.status(500).json({ error: "withdraw_pending_failed" });
    }
  });

  /** POST /api/wallet/withdraw (Paystack transfer) */
  router.post("/wallet/withdraw", requireAuth, async (req, res) => {
    try {
      const { amountKobo, pin } = req.body || {};
      const amt = Math.floor(Number(amountKobo));
      if (!isPosInt(amt)) return res.status(400).json({ error: "amount_required" });

      const pinRes = await verifyPinForUid(req.user.uid, pin);
      if (!pinRes.ok) return res.status(400).json({ error: pinRes.code });

      const w = await ensureWallet(req.user.uid);
      if (amt > w.availableKobo) return res.status(400).json({ error: "insufficient_available" });

      // Get user's payout account
      const appDoc = await Application.findOne({ uid: req.user.uid }).lean();
      const bank = appDoc?.payoutBank || {};
      if (!bank.accountNumber || !bank.code) {
        return res.status(400).json({ error: "no_payout_account" });
      }

      // Deduct from available balance first
      w.availableKobo -= amt;
      w.withdrawnKobo += amt;

      /* Create Paystack transferrecipient (test/live both work) */
      const createRecipient = await fetch("https://api.paystack.co/transferrecipient", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "nuban",
          name: bank.accountName || "Recipient",
          account_number: bank.accountNumber,
          bank_code: bank.code,
          currency: "NGN",
        }),
      });
      const recData = await createRecipient.json();
      if (!recData.status) {
        console.error("[paystack recipient failed]", recData);
        return res.status(400).json({ error: "recipient_create_failed", details: recData.message });
      }

      /* Initiate transfer */
      const transferPayload = {
        source: "balance",
        amount: amt,
        recipient: recData.data.recipient_code,
        reason: "Kpocha Touch withdrawal",
      };
      const payReq = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(transferPayload),
      });
      const payData = await payReq.json();
      if (!payData.status) {
        console.error("[paystack transfer failed]", payData);
        return res.status(400).json({ error: "transfer_failed", details: payData.message });
      }

      /* Record transaction */
      w.transactions.push({
        type: "cashout_transfer",
        direction: "debit",
        amountKobo: amt,
        meta: { paystack: payData.data },
      });
      await w.save();

      res.json({ ok: true, transfer: payData.data });
    } catch (e) {
      console.error("[wallet/withdraw] error:", e);
      res.status(500).json({ error: "withdraw_failed" });
    }
  });

  /** POST /api/wallet/release (admin only) */
  router.post("/wallet/release", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { uid = req.user.uid } = req.body || {};
      const w = await ensureWallet(uid);
      const amt = w.pendingKobo;
      if (!amt) return res.json({ ok: true, releasedKobo: 0 });

      w.pendingKobo = 0;
      w.availableKobo += amt;
      w.transactions.push(
        { type: "admin_release", direction: "neutral", amountKobo: amt },
        { type: "credit_available", direction: "credit", amountKobo: amt, meta: { source: "admin_release" } }
      );
      await w.save();

      res.json({ ok: true, releasedKobo: amt });
    } catch (e) {
      console.error("[wallet/release] error:", e);
      res.status(500).json({ error: "release_failed" });
    }
  });

  return router;
}
