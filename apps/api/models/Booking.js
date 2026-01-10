// apps/api/models/Booking.js
import mongoose from "mongoose";

/**
 * Booking states:
 * - "pending_payment" -> "scheduled" on Paystack success.
 * - "accepted"/"declined" for pro decisions.
 */
const STATUS = [
  "pending_payment",
  "scheduled",
  "accepted",
  "declined",
  "completed",
  "cancelled",
];

/* ------------------------------ Snapshots ------------------------------ */
const ServiceSnapshotSchema = new mongoose.Schema(
  {
    serviceId: { type: String, default: "" }, // optional stable id from pro.services[].id
    serviceName: { type: String, required: true },
    priceKobo: { type: Number, required: true, min: 1 }, // snapshot price for this booking
  },
  { _id: false }
);

/* ----------------------------- Location/Contact ----------------------------- */
const LocationSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" }, // user-entered or reverse-geocoded
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { _id: false }
);

const ClientContactPrivateSchema = new mongoose.Schema(
  {
    phone: { type: String, default: "" },
    address: { type: String, default: "" }, // full address; keep private
  },
  { _id: false }
);

/** Public, minimal client snapshot (read-only identity shown in UI) */
const ClientPublicSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
  },
  { _id: false }
);

/* --------------------------------- Booking --------------------------------- */
const BookingSchema = new mongoose.Schema(
  {
    // Who booked
    clientUid: { type: String, required: true, index: true },
    clientEmail: { type: String },
    clientName: { type: String, default: "" }, // snapshot of client name

    // Public read-only snapshot of client identity for the booking
    client: { type: ClientPublicSchema, default: () => ({}) },

    // Which professional
    proId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pro",
      required: true,
      index: true,
    },
    // optional; routes infer & set it
    proOwnerUid: { type: String, index: true },

    // What & how much
    service: { type: ServiceSnapshotSchema, required: true },
    amountKobo: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "NGN" },

    // Scheduling
    scheduledFor: { type: Date, index: true },

    // Instant flow
    instant: { type: Boolean, default: false, index: true },

    // Region (upper-cased)
    country: { type: String, default: "Nigeria" }, // ← used by /bookings/instant
    state: { type: String, default: "" },          // ← used by /bookings/instant
    lga: { type: String, default: "" },            // e.g., "OREDO"
    addressText: { type: String, default: "" },
    location: { type: LocationSchema, default: () => ({}) },

    notes: { type: String, default: "" },

    // Payment + escrow
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded"],
      default: "pending",
      index: true,
    },
    paystackReference: { type: String, default: "", index: true },

    // Payout release flag
    payoutReleased: { type: Boolean, default: false },

    // Booking lifecycle
    status: {
      type: String,
      enum: STATUS,
      default: "pending_payment",
      index: true,
    },
    acceptedAt: { type: Date }, // when pro accepts (ring timeout / analytics)
        // Ringing window (starts when payment becomes paid/scheduled)
    ringingStartedAt: { type: Date, index: true },

    // When booking was cancelled (client/system/admin)
    cancelledAt: { type: Date, index: true },


    // When pro declines
    decline: {
      type: new mongoose.Schema(
        {
          reasonCode: { type: String, default: "" },
          reasonText: { type: String, default: "" },
          at: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    // Private client contact (visible to assigned pro after accept, and to admins)
    clientContactPrivate: {
      type: ClientContactPrivateSchema,
      default: () => ({}),
    },

    // Metadata (idempotency, requested method, completion, auto-cancel, etc.)
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },

    // Timestamps
    completedAt: { type: Date },
  },
  { timestamps: true }
);

/* ------------------------------ Hooks/Virtuals ------------------------------ */
BookingSchema.pre("validate", function (next) {
  if (!this.amountKobo && this.service?.priceKobo) {
    this.amountKobo = this.service.priceKobo;
  }
  if (this.instant && !this.scheduledFor) {
    this.scheduledFor = new Date();
  }
  next();
});

/* --------------------------------- Indexes ---------------------------------- */
BookingSchema.index({ proId: 1, scheduledFor: -1 });
BookingSchema.index({ clientUid: 1, createdAt: -1 });
BookingSchema.index({ status: 1, paymentStatus: 1, acceptedAt: 1, ringingStartedAt: 1 });

export const Booking =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);
