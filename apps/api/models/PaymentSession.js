import mongoose from "mongoose";

const PaymentSessionSchema = new mongoose.Schema(
  {
    state: { type: String, required: true, unique: true, index: true },
    kind: { type: String, enum: ["booking_card"], required: true },

    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    reference: { type: String, required: true },

    clientUid: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date(), index: true },
    expiresAt: { type: Date, required: true, index: true },

    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PaymentSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-clean

export const PaymentSession =
  mongoose.models.PaymentSession ||
  mongoose.model("PaymentSession", PaymentSessionSchema);
