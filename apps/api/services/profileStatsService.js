// apps/api/services/profileStatsService.js
import Follow from "../models/Follow.js";
import Post from "../models/Post.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";

export async function computeProfileStats(ownerUid) {
  if (!ownerUid) {
    return {
      followers: 0,
      postsCount: 0,
      jobsCompleted: 0,
      avgRating: 0,
    };
  }

  const [followers, postsCount, jobsCompleted, pro] = await Promise.all([
    // fresh counts (robust, even if metrics get out of sync)
    Follow.countDocuments({ targetUid: ownerUid }),

    Post.countDocuments({
      proOwnerUid: ownerUid,
      hidden: { $ne: true },
      deleted: { $ne: true },
    }),

    Booking.countDocuments({
      proOwnerUid: ownerUid,
      status: "completed",
    }),

    // grab metrics for rating
    Pro.findOne({ ownerUid }).select("metrics").lean(),
  ]);

  let avgRating = 0;
  if (pro && pro.metrics) {
    const totalReviews = Number(pro.metrics.totalReviews || 0);
    const metricsAvg = Number(pro.metrics.avgRating || 0);
    if (totalReviews > 0 && Number.isFinite(metricsAvg) && metricsAvg > 0) {
      avgRating = metricsAvg;
    }
  }

  return {
    followers,
    postsCount,
    jobsCompleted,
    avgRating,
  };
}
