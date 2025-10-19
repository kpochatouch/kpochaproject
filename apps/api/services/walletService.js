import { Wallet, WalletTx } from "../models/wallet.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";

/**
 * Ensure a wallet exists for a uid.
 */
export async function getOrCreateWallet(ownerUid) {
  const w = await Wallet.findOneAndUpdate(
    { ownerUid },
    { $setOnInsert: { ownerUid } },
    { new: true, upsert: true }
  );
  return w;
}

/**
 * After a successful Paystack payment, credit 75% of booking amount to the pro's Pending.
 * booking: {_id, amountKobo, ...} and must be resolvable to a pro owner uid
 * We try booking.proOwnerUid, booking.ownerUid/proUid/... then fall back to Pro(owner) via booking.proId.
 */
export async function creditProPendingForBooking(booking, meta = {}) {
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

  if (!ownerUid) throw new Error("Missing booking ownerUid for wallet credit");

  const proShareKobo = Math.floor(Number(booking.amountKobo || 0) * 0.75);
  if (proShareKobo <= 0) return { ok: false, reason: "no_amount" };

  const w = await getOrCreateWallet(ownerUid);

  w.pendingKobo = (w.pendingKobo || 0) + proShareKobo;
  w.earnedKobo = (w.earnedKobo || 0) + proShareKobo;
  await w.save();

  await WalletTx.create({
    ownerUid,
    type: "booking_fund",
    direction: "credit",
    amountKobo: proShareKobo,
    balancePendingKobo: w.pendingKobo,
    balanceAvailableKobo: w.availableKobo || 0,
    meta: { bookingId: booking._id?.toString?.(), ...meta },
  });

  return { ok: true, wallet: w };
}

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
  w.availableKobo = (w.availableKobo || 0) + amt;
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

/**
 * Withdraw from available.
 */
export async function withdrawAvailable(ownerUid, amountKobo, meta = {}) {
  const amt = Math.max(0, Math.floor(+amountKobo || 0));
  if (!amt) throw new Error("invalid_amount");

  const w = await getOrCreateWallet(ownerUid);

  const avail = Math.max(0, w.availableKobo || 0);
  if (amt > avail) throw new Error("insufficient_available");

  w.availableKobo = avail - amt;
  w.withdrawnKobo = (w.withdrawnKobo || 0) + amt;
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

/**
 * Withdraw directly from pending with a 3% fee (no admin release needed).
 * Debits pending, credits withdrawn. Records a separate fee transaction.
 */
export async function withdrawPendingWithFee(ownerUid, amountKobo, meta = {}) {
  const amt = Math.max(0, Math.floor(+amountKobo || 0));
  if (!amt) throw new Error("invalid_amount");

  const w = await getOrCreateWallet(ownerUid);
  const pending = Math.max(0, w.pendingKobo || 0);
  if (amt > pending) throw new Error("insufficient_pending");

  const fee = Math.floor(amt * 0.03);
  const net = amt - fee;

  // move whole amount out of pending → withdrawn
  w.pendingKobo = pending - amt;
  w.withdrawnKobo = (w.withdrawnKobo || 0) + net;
  await w.save();

  // withdrawal (debit)
  await WalletTx.create({
    ownerUid,
    type: "withdraw_pending",
    direction: "debit",
    amountKobo: net,
    balancePendingKobo: w.pendingKobo,
    balanceAvailableKobo: w.availableKobo || 0,
    meta: { ...meta, feeKobo: fee },
  });

  // fee (debit)
  await WalletTx.create({
    ownerUid,
    type: "fee",
    direction: "debit",
    amountKobo: fee,
    balancePendingKobo: w.pendingKobo,
    balanceAvailableKobo: w.availableKobo || 0,
    meta: { ...meta, source: "withdraw_pending_3pct" },
  });

  return { ok: true, withdrawnKobo: net, feeKobo: fee, wallet: w };
}

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
  if (!ownerUid) throw new Error("pro_owner_uid_not_found");

  // 3) Amount to move (same split used when crediting)
  const proShareKobo = Math.floor(Number(booking.amountKobo || 0) * 0.75);
  if (proShareKobo <= 0) {
    await Booking.updateOne({ _id: booking._id }, { $set: { payoutReleased: true } });
    return { ok: true, nothingToRelease: true };
  }

  // 4) Move from pending -> available
  const rel = await releasePendingToAvailable(ownerUid, proShareKobo, {
    bookingId: booking._id?.toString?.(),
    ...meta,
  });

  // 5) Mark booking as released
  await Booking.updateOne({ _id: booking._id }, { $set: { payoutReleased: true } });

  return { ok: true, ...rel };
}
