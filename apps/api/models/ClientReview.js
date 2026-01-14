// apps/api/models/ClientReview.js
import mongoose from "mongoose";

const ClientReviewSchema = new mongoose.Schema(
  {
    // who wrote it (typically a pro)
    reviewerUid: { type: String, index: true, required: true },
    reviewerRole: { type: String, enum: ["pro", "admin"], default: "pro" },

    // target is a CLIENT (by uid)
    clientUid: { type: String, index: true, required: true },

    // optional: link back to a booking
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: false,
      index: true,
    },

    // rating + text
    rating: { type: Number, min: 1, max: 5, required: true },
    title: { type: String, default: "" },
    comment: { type: String, default: "" },
    photos: { type: [String], default: [] },

    // moderation / lifecycle
    status: {
      type: String,
      enum: ["public", "hidden", "deleted"],
      default: "public",
      index: true,
    },
  },
  { timestamps: true },
);

ClientReviewSchema.index({ clientUid: 1, createdAt: -1 });
// one review per (reviewer -> client). If you ever want multiple, drop this unique index.
ClientReviewSchema.index({ reviewerUid: 1, clientUid: 1 }, { unique: true });

export const ClientReview =
  mongoose.models.ClientReview ||
  mongoose.model("ClientReview", ClientReviewSchema);
