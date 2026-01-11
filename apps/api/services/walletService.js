// apps/api/services/walletService.js
import mongoose from "mongoose";
import { Wallet, WalletTx, WalletTopupIntent } from "../models/wallet.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";
import { createNotification } from "./notificationService.js";

const ESCROW_UID = "__ESCROW__";
const PAYSTACK_UID = "__PAYSTACK__";
const PLATFORM_UID = "__PLATFORM__";

/** Ensure a wallet exists for a uid. */
export async function getOrCreateWallet(ownerUid) {
  if (!ownerUid) throw new Error("ownerUid_required");
  const w = await Wallet.findOneAndUpdate(
    { ownerUid },
    { $setOnInsert: { ownerUid } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return w;
}


function asStrId(v) {
  return v?._id?.toString?.() || v?.toString?.() || "";
}

async function ensureEscrowWallet() {
  return getOrCreateWallet(ESCROW_UID);
}

/**
 * Atomic transfer: decrement fromUid.available, increment toUid.available, write 2 ledger txs.
 * Uses a Mongo transaction for consistency.
 */
async function transferAvailableToAvailable(fromUid, toUid, amountKobo, meta = {}, types = {}) {
  const amt = Math.floor(Number(amountKobo || 0));
  if (!amt || amt <= 0) throw new Error("amount_invalid");

  const session = await mongoose.startSession();
  let out = null;

  await session.withTransaction(async () => {
    // ensure wallets exist in txn
    await Wallet.updateOne(
      { ownerUid: fromUid },
      { $setOnInsert: { ownerUid: fromUid } },
      { upsert: true, session }
    );
    await Wallet.updateOne(
      { ownerUid: toUid },
      { $setOnInsert: { ownerUid: toUid } },
      { upsert: true, session }
    );

    // debit with guard
    const fromAfter = await Wallet.findOneAndUpdate(
      { ownerUid: fromUid, availableKobo: { $gte: amt } },
      { $inc: { availableKobo: -amt } },
      { new: true, session }
    );
    if (!fromAfter) throw new Error("insufficient_funds");

    const toAfter = await Wallet.findOneAndUpdate(
      { ownerUid: toUid },
      { $inc: { availableKobo: amt } },
      { new: true, session }
    );

    const debitType = types.debitType || "transfer_debit";
    const creditType = types.creditType || "transfer_credit";

    await WalletTx.create(
      [
        {
          ownerUid: fromUid,
          type: debitType,
          direction: "debit",
          amountKobo: amt,
          balancePendingKobo: Number(fromAfter.pendingKobo || 0),
          balanceAvailableKobo: Number(fromAfter.availableKobo || 0),
          meta,
        },
        {
          ownerUid: toUid,
          type: creditType,
          direction: "credit",
          amountKobo: amt,
          balancePendingKobo: Number(toAfter.pendingKobo || 0),
          balanceAvailableKobo: Number(toAfter.availableKobo || 0),
          meta,
        },
      ],
      { session }
    );

    out = { ok: true, amt, fromAfter, toAfter };
  });

  session.endSession();
  return out;
}

async function ensurePaystackWallet() {
  return getOrCreateWallet(PAYSTACK_UID);
}

async function ensurePlatformWallet() {
  return getOrCreateWallet(PLATFORM_UID);
}


/**
 * Fund escrow for a CARD (Paystack) booking:
 * 1) credit __PAYSTACK__.available (money received)
 * 2) transfer __PAYSTACK__ -> __ESCROW__ (real escrow ledger)
 *
 * Idempotent per booking: if escrow already funded for this booking, no-op.
 */
export async function fundEscrowFromPaystackForBooking(booking, { reference = null } = {}) {
  const bookingId = asStrId(booking);
  if (!bookingId) throw new Error("booking_id_missing");

  const amountKobo = Math.floor(Number(booking?.amountKobo || 0));
  if (!amountKobo || amountKobo <= 0) throw new Error("amount_invalid");

  await ensureEscrowWallet();
  await ensurePaystackWallet();

  // ✅ Idempotency: if escrow already funded for this booking, do nothing.
const already = await WalletTx.findOne({
  ownerUid: ESCROW_UID,
  type: "escrow_hold_in",
  "meta.bookingId": bookingId,
}).lean();
if (already) return { ok: true, alreadyEscrowed: true };

// ✅ If inflow exists but escrow is NOT funded, we must still attempt the transfer.
// Otherwise a partial failure can leave booking "paid" but escrow empty forever.
const inflowExists = await WalletTx.findOne({
  ownerUid: PAYSTACK_UID,
  type: "paystack_inflow",
  "meta.bookingId": bookingId,
}).lean();

  // 1) Credit PAYSTACK wallet (represents money received) — only once
if (!inflowExists) {
  const payAfter = await Wallet.findOneAndUpdate(
    { ownerUid: PAYSTACK_UID },
    { $inc: { availableKobo: amountKobo } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await WalletTx.create({
    ownerUid: PAYSTACK_UID,
    type: "paystack_inflow",
    direction: "credit",
    amountKobo,
    reference: reference || null, // ✅ indexed field
    balancePendingKobo: Number(payAfter.pendingKobo || 0),
    balanceAvailableKobo: Number(payAfter.availableKobo || 0),
    meta: { bookingId, reference: reference || null },
  });
}


  // 2) Transfer PAYSTACK -> ESCROW (uses your atomic ledger transfer)
  return transferAvailableToAvailable(
    PAYSTACK_UID,
    ESCROW_UID,
    amountKobo,
    { bookingId, escrow: true, reason: "card_paystack_hold", reference: reference || null },
    { debitType: "paystack_to_escrow_out", creditType: "escrow_hold_in" }
  );
}


export async function holdFundsInEscrowForBooking(booking) {
  const bookingId = asStrId(booking);
  if (!bookingId) throw new Error("booking_id_missing");
  if (!booking?.clientUid) throw new Error("client_uid_missing");

  await ensureEscrowWallet();

  // idempotency: if we already created a client booking_hold for this booking, no-op
  const existing = await WalletTx.findOne({
    ownerUid: booking.clientUid,
    type: "booking_hold",
    "meta.bookingId": bookingId,
  }).lean();

  if (existing) return { ok: true, alreadyHeld: true };

  return transferAvailableToAvailable(
    booking.clientUid,
    ESCROW_UID,
    booking.amountKobo,
    { bookingId, escrow: true, reason: "booking_hold" },
    { debitType: "booking_hold", creditType: "escrow_hold_in" }
  );
}

export async function refundEscrowToClientForBooking(booking, refundAmountKobo, meta = {}) {
  const bookingId = asStrId(booking);
  if (!bookingId) throw new Error("booking_id_missing");
  if (!booking?.clientUid) throw new Error("client_uid_missing");

  await ensureEscrowWallet();

  // idempotency: only refund once
  const already = await WalletTx.findOne({
    ownerUid: booking.clientUid,
    type: "booking_refund_wallet",
    "meta.bookingId": bookingId,
  }).lean();
  if (already) return { ok: true, alreadyRefunded: true };

  return transferAvailableToAvailable(
    ESCROW_UID,
    booking.clientUid,
    refundAmountKobo,
    { bookingId, escrow: true, ...meta },
    { debitType: "escrow_refund_out", creditType: "booking_refund_wallet" }
  );
}


/* ------------------------------------------------------------------ */
/* Helpers: config with soft dependency on Settings (no hard import)  */
/* ------------------------------------------------------------------ */

let _cache = { proPct: null, feePct: null, cancelFeePct: null, ts: 0 };
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

// NEW: client cancel fee percent (used when client cancels AFTER accept)
async function getClientCancelFeePercentAfterAccept() {
  if (fresh() && _cache.cancelFeePct != null) return _cache.cancelFeePct;
  const s = await readSettingsDoc();
  const fromSettings = Number(s?.bookingRules?.clientCancelFeePercentAfterAccept);
  const envPct = envNumber("CLIENT_CANCEL_FEE_AFTER_ACCEPT_PCT", 3);
  const pct = Number.isFinite(fromSettings) ? fromSettings : envPct;
  _cache.cancelFeePct = pct;
  _cache.ts = now();
  return pct;
}

/* ------------------------------------------------------------------ */
/* Core helpers                                                       */
/* ------------------------------------------------------------------ */

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
/**
 * Completion funding (true escrow):
 * Move pro share from PLATFORM ESCROW -> Pro PENDING after booking is COMPLETED.
 * Idempotent via booking_fund tx existence.
 */
/**
 * ⚠️ IMPORTANT — READ BEFORE CHANGING THIS FUNCTION
 *
 * This function is intentionally called from bookings.js
 * when a booking is marked COMPLETED.
 *
 * Flow summary:
 * 1) Client payment → money is held in PLATFORM ESCROW (__ESCROW__)
 * 2) NO pro wallet credit happens at payment time
 * 3) When booking is COMPLETED:
 *      → escrow.available → pro.pending
 *
 * This function:
 * - MUST only run after completion
 * - MUST be idempotent (protected by booking_fund tx existence)
 *
 * ❗ Do NOT call this during payment or acceptance.
 * ❗ bookings.js already calls this on completion — no duplicate calls needed.
 */

export async function creditProPendingForBooking(booking, meta = {}) {
  const bookingIdStr = asStrId(booking);
  if (!bookingIdStr) throw new Error("booking_id_missing");

  // ✅ enforce "only after completion"
  if (booking.status !== "completed") throw new Error("not_completed");
  if (booking.paymentStatus !== "paid") throw new Error("not_paid");

  const ownerUid = await resolveProOwnerUid(booking);
  if (!ownerUid) throw new Error("Missing booking ownerUid for wallet credit");

  const amountKobo = Math.floor(Number(booking.amountKobo || 0));
  if (amountKobo <= 0) return { ok: false, reason: "no_amount" };

  await ensureEscrowWallet();
  await ensurePlatformWallet();

  // Idempotency: has this booking already credited the pro?
  const existing = await WalletTx.findOne({
    ownerUid,
    type: "booking_fund",
    "meta.bookingId": bookingIdStr,
  }).lean();

  if (existing) return { ok: true, alreadyCredited: true };

  const proPct = await getProSharePercent(); // e.g. 75
  const proShareKobo = Math.floor((amountKobo * proPct) / 100);
  if (proShareKobo <= 0) return { ok: false, reason: "computed_zero_share" };

  // platform share = remainder (safer than % math drift)
  const platformPct = Math.max(0, 100 - Math.floor(proPct));
  const platformShareKobo = Math.max(0, amountKobo - proShareKobo);

  const session = await mongoose.startSession();
  let result = null;

  await session.withTransaction(async () => {
    // Ensure wallets exist
    await Wallet.updateOne(
      { ownerUid: ESCROW_UID },
      { $setOnInsert: { ownerUid: ESCROW_UID } },
      { upsert: true, session }
    );
    await Wallet.updateOne(
      { ownerUid },
      { $setOnInsert: { ownerUid } },
      { upsert: true, session }
    );
    await Wallet.updateOne(
      { ownerUid: PLATFORM_UID },
      { $setOnInsert: { ownerUid: PLATFORM_UID } },
      { upsert: true, session }
    );

    // Debit escrow.available for BOTH pro + platform in one go (guard)
    const totalOut = proShareKobo + platformShareKobo;

    const escrowAfter = await Wallet.findOneAndUpdate(
      { ownerUid: ESCROW_UID, availableKobo: { $gte: totalOut } },
      { $inc: { availableKobo: -totalOut } },
      { new: true, session }
    );
    if (!escrowAfter) throw new Error("escrow_insufficient");

    // Credit pro.pending + earned
    const proAfter = await Wallet.findOneAndUpdate(
      { ownerUid },
      { $inc: { pendingKobo: proShareKobo, earnedKobo: proShareKobo } },
      { new: true, session }
    );

    // Credit platform.available
    const platformAfter = await Wallet.findOneAndUpdate(
      { ownerUid: PLATFORM_UID },
      { $inc: { availableKobo: platformShareKobo } },
      { new: true, session }
    );

    // Ledger: escrow out + pro funded + platform commission
    await WalletTx.create(
      [
        // --- pro ---
        {
          ownerUid: ESCROW_UID,
          type: "escrow_release_to_pro",
          direction: "debit",
          amountKobo: proShareKobo,
          balancePendingKobo: Number(escrowAfter.pendingKobo || 0),
          balanceAvailableKobo: Number(escrowAfter.availableKobo || 0),
          meta: { bookingId: bookingIdStr, proPct, ...meta },
        },
        {
          ownerUid,
          type: "booking_fund",
          direction: "credit",
          amountKobo: proShareKobo,
          balancePendingKobo: Number(proAfter.pendingKobo || 0),
          balanceAvailableKobo: Number(proAfter.availableKobo || 0),
          meta: { bookingId: bookingIdStr, proPct, ...meta },
        },

        // --- platform ---
        ...(platformShareKobo > 0
          ? [
              {
                ownerUid: ESCROW_UID,
                type: "escrow_release_to_platform",
                direction: "debit",
                amountKobo: platformShareKobo,
                balancePendingKobo: Number(escrowAfter.pendingKobo || 0),
                balanceAvailableKobo: Number(escrowAfter.availableKobo || 0),
                meta: { bookingId: bookingIdStr, platformPct, ...meta },
              },
              {
                ownerUid: PLATFORM_UID,
                type: "platform_commission",
                direction: "credit",
                amountKobo: platformShareKobo,
                balancePendingKobo: Number(platformAfter.pendingKobo || 0),
                balanceAvailableKobo: Number(platformAfter.availableKobo || 0),
                meta: { bookingId: bookingIdStr, platformPct, ...meta },
              },
            ]
          : []),
      ],
      { session }
    );

    result = {
      ok: true,
      wallet: proAfter,
      proPct,
      platformPct,
      creditedKobo: proShareKobo,
      platformCreditedKobo: platformShareKobo,
    };
  });

  session.endSession();

  // (optional notification)
  try {
    await createNotification({
      ownerUid,
      type: "booking_fund",
      data: {
        bookingId: bookingIdStr,
        message: "Job completed. Funds moved from escrow to pending balance.",
      },
    });
  } catch {}

  return result;
}


/* ------------------------------------------------------------------ */
/* Movement: Pending -> Available                                     */
/* ------------------------------------------------------------------ */

/**
 * Move pending -> available.
 * If amountKobo is null/undefined, release ALL pending.
 */
export async function releasePendingToAvailable(ownerUid, amountKobo = null, meta = {}) {
  if (!ownerUid) throw new Error("ownerUid_required");

  // If amountKobo is null => release ALL pending, but we must read it first safely.
  const w = await getOrCreateWallet(ownerUid);
  const pend = Math.max(0, Number(w.pendingKobo || 0));
  const amt =
    amountKobo == null ? pend : Math.max(0, Math.min(pend, Math.floor(+amountKobo)));

  if (amt <= 0) throw new Error("nothing_to_release");

  const after = await Wallet.findOneAndUpdate(
    { ownerUid, pendingKobo: { $gte: amt } },
    { $inc: { pendingKobo: -amt, availableKobo: amt } },
    { new: true }
  );
  if (!after) throw new Error("insufficient_pending");

  await WalletTx.create({
    ownerUid,
    type: "release",
    direction: "credit",
    amountKobo: amt,
    balancePendingKobo: Number(after.pendingKobo || 0),
    balanceAvailableKobo: Number(after.availableKobo || 0),
    meta,
  });

  return { ok: true, releasedKobo: amt, wallet: after };
}


/* ------------------------------------------------------------------ */
/* Withdraw from Available                                            */
/* ------------------------------------------------------------------ */

export async function withdrawAvailable(ownerUid, amountKobo, meta = {}) {
  if (!ownerUid) throw new Error("ownerUid_required");

  const amt = Math.max(0, Math.floor(+amountKobo || 0));
  if (!amt) throw new Error("invalid_amount");

  const after = await Wallet.findOneAndUpdate(
    { ownerUid, availableKobo: { $gte: amt } },
    { $inc: { availableKobo: -amt, withdrawnKobo: amt } },
    { new: true }
  );
  if (!after) throw new Error("insufficient_available");

  await WalletTx.create({
    ownerUid,
    type: "withdraw",
    direction: "debit",
    amountKobo: amt,
    balancePendingKobo: Number(after.pendingKobo || 0),
    balanceAvailableKobo: Number(after.availableKobo || 0),
    meta,
  });

  return { ok: true, withdrawnKobo: amt, wallet: after };
}


/* ------------------------------------------------------------------ */
/* Instant cashout from Pending (fee)                                 */
/* ------------------------------------------------------------------ */

/**
 * Instant cashout from PENDING → AVAILABLE (minus fee).
 * Matches Option A escrow model + Wallet UI.
 */
export async function withdrawPendingWithFee(ownerUid, amountKobo, meta = {}) {
  const amt = Math.max(0, Math.floor(+amountKobo || 0));
  if (!amt) throw new Error("invalid_amount");

  const feePct = await getWithdrawPendingFeePercent();
  const fee = Math.floor((amt * feePct) / 100);
  const net = Math.max(0, amt - fee);

  await ensurePlatformWallet(); // ✅ make sure __PLATFORM__ exists

  const session = await mongoose.startSession();
  let out = null;

  await session.withTransaction(async () => {
    // 1) Guard + move Pro: pending -> available (net)
    const proAfter = await Wallet.findOneAndUpdate(
      { ownerUid, pendingKobo: { $gte: amt } },
      {
        $inc: {
          pendingKobo: -amt,
          availableKobo: net, // ✅ only the net hits the pro available
        },
      },
      { new: true, session }
    );
    if (!proAfter) throw new Error("insufficient_pending");

    // 2) Credit Platform wallet with fee
    let platformAfter = null;
    if (fee > 0) {
      platformAfter = await Wallet.findOneAndUpdate(
        { ownerUid: PLATFORM_UID },
        { $inc: { availableKobo: fee } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
      );
    }

    // 3) Ledger entries
    const txs = [];

    // Pro: we debited full pending (amt)
    txs.push({
      ownerUid,
      type: "withdraw_pending",
      direction: "debit",
      amountKobo: amt,
      balancePendingKobo: Number(proAfter.pendingKobo || 0),
      balanceAvailableKobo: Number(proAfter.availableKobo || 0),
      meta: { ...meta, feeKobo: fee, feePct, netKobo: net },
    });

    // Pro: net credit to available
    if (net > 0) {
      txs.push({
        ownerUid,
        type: "credit_available",
        direction: "credit",
        amountKobo: net,
        balancePendingKobo: Number(proAfter.pendingKobo || 0),
        balanceAvailableKobo: Number(proAfter.availableKobo || 0),
        meta: { ...meta, source: "withdraw_pending" },
      });
    }

    // Platform: fee income
    if (fee > 0) {
      txs.push({
        ownerUid: PLATFORM_UID,
        type: "instant_cashout_fee",
        direction: "credit",
        amountKobo: fee,
        balancePendingKobo: Number(platformAfter?.pendingKobo || 0),
        balanceAvailableKobo: Number(platformAfter?.availableKobo || 0),
        meta: { ...meta, fromUid: ownerUid, source: "withdraw_pending", feePct },
      });
    }

    await WalletTx.create(txs, { session });

    out = {
      ok: true,
      debitedPendingKobo: amt,
      feeKobo: fee,
      feePct,
      creditedAvailableKobo: net,
      wallet: proAfter,
      platformCreditedKobo: fee,
    };
  });

  session.endSession();
  return out;
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

    // 3) Amount to move: use the ACTUAL funded amount from ledger (prevents drift)
  const bookingIdStr = booking._id.toString();

  const fundTx = await WalletTx.findOne({
    ownerUid,
    type: "booking_fund",
    "meta.bookingId": bookingIdStr,
  })
    .sort({ createdAt: 1 })
    .lean();

  const creditedKobo = Math.floor(Number(fundTx?.amountKobo || 0));
  if (!creditedKobo || creditedKobo <= 0) {
    await Booking.updateOne({ _id: booking._id }, { $set: { payoutReleased: true } });
    return { ok: true, nothingToRelease: true };
  }

  // 4) Move from pending -> available
  const rel = await releasePendingToAvailable(ownerUid, creditedKobo, {
    bookingId: bookingIdStr,
    ...meta,
  });


  // 5) Mark booking as released
  await Booking.updateOne({ _id: booking._id }, { $set: { payoutReleased: true } });

  return { ok: true, ...rel };
}

/* ------------------------------------------------------------------ */
/* Booking cancel + refund (pro pending reversal + client fee calc)   */
/* ------------------------------------------------------------------ */

/**
 * Cancel a booking and prepare refund info.
 *
 * - Always sets booking.status = "cancelled" and cancelledAt.
 * - If booking was PAID:
 *    - Reverse the pro's pending "booking_fund" for this booking (idempotent).
 *    - Compute client refund + 3% fee ONLY when client cancels AFTER accept.
 *    - Store refund info on booking.meta.cancelMeta (for Paystack/manual refund).
 *
 * NOTE: Refunds go to the CLIENT WALLET (availableKobo) so they can rebook immediately.
 */

export async function cancelBookingAndRefund(bookingOrId, options = {}) {
  const { cancelledBy = "system", reason = "" } = options;

  // 1) resolve booking document (full, not lean; we will mutate + save)
  const booking =
    typeof bookingOrId === "object" && bookingOrId?._id && typeof bookingOrId.save === "function"
      ? bookingOrId
      : await Booking.findById(bookingOrId);

  if (!booking) throw new Error("booking_not_found");

  const wasAccepted = booking.status === "accepted";
  const wasPaid = booking.paymentStatus === "paid";
  const amountKobo = Math.floor(Number(booking.amountKobo || 0));

  // 2) Reverse pro pending (if paid & previously credited)
  let reversedKobo = 0;
  let ownerUid = null;

  if (wasPaid && amountKobo > 0) {
    ownerUid = await resolveProOwnerUid(booking);
    if (ownerUid) {
      const bookingIdStr = booking._id.toString();

      // Idempotency: if we already have a refund tx, skip wallet mutation
      const existingRefund = await WalletTx.findOne({
        ownerUid,
        type: "booking_fund_refund",
        "meta.bookingId": bookingIdStr,
      })
        .sort({ createdAt: -1 })
        .lean();

      if (!existingRefund) {
        // Find the original booking_fund tx to know how much was credited
        const originalFund = await WalletTx.findOne({
          ownerUid,
          type: "booking_fund",
          "meta.bookingId": bookingIdStr,
        })
          .sort({ createdAt: 1 })
          .lean();

        const creditedKobo = Math.floor(Number(originalFund?.amountKobo || 0));
        if (creditedKobo > 0) {
          const w = await getOrCreateWallet(ownerUid);
          const pend = Math.max(0, w.pendingKobo || 0);
          const toReverse = Math.min(creditedKobo, pend);

          if (toReverse > 0) {
            w.pendingKobo = pend - toReverse;
            await w.save();

            await WalletTx.create({
              ownerUid,
              type: "booking_fund_refund",
              direction: "debit",
              amountKobo: toReverse,
              balancePendingKobo: w.pendingKobo,
              balanceAvailableKobo: w.availableKobo || 0,
              meta: {
                bookingId: bookingIdStr,
                cancelledBy,
                reason,
              },
            });

            reversedKobo = toReverse;
          }
        }
      } else {
        reversedKobo = existingRefund.amountKobo || 0;
      }
    }
  }

  // 3) Compute client fee + refund amount (for Paystack use)
  let cancelFeePctApplied = 0;
  let cancelFeeKobo = 0;
  let refundAmountKobo = 0;

  if (wasPaid && amountKobo > 0) {
    const eligibleForClientFee = cancelledBy === "client" && wasAccepted;
    if (eligibleForClientFee) {
      const feePct = await getClientCancelFeePercentAfterAccept();
      const pct = Math.max(0, Math.floor(feePct));
      cancelFeePctApplied = pct;
      cancelFeeKobo = Math.floor((amountKobo * pct) / 100);
    }

    refundAmountKobo = Math.max(0, amountKobo - cancelFeeKobo);
  }

   // 4) Update booking document
  booking.status = "cancelled";
  booking.cancelledAt = new Date();

    // 5) Refund client from ESCROW -> client wallet (idempotent)
  let walletRefunded = false;

  if (wasPaid && refundAmountKobo > 0 && booking.clientUid) {
    const bookingIdStr = booking._id.toString();

    const r = await refundEscrowToClientForBooking(booking, refundAmountKobo, {
      cancelledBy,
      reason,
      cancelFeeKobo,
      cancelFeePercentApplied: cancelFeePctApplied,
    });

    walletRefunded = !!r?.ok;
  }

  // ✅ Move client cancel fee from ESCROW -> PLATFORM (so it doesn't sit in escrow forever)
  if (wasPaid && cancelFeeKobo > 0) {
    await ensurePlatformWallet();
    await ensureEscrowWallet();

    await transferAvailableToAvailable(
      ESCROW_UID,
      PLATFORM_UID,
      cancelFeeKobo,
      {
        bookingId: booking._id.toString(),
        cancelledBy,
        reason,
        source: "client_cancel_fee",
      },
      { debitType: "escrow_cancel_fee_out", creditType: "platform_cancel_fee_in" }
    );
  }

  // mark booking paymentStatus as refunded if it was paid
  if (wasPaid && booking.paymentStatus === "paid") {
    booking.paymentStatus = "refunded";
  }

  const meta = booking.meta || {};
  meta.cancelMeta = {
    ...(meta.cancelMeta || {}),
    cancelledBy,
    reason,
    reversedProPendingKobo: reversedKobo,
    cancelFeePercentApplied: cancelFeePctApplied,
    cancelFeeKobo,
    refundAmountKobo,
    refundCurrency: booking.currency || "NGN",
    refundedAt: new Date(),
    walletRefunded,
  };
  booking.meta = meta;

  await booking.save();

  return {
    ok: true,
    bookingId: booking._id.toString(),
    cancelledBy,
    reversedProPendingKobo: reversedKobo,
    cancelFeePercentApplied: cancelFeePctApplied,
    cancelFeeKobo,
    refundAmountKobo,
  };
}
