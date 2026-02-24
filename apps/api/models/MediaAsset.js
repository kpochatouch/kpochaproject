//apps/api/models/MediaAsset.js
import mongoose from "mongoose";

const MediaAssetSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, index: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", index: true },

    type: {
      type: String,
      enum: ["video", "image"],
      required: true,
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

    renditions: [
      {
        name: String, // 1080p / 720p / 480p
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

export default mongoose.models.MediaAsset ||
  mongoose.model("MediaAsset", MediaAssetSchema);
