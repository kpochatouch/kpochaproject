// apps/api/models/wallet.js
import mongoose from "mongoose";

/* =========================== Wallet & Tx Models =========================== */

const WalletSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, unique: true, index: true },

    // For pros you may use pending/earned/withdrawn.
    // For clients we mainly use availableKobo as "creditsKobo".
    pendingKobo: { type: Number, default: 0, min: 0 },
    availableKobo: { type: Number, default: 0, min: 0 },
    withdrawnKobo: { type: Number, default: 0, min: 0 },
    earnedKobo: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// (Optional) convenient alias used by FE in some places.
WalletSchema.virtual("creditsKobo").get(function () {
  return this.availableKobo;
});

// Keep transaction types flexible but consistent
const WalletTxSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, index: true },

    // e.g. "topup", "booking_hold", "booking_release", "refund", "withdraw", "fee"
    type: { type: String, required: true },

    // "credit" or "debit" or "neutral"
    direction: { type: String, enum: ["credit", "debit", "neutral"], required: true },

    // tx amount (0 allowed for neutral/init records)
    amountKobo: { type: Number, required: true, min: 0 },

    // snapshot balances after this tx
    balancePendingKobo: { type: Number, default: 0 },
    balanceAvailableKobo: { type: Number, default: 0 },

    // Paystack reference (top-level, indexable) - used for idempotency
    reference: { type: String, default: null, index: true },

    // anything helpful (bookingId, paystack payload, etc.)
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);


// helpful index for recent history per user
WalletTxSchema.index({ ownerUid: 1, createdAt: -1 });

// Prevent double-credit for the same Paystack reference
// (Only applies when reference is present, mainly topup_credit)
WalletTxSchema.index(
  { ownerUid: 1, type: 1, reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: "string" } } }
);


/**
 * Top-up intent: created before redirect/inline; verified once by Paystack callback.
 * Prevents replay; links a reference to an amount and owner.
 */
const WalletTopupIntentSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, index: true },
    reference: { type: String, required: true, unique: true, index: true }, // Paystack ref
    amountKobo: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["created", "verified", "failed"], default: "created", index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }, // any provider payload
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Wallet =
  mongoose.models.Wallet || mongoose.model("Wallet", WalletSchema);
export const WalletTx =
  mongoose.models.WalletTx || mongoose.model("WalletTx", WalletTxSchema);
export const WalletTopupIntent =
  mongoose.models.WalletTopupIntent ||
  mongoose.model("WalletTopupIntent", WalletTopupIntentSchema);

/* =============================== Maintenance ============================== */

/**
 * One-time safety: drop any old unique index on `userUid`
 * (this is what causes: dup key { userUid: null })
 * and ensure the correct unique index on `ownerUid`.
 */
export async function ensureWalletIndexes() {
  // One-time safety: drop any old unique index on `userUid`
  try {
    await Wallet.collection.dropIndex("userUid_1");
  } catch (e) {
    // ignore if not present
  }

  // Ensure correct unique wallet per user
  try {
    await Wallet.collection.createIndex({ ownerUid: 1 }, { unique: true });
  } catch (e) {
    // ignore if already exists
  }

  // Keep topup intent reference unique (if you ever use WalletTopupIntent)
  try {
    await WalletTopupIntent.collection.createIndex({ reference: 1 }, { unique: true });
  } catch (e) {
    // ignore
  }

  // Helpful history index
  try {
    await WalletTx.collection.createIndex({ ownerUid: 1, createdAt: -1 });
  } catch (e) {
    // ignore
  }

  // Strong idempotency for topups
  try {
    await WalletTx.collection.createIndex(
      { ownerUid: 1, type: 1, reference: 1 },
      { unique: true, partialFilterExpression: { reference: { $type: "string" } } }
    );
  } catch (e) {
    // ignore
  }
}



/* =============================== Helper APIs ============================== */

