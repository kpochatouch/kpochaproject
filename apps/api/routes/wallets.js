// apps/api/routes/wallets.js
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import fetch from "node-fetch";
import { Application } from "../models.js";

/**
 * Wallet + Txn schemas (UI-compatible).
 * (Embedded transactions; simple & works with your existing code.)
 */
const TxnSchema = new mongoose.Schema(
  {
    type: { type: String, default: "" },            // e.g. topup_init, topup_credit, withdraw_pending, fee, cashout_transfer
    direction: { type: String, default: "debit" },  // credit | debit | neutral
    amountKobo: { type: Number, default: 0 },
    meta: { type: Object, default: {} },            // { reference, paystack:{...}, feeKobo, etc. }
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true }
);

const WalletSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, unique: true, index: true },
    pendingKobo: { type: Number, default: 0 },      // escrow-like (for pros)
    availableKobo: { type: Number, default: 0 },    // spendable (clients) / withdrawable (pros)
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

/* ----------------------------- helpers ----------------------------- */
const isPosInt = (n) => Number.isInteger(n) && n > 0;
const koboInt = (v) => Math.round(Number(v || 0)) || 0;

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
      const tx = (w.transactions || []).slice(-50).reverse();
      res.json({
        creditsKobo: Number(w.availableKobo || 0),
        transactions: tx.map((t) => ({
          id: String(t._id),
          type: t.type,
          direction: t.direction,
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
      if (!isPosInt(amt)) return res.status(400).json({ error: "amount_invalid" });

      const PAYSTACK_SECRET_KEY = requirePaystackKey(res);
      if (!PAYSTACK_SECRET_KEY) return;

      const w = await ensureWallet(req.user.uid);
      const reference = makeTopupReference(req.user.uid);

      // trace init (doesn't affect balances)
      w.transactions.push({
        type: "topup_init",
        direction: "neutral",
        amountKobo: amt,
        meta: { reference },
      });
      await w.save();

      // Init Paystack
      const psResp = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: req.user.email || "customer@example.com",
          amount: amt,
          reference,
          callback_url: callbackUrl || process.env.PAYSTACK_WALLET_CALLBACK_URL || undefined,
          metadata: {
            type: "wallet_topup",
            ownerUid: req.user.uid,
          },
        }),
      });
      const data = await psResp.json();
      if (!psResp.ok || !data?.status || !data?.data?.authorization_url) {
        console.error("[wallet/topup/init] paystack init failed:", data);
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
      if (!reference) return res.status(400).json({ error: "reference_required" });

      const PAYSTACK_SECRET_KEY = requirePaystackKey(res);
      if (!PAYSTACK_SECRET_KEY) return;

      // Verify on Paystack
      const vResp = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
      );
      const verify = await vResp.json();
      if (!vResp.ok || !verify?.status) {
        console.error("[wallet/topup/verify] paystack verify failed:", verify);
        return res.status(502).json({ error: "paystack_verify_failed" });
      }

      const ps = verify.data || {};
      if (ps.status !== "success") {
        return res.status(400).json({ error: "payment_not_successful", status: ps.status });
      }

      // Amount is in kobo
      const paidKobo = koboInt(ps.amount);
      if (!isPosInt(paidKobo)) {
        return res.status(400).json({ error: "amount_invalid" });
      }

      // Idempotency: only credit once per (ownerUid, reference)
      const w = await ensureWallet(req.user.uid);

      const alreadyCredited = (w.transactions || []).some(
        (t) => t.type === "topup_credit" && t.meta && t.meta.reference === reference
      );

      if (!alreadyCredited) {
        w.availableKobo += paidKobo;
        w.transactions.push({
          type: "topup_credit",
          direction: "credit",
          amountKobo: paidKobo,
          meta: {
            reference,
            gateway: "paystack",
            currency: ps.currency,
            paid_at: ps.paid_at,
            channel: ps.channel,
            customer: ps.customer,
            authorization: ps.authorization,
          },
        });
        // Optionally mark any matching init as verified
        const initIdx = (w.transactions || []).findIndex(
          (t) => t.type === "topup_init" && t.meta?.reference === reference
        );
        if (initIdx >= 0) {
          w.transactions[initIdx].meta = {
            ...(w.transactions[initIdx].meta || {}),
            verified: true,
            verifiedAt: new Date().toISOString(),
          };
        }
        await w.save();
      }

      res.json({
        ok: true,
        credited: !alreadyCredited,
        creditsKobo: Number(w.availableKobo || 0),
      });
    } catch (e) {
      console.error("[wallet/topup/verify] error:", e);
      res.status(500).json({ error: "topup_verify_failed" });
    }
  });

  /* ======================= EXISTING PRO WALLET ENDPOINTS ======================= */

  /** GET /api/wallet/me
   *  - Keeps your existing pro-style summary (pending/available/withdrawn/earned).
   */
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

  /** POST /api/wallet/withdraw-pending
   *  - Moves funds from pending → available (minus fee). Pro flow.
   */
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

  /** POST /api/wallet/withdraw
   *  - Initiates a Paystack transfer (pro cashout) from available balance.
   */
  router.post("/wallet/withdraw", requireAuth, async (req, res) => {
    try {
      const { amountKobo, pin } = req.body || {};
      const amt = Math.floor(Number(amountKobo));
      if (!isPosInt(amt)) return res.status(400).json({ error: "amount_required" });

      const pinRes = await verifyPinForUid(req.user.uid, pin);
      if (!pinRes.ok) return res.status(400).json({ error: pinRes.code });

      const w = await ensureWallet(req.user.uid);
      if (amt > w.availableKobo) return res.status(400).json({ error: "insufficient_available" });

      const PAYSTACK_SECRET_KEY = requirePaystackKey(res);
      if (!PAYSTACK_SECRET_KEY) return;

      // Get user's payout account
      const appDoc = await Application.findOne({ uid: req.user.uid }).lean();
      const bank = appDoc?.payoutBank || {};
      if (!bank.accountNumber || !bank.code) {
        return res.status(400).json({ error: "no_payout_account" });
      }

      // Deduct first (your original logic)
      w.availableKobo -= amt;
      w.withdrawnKobo += amt;

      // Create recipient
      const createRecipient = await fetch("https://api.paystack.co/transferrecipient", {
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
      });
      const recData = await createRecipient.json();
      if (!recData.status) {
        console.error("[paystack recipient failed]", recData);
        return res.status(400).json({ error: "recipient_create_failed", details: recData.message });
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
        return res.status(400).json({ error: "transfer_failed", details: payData.message });
      }

      // Record transaction
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

  /** POST /api/wallet/release (admin only)
   *  - Moves ALL pending → available (admin action).
   */
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
