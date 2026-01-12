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

// One-time booking-scoped idempotency (bulletproof under concurrency)
WalletTxSchema.index(
  { ownerUid: 1, type: 1, "meta.bookingId": 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: { $in: ["booking_fund", "escrow_hold_in", "platform_cancel_fee_in", "cancel_fee_compensation"] },
      "meta.bookingId": { $exists: true, $type: "string" },
    },
  }
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

  // Strong idempotency for booking-scoped one-time txs ✅ ADD THIS RIGHT HERE
  try {
    await WalletTx.collection.createIndex(
      { ownerUid: 1, type: 1, "meta.bookingId": 1 },
      {
        unique: true,
        partialFilterExpression: {
          type: {
            $in: [
              "booking_fund",
              "escrow_hold_in",
              "platform_cancel_fee_in",
              "cancel_fee_compensation",
            ],
          },
          "meta.bookingId": { $exists: true, $type: "string" },
        },
      }
    );
  } catch (e) {
    // ignore
  }
}

