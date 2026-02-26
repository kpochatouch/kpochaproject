// apps/api/services/profileStatsService.js
import Follow from "../models/Follow.js";
import Post from "../models/Post.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";

/**
 * Canonical profile stats for public profile display
 * - followers: how many follow this ownerUid
 * - postsCount: public, not hidden, not deleted posts authored by this ownerUid (tolerant)
 * - jobsCompleted: completed bookings for this ownerUid (tolerant)
 * - avgRating: from Pro.metrics if present
 */
export async function computeProfileStats(ownerUid) {
  const uid = String(ownerUid || "").trim();
  if (!uid) {
    return { followers: 0, postsCount: 0, jobsCompleted: 0, avgRating: 0 };
  }

  const postsOwnerOr = [
    { proOwnerUid: uid },
    { ownerUid: uid },
    { proUid: uid },
    { createdBy: uid },
  ];

  const [followers, postsCount, jobsCompleted, pro] = await Promise.all([
    Follow.countDocuments({ targetUid: uid }).catch(() => 0),

    Post.countDocuments({
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
      $or: postsOwnerOr,
    }).catch(() => 0),

    Booking.countDocuments({
      status: "completed",
      $or: [{ proOwnerUid: uid }, { proUid: uid }],
    }).catch(() => 0),

    Pro.findOne({ ownerUid: uid })
      .select("metrics")
      .lean()
      .catch(() => null),
  ]);

  let avgRating = 0;
  if (pro?.metrics) {
    const totalReviews = Number(pro.metrics.totalReviews || 0);
    const metricsAvg = Number(pro.metrics.avgRating || 0);
    if (totalReviews > 0 && Number.isFinite(metricsAvg) && metricsAvg > 0) {
      avgRating = metricsAvg;
    }
  }

  return {
    followers: Number(followers || 0),
    postsCount: Number(postsCount || 0),
    jobsCompleted: Number(jobsCompleted || 0),
    avgRating: Number(avgRating || 0),
  };
}
