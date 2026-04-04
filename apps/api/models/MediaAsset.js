// apps/api/models/MediaAsset.js
import mongoose from "mongoose";

const MediaAssetSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, index: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", index: true },

    // ✅ Dedupe anchor for migrations/backfills:
    // Store the original Cloudinary secure_url (or any legacy url) used to create this asset.
    // This lets reruns re-use the same MediaAsset instead of creating duplicates.
    sourceUrl: { type: String, default: "", index: true },

    // ✅ Safety: explicit visibility
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "private",
      index: true,
    },

    type: {
      type: String,
      enum: ["video", "image"],
      required: true,
      index: true,
    },

    purpose: {
      type: String,
      enum: ["post", "story"],
      default: "post",
      index: true,
    },

    status: {
      type: String,
      enum: [
        "created",
        "uploading",
        "uploaded",
        "processing",
        "ready",
        "failed",
      ],
      default: "created",
      index: true,
    },

    original: {
      key: String,
      size: Number,
      contentType: String,
      durationSec: Number,
      width: Number,
      height: Number,
    },

    trim: {
      startSec: { type: Number, default: 0 },
      endSec: { type: Number, default: 0 },
      required: { type: Boolean, default: false },
      applied: { type: Boolean, default: false },
    },

    renditions: [
      {
        name: String,
        playlistKey: String,
        bandwidth: Number,
        width: Number,
        height: Number,
      },
    ],

    hls: {
      masterPlaylistKey: String,
    },

    thumbnail: {
      key: String,
      width: Number,
      height: Number,
    },

    error: {
      code: String,
      message: String,
      step: String,
    },

    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// ✅ Helpful indexes (non-unique = safe even if duplicates already exist)
MediaAssetSchema.index({ ownerUid: 1, createdAt: -1 });
MediaAssetSchema.index({ ownerUid: 1, sourceUrl: 1, createdAt: -1 });
MediaAssetSchema.index({ ownerUid: 1, "original.key": 1, createdAt: -1 });

export default mongoose.models.MediaAsset ||
  mongoose.model("MediaAsset", MediaAssetSchema);
