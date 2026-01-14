// apps/api/models/Follow.js
import mongoose from "mongoose";

const FollowSchema = new mongoose.Schema(
  {
    followerUid: { type: String, required: true, index: true }, // who follows
    targetUid: { type: String, required: true, index: true }, // who is followed (Pro owner uid)
  },
  { timestamps: true },
);

// ensure one edge per pair
FollowSchema.index({ followerUid: 1, targetUid: 1 }, { unique: true });

const Follow = mongoose.models.Follow || mongoose.model("Follow", FollowSchema);
export default Follow;