/** Fetch or create a wallet for a user. */
export async function getOrCreateWallet(ownerUid) {
  if (!ownerUid) throw new Error("ownerUid_required");
  const w = await Wallet.findOneAndUpdate(
    { ownerUid },
    { $setOnInsert: { ownerUid } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return w;
}

/**
 * Credit available balance and write a tx with post-balance snapshot.
 * @param {string} ownerUid
 * @param {number} amountKobo  positive integer
 * @param {object} meta        extra fields (e.g. { source:'paystack', reference:'...' })
 * @param {string} type        tx type (default: "topup")
 */
export async function creditAvailable(ownerUid, amountKobo, meta = {}, type = "topup") {
  if (!ownerUid) throw new Error("ownerUid_required");
  if (!Number.isFinite(Number(amountKobo)) || amountKobo <= 0) throw new Error("amount_invalid");

  const w = await Wallet.findOneAndUpdate(
    { ownerUid },
    { $inc: { availableKobo: Math.round(Number(amountKobo)) } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await WalletTx.create({
    ownerUid,
    type,
    direction: "credit",
    amountKobo: Math.round(Number(amountKobo)),
    balancePendingKobo: w.pendingKobo,
    balanceAvailableKobo: w.availableKobo,
    meta,
  });

  return w;
}

/**
 * Debit available balance (with insufficiency guard) and write tx.
 * @param {string} ownerUid
 * @param {number} amountKobo
 * @param {object} meta
 * @param {string} type       e.g. "booking_payment"
 */
export async function debitAvailable(ownerUid, amountKobo, meta = {}, type = "booking_payment") {
  if (!ownerUid) throw new Error("ownerUid_required");
  const amt = Math.round(Number(amountKobo));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("amount_invalid");

  // Guard: ensure adequate funds
  const w = await getOrCreateWallet(ownerUid);
  if ((w.availableKobo || 0) < amt) throw new Error("insufficient_funds");

  const after = await Wallet.findOneAndUpdate(
    { ownerUid },
    { $inc: { availableKobo: -amt } },
    { new: true }
  );

  await WalletTx.create({
    ownerUid,
    type,
    direction: "debit",
    amountKobo: amt,
    balancePendingKobo: after.pendingKobo,
    balanceAvailableKobo: after.availableKobo,
    meta,
  });

  return after;
}

/* ============================== Top-up Intents ============================= */

/**
 * Create a top-up intent; caller sets the Paystack reference after init.
 * If you already have a reference before calling, pass it in `opts.reference`.
 */
export async function createTopupIntent(ownerUid, amountKobo, opts = {}) {
  if (!ownerUid) throw new Error("ownerUid_required");
  const amt = Math.round(Number(amountKobo));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("amount_invalid");

  const intent = await WalletTopupIntent.create({
    ownerUid,
    amountKobo: amt,
    reference: String(opts.reference || `TOPUP-${ownerUid}-${Date.now()}`),
    status: "created",
    meta: opts.meta || {},
  });

  return intent;
}

/**
 * Mark a top-up reference as verified (idempotent) and credit wallet once.
 * @returns {object} { credited: boolean, wallet, intent }
 */
export async function verifyTopupAndCredit(ownerUid, reference, providerMeta = {}) {
  if (!ownerUid) throw new Error("ownerUid_required");
  if (!reference) throw new Error("reference_required");

  // Lock this reference via findOneAndUpdate to avoid races
  const intent = await WalletTopupIntent.findOneAndUpdate(
    { reference },
    {
      $setOnInsert: {
        ownerUid,
        amountKobo: 0,
        status: "created",
      },
    },
    { new: true, upsert: true }
  );

  // If intent belongs to someone else, refuse
  if (intent.ownerUid && intent.ownerUid !== ownerUid) {
    throw new Error("reference_owner_mismatch");
  }

  // If already verified, do nothing (idempotent)
  if (intent.status === "verified") {
    const w = await getOrCreateWallet(ownerUid);
    return { credited: false, wallet: w, intent };
  }

  // We expect amountKobo to be present when intent was originally created in /topup/init
  // but if not, you can derive it from providerMeta (e.g., charge.amount).
  const amountKobo =
    Number(intent.amountKobo || 0) ||
    Number(providerMeta?.amountKobo || providerMeta?.amount || 0);

  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    throw new Error("intent_amount_missing");
  }

  // Mark verified first (so any parallel calls see "verified")
  intent.status = "verified";
  intent.verifiedAt = new Date();
  intent.meta = { ...(intent.meta || {}), providerMeta };
  await intent.save();

  // Credit wallet
  const wallet = await creditAvailable(ownerUid, amountKobo, { reference, source: "paystack" }, "topup");

  return { credited: true, wallet, intent };
}
