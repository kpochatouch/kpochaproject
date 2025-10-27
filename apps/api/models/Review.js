// apps/api/models/Review.js
import mongoose from "mongoose";

const ReviewSchema = new mongoose.Schema({
  // who wrote it
  reviewerUid: { type: String, index: true, required: true },
  reviewerRole: { type: String, enum: ["client", "pro"], default: "client" },

  // target is a Pro (primary use-case)
  proId: { type: mongoose.Schema.Types.ObjectId, ref: "Pro", index: true, required: true },

  // rating + text
  rating: { type: Number, min: 1, max: 5, required: true },
  title: { type: String, default: "" },
  comment: { type: String, default: "" },
  photos: { type: [String], default: [] },

  // moderation / lifecycle
  status: { type: String, enum: ["public", "hidden", "deleted"], default: "public", index: true },
}, { timestamps: true });

ReviewSchema.index({ proId: 1, createdAt: -1 });
ReviewSchema.index({ reviewerUid: 1, proId: 1 }, { unique: true }); 
// one review per (reviewer -> pro). If you want multiple, remove this unique index.

export const Review = mongoose.models.Review || mongoose.model("Review", ReviewSchema);
