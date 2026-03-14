//apps/api/models/Advert.js
import mongoose from "mongoose";

const AdvertMediaSchema = new mongoose.Schema(
  {
    assetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MediaAsset",
      required: true,
    },
    thumbnailAssetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MediaAsset",
      default: null,
    },
    type: {
      type: String,
      enum: ["image", "video"],
      required: true,
    },
  },
  { _id: false },
);

const AdvertSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, index: true },

    title: { type: String, default: "" },
    text: { type: String, default: "" },

    media: {
      type: [AdvertMediaSchema],
      default: [],
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: "Advert must include at least one media item",
      },
    },

    placements: {
      type: [String],
      default: [],
      enum: ["feed", "stories", "right_rail"],
    },

    goal: {
      type: String,
      enum: [
        "profile_visits",
        "bookings",
        "messages",
        "post_views",
        "website_clicks",
      ],
      required: true,
    },

    actionType: {
      type: String,
      enum: ["profile", "booking", "chat", "post", "external_url"],
      required: true,
    },

    actionValue: { type: String, default: "" },
    buttonLabel: { type: String, default: "Learn more" },

    status: {
      type: String,
      enum: [
        "draft",
        "submitted",
        "approved",
        "active",
        "rejected",
        "paused",
        "ended",
      ],
      default: "draft",
      index: true,
    },

    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },

    budget: { type: Number, default: 0 },
    currency: { type: String, default: "NGN" },

    rejectionReason: { type: String, default: "" },

    priority: { type: Number, default: 0, index: true },

    impressionsCount: { type: Number, default: 0 },
    clicksCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

AdvertSchema.index({ status: 1, startsAt: 1, endsAt: 1 });
AdvertSchema.index({ placements: 1, status: 1, startsAt: 1, endsAt: 1 });
AdvertSchema.index({ ownerUid: 1, createdAt: -1 });

const Advert = mongoose.models.Advert || mongoose.model("Advert", AdvertSchema);

export default Advert;
