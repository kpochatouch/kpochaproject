// apps/api/models/Booking.js
import mongoose from "mongoose";

/**
 * Booking states (kept for back-compat with your server logic):
 * - "pending_payment" -> "scheduled" on Paystack success.
 * - Added "accepted"/"declined" earlier, keep all.
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

    // Public read-only snapshot of client identity for the booking
    client: { type: ClientPublicSchema, default: () => ({}) },

    // Which professional
    proId: { type: mongoose.Schema.Types.ObjectId, ref: "Pro", required: true, index: true },
    // ⚠️ Was required before; make optional so routes can infer and save later
    proOwnerUid: { type: String, index: true },

    // What & how much (snapshot; keep amountKobo for back-compat)
    service: { type: ServiceSnapshotSchema, required: true },
    amountKobo: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "NGN" },

    // Scheduling
    // ⚠️ For instant bookings we may not have a chosen timeslot. Make optional.
    scheduledFor: { type: Date, index: true },

    // Instant flag for date/time-less flow
    instant: { type: Boolean, default: false, index: true },

    // Region support (let routes fill it; don’t block save)
    lga: { type: String, default: "" }, // e.g., "OREDO" (UPPERCASE)

    // Human-readable address (can match location.text)
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

    // Payout release flag (scheduler/admin endpoint uses this)
    payoutReleased: { type: Boolean, default: false },

    // Booking lifecycle
    status: {
      type: String,
      enum: STATUS,
      default: "pending_payment",
      index: true,
    },

    // When pro declines
    decline: {
      type: new mongoose.Schema(
        {
          reasonCode: { type: String, default: "" }, // "too_busy" | "out_of_area" | ...
          reasonText: { type: String, default: "" },
          at: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    // Private client contact (only after accept to assigned pro, and to admins)
    clientContactPrivate: { type: ClientContactPrivateSchema, default: () => ({}) },

    // Timestamps you already use
    completedAt: { type: Date },
  },
  { timestamps: true }
);

/* ------------------------------ Hooks/Virtuals ------------------------------ */
/**
 * Keep `amountKobo` in sync with `service.priceKobo` at creation time.
 * If caller passes both, trust explicit `amountKobo`.
 */
BookingSchema.pre("validate", function (next) {
  if (!this.amountKobo && this.service?.priceKobo) {
    this.amountKobo = this.service.priceKobo;
  }
  // For instant bookings, auto-stamp scheduledFor so downstream code that expects a Date doesn’t crash
  if (this.instant && !this.scheduledFor) {
    this.scheduledFor = new Date();
  }
  next();
});

/* --------------------------------- Indexes ---------------------------------- */
BookingSchema.index({ proId: 1, scheduledFor: -1 });
BookingSchema.index({ clientUid: 1, createdAt: -1 });

export const Booking =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);
