// apps/api/models/PostStats.js
import mongoose from "mongoose";

const DailyBucketSchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // e.g. "2025-10-27"
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
  },
  { _id: false },
);

const PostStatsSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      unique: true,
      index: true,
    },

    // running totals (single source of truth for engagement)
    viewsCount: { type: Number, default: 0 },
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    sharesCount: { type: Number, default: 0 },
    savesCount: { type: Number, default: 0 },

    // per-user sets for idempotency (optional but handy)
    likedBy: { type: [String], default: [] }, // uids
    savedBy: { type: [String], default: [] },
    sharedBy: { type: [String], default: [] },

    // ranking
    trendingScore: { type: Number, default: 0, index: true },

    // analytics
    daily: { type: [DailyBucketSchema], default: [] },

    lastEngagedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const PostStats =
  mongoose.models.PostStats || mongoose.model("PostStats", PostStatsSchema);
export default PostStats;
