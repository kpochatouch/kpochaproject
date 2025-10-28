// apps/api/services/walletService.js
import mongoose from "mongoose";
import { Wallet, WalletTx } from "../models/wallet.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";

/* ------------------------------------------------------------------ */
/* Helpers: config with soft dependency on Settings (no hard import)  */
/* ------------------------------------------------------------------ */

let _cache = { proPct: null, feePct: null, ts: 0 };
const CACHE_MS = 5 * 60 * 1000; // 5 minutes

function now() { return Date.now(); }
function fresh() { return now() - _cache.ts < CACHE_MS; }

function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

async function readSettingsDoc() {
  try {
    // Avoid direct import to prevent circular deps; use mongoose registry
    const Settings = mongoose.models.Settings;
    if (!Settings) return null;
    const s = await Settings.findOne().lean();
    return s || null;
  } catch {
    return null;
  }
}

async function getProSharePercent() {
  if (fresh() && _cache.proPct != null) return _cache.proPct;
  const s = await readSettingsDoc();
  const fromSettings = Number(s?.commissionSplit?.pro);
  const envPct = envNumber("PRO_SHARE_PCT", 75);
  const pct = Number.isFinite(fromSettings) ? fromSettings : envPct;
  _cache.proPct = pct;
  _cache.ts = now();
  return pct;
}

async function getWithdrawPendingFeePercent() {
  if (fresh() && _cache.feePct != null) return _cache.feePct;
  const s = await readSettingsDoc();
  const fromSettings = Number(s?.payouts?.instantCashoutFeePercent);
  const envPct = envNumber("WITHDRAW_PENDING_FEE_PCT", 3);
  const pct = Number.isFinite(fromSettings) ? fromSettings : envPct;
  _cache.feePct = pct;
  _cache.ts = now();
  return pct;
}

/* ------------------------------------------------------------------ */
/* Core helpers                                                       */
/* ------------------------------------------------------------------ */

/** Ensure a wallet exists for a uid. */
export async function getOrCreateWallet(ownerUid) {
  const w = await Wallet.findOneAndUpdate(
    { ownerUid },
    { $setOnInsert: { ownerUid } },
    { new: true, upsert: true }
  );
  return w;
}

/** Resolve the pro ownerUid for a booking. */
async function resolveProOwnerUid(booking) {
  let ownerUid =
    booking.proOwnerUid ||
    booking.ownerUid ||
    booking.proUid ||
    booking.proOwner ||
    booking.owner;

  if (!ownerUid && booking.proId) {
    const pro = await Pro.findById(booking.proId).lean();
    ownerUid = pro?.ownerUid || ownerUid;
  }
  return ownerUid || null;
}

/* ------------------------------------------------------------------ */
/* Funding after Paystack success (idempotent)                        */
/* ------------------------------------------------------------------ */

/**
 * After a successful Paystack payment, credit {pro%} of booking amount to the Pro's PENDING.
 * Idempotent: if we've already recorded a booking_fund tx for this booking+owner, it no-ops.
 *
 * @param {Booking|object} booking - must have {_id, amountKobo, proId?, proOwnerUid?}
 * @param {object} meta - extra metadata to store on WalletTx (e.g. { paystackRef })
 */
export async function creditProPendingForBooking(booking, meta = {}) {
  const ownerUid = await resolveProOwnerUid(booking);
  if (!ownerUid) throw new Error("Missing booking ownerUid for wallet credit");

  const amountKobo = Math.floor(Number(booking.amountKobo || 0));
  if (amountKobo <= 0) return { ok: false, reason: "no_amount" };

  // Idempotency: has this booking already credited?
  const bookingIdStr = booking._id?.toString?.();
  const existing = await WalletTx.findOne({
    ownerUid,
    type: "booking_fund",
    "meta.bookingId": bookingIdStr,
  })
    .sort({ createdAt: -1 })
    .lean();

  if (existing) {
    return { ok: true, alreadyCredited: true };
  }

  const proPct = await getProSharePercent(); // e.g., 75
  const proShareKobo = Math.floor((amountKobo * proPct) / 100);
  if (proShareKobo <= 0) return { ok: false, reason: "computed_zero_share" };

  const w = await getOrCreateWallet(ownerUid);

  w.pendingKobo = Math.max(0, (w.pendingKobo || 0) + proShareKobo);
  w.earnedKobo = Math.max(0, (w.earnedKobo || 0) + proShareKobo);
  await w.save();

  await WalletTx.create({
    ownerUid,
    type: "booking_fund",
    direction: "credit",
    amountKobo: proShareKobo,
    balancePendingKobo: w.pendingKobo,
    balanceAvailableKobo: w.availableKobo || 0,
    meta: { bookingId: bookingIdStr, proPct, ...meta },
  });

  return { ok: true, wallet: w, proPct, creditedKobo: proShareKobo };
}

/* ------------------------------------------------------------------ */
/* Movement: Pending -> Available                                     */
/* ------------------------------------------------------------------ */

/**
 * Move pending -> available.
 * If amountKobo is null/undefined, release ALL pending.
 */
