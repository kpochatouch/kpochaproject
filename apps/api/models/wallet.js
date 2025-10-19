// apps/api/models/wallet.js
import mongoose from "mongoose";

const WalletSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, unique: true, index: true },
    pendingKobo: { type: Number, default: 0 },
    availableKobo: { type: Number, default: 0 },
    withdrawnKobo: { type: Number, default: 0 },
    earnedKobo: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Keep transaction types flexible but consistent
const WalletTxSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, index: true },

    // e.g. "booking_fund", "release", "withdraw", "withdraw_pending", "fee"
    type: { type: String, required: true },

    // "credit" or "debit"
    direction: { type: String, enum: ["credit", "debit"], required: true },

    amountKobo: { type: Number, required: true },

    // snapshot balances after this tx
    balancePendingKobo: { type: Number, default: 0 },
    balanceAvailableKobo: { type: Number, default: 0 },

    // anything helpful (bookingId, paystackRef, feeKobo, etc.)
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// helpful index for recent history per user
WalletTxSchema.index({ ownerUid: 1, createdAt: -1 });

export const Wallet =
  mongoose.models.Wallet || mongoose.model("Wallet", WalletSchema);
export const WalletTx =
  mongoose.models.WalletTx || mongoose.model("WalletTx", WalletTxSchema);

/**
 * One-time safety: drop any old unique index on `userUid`
 * (this is what causes: dup key { userUid: null })
 * and ensure the correct unique index on `ownerUid`.
 */
export async function ensureWalletIndexes() {
  // Drop the incorrect index if it exists; ignore if it doesn't.
  try {
    await Wallet.collection.dropIndex("userUid_1");
  } catch (e) {
    // no-op
  }
  // Make sure the correct unique index exists.
  try {
    await Wallet.collection.createIndex({ ownerUid: 1 }, { unique: true });
  } catch (e) {
    // no-op if already exists
  }
}