export async function releasePendingToAvailable(ownerUid, amountKobo = null, meta = {}) {
  const w = await getOrCreateWallet(ownerUid);

  const pend = Math.max(0, w.pendingKobo || 0);
  const amt =
    amountKobo == null ? pend : Math.max(0, Math.min(pend, Math.floor(+amountKobo)));

  if (amt <= 0) throw new Error("nothing_to_release");

  w.pendingKobo = pend - amt;
  w.availableKobo = Math.max(0, (w.availableKobo || 0) + amt);
  await w.save();

  await WalletTx.create({
    ownerUid,
    type: "release",
    direction: "credit",
    amountKobo: amt,
    balancePendingKobo: w.pendingKobo,
    balanceAvailableKobo: w.availableKobo,
    meta,
  });

  return { ok: true, releasedKobo: amt, wallet: w };
}

/* ------------------------------------------------------------------ */
/* Withdraw from Available                                            */
/* ------------------------------------------------------------------ */

export async function withdrawAvailable(ownerUid, amountKobo, meta = {}) {
  const amt = Math.max(0, Math.floor(+amountKobo || 0));
  if (!amt) throw new Error("invalid_amount");

  const w = await getOrCreateWallet(ownerUid);

  const avail = Math.max(0, w.availableKobo || 0);
  if (amt > avail) throw new Error("insufficient_available");

  w.availableKobo = avail - amt;
  w.withdrawnKobo = Math.max(0, (w.withdrawnKobo || 0) + amt);
  await w.save();

  await WalletTx.create({
    ownerUid,
    type: "withdraw",
    direction: "debit",
    amountKobo: amt,
    balancePendingKobo: w.pendingKobo || 0,
    balanceAvailableKobo: w.availableKobo,
    meta,
  });

  return { ok: true, withdrawnKobo: amt, wallet: w };
}

/* ------------------------------------------------------------------ */
/* Instant cashout from Pending (fee)                                 */
/* ------------------------------------------------------------------ */

/**
 * Withdraw directly from pending with a fee (default 3%).
 * Debits pending, increases withdrawn, records a separate fee transaction.
 */
export async function withdrawPendingWithFee(ownerUid, amountKobo, meta = {}) {
  const amt = Math.max(0, Math.floor(+amountKobo || 0));
  if (!amt) throw new Error("invalid_amount");

  const w = await getOrCreateWallet(ownerUid);
  const pending = Math.max(0, w.pendingKobo || 0);
  if (amt > pending) throw new Error("insufficient_pending");

  const feePct = await getWithdrawPendingFeePercent();
  const fee = Math.floor((amt * feePct) / 100);
  const net = amt - fee;

  // move whole amount out of pending → withdrawn (net)
  w.pendingKobo = pending - amt;
  w.withdrawnKobo = Math.max(0, (w.withdrawnKobo || 0) + net);
  await w.save();

  // withdrawal (debit)
  await WalletTx.create({
    ownerUid,
    type: "withdraw_pending",
    direction: "debit",
    amountKobo: net,
    balancePendingKobo: w.pendingKobo,
    balanceAvailableKobo: w.availableKobo || 0,
    meta: { ...meta, feeKobo: fee, feePct },
  });

  // fee (debit) — only if fee > 0 to satisfy WalletTx.amountKobo min: 1
  if (fee > 0) {
    await WalletTx.create({
      ownerUid,
      type: "fee",
      direction: "debit",
      amountKobo: fee,
      balancePendingKobo: w.pendingKobo,
      balanceAvailableKobo: w.availableKobo || 0,
      meta: { ...meta, source: "withdraw_pending", feePct },
    });
  }

  return { ok: true, withdrawnKobo: net, feeKobo: fee, feePct, wallet: w };
}

/* ------------------------------------------------------------------ */
/* Booking-specific release                                           */
/* ------------------------------------------------------------------ */

/**
 * Release a specific booking's pro share from PENDING -> AVAILABLE and mark booking as released.
 * Idempotent: if booking.payoutReleased is true or nothing to move, it exits safely.
 * Accepts booking object or bookingId.
 */
export async function releasePendingToAvailableForBooking(bookingOrId, meta = {}) {
  // 1) Resolve booking
  const booking =
    typeof bookingOrId === "object" && bookingOrId?._id
      ? bookingOrId
      : await Booking.findById(bookingOrId).lean();

  if (!booking) throw new Error("booking_not_found");
  if (booking.payoutReleased) return { ok: true, alreadyReleased: true };

  // 2) Resolve pro owner uid
  const ownerUid = await resolveProOwnerUid(booking);
  if (!ownerUid) throw new Error("pro_owner_uid_not_found");

  // 3) Amount to move (same split used when crediting)
  const proPct = await getProSharePercent();
  const proShareKobo = Math.floor(Number(booking.amountKobo || 0) * (proPct / 100));
  if (proShareKobo <= 0) {
    await Booking.updateOne({ _id: booking._id }, { $set: { payoutReleased: true } });
    return { ok: true, nothingToRelease: true };
  }

  // 4) Move from pending -> available
  const rel = await releasePendingToAvailable(ownerUid, proShareKobo, {
    bookingId: booking._id?.toString?.(),
    proPct,
    ...meta,
  });

  // 5) Mark booking as released
  await Booking.updateOne({ _id: booking._id }, { $set: { payoutReleased: true } });

  return { ok: true, proPct, ...rel };
}
