// apps/api/workers/assignWorker.js
import redis from "../redis.js";

export async function sweepMatches() {
  try {
    if (!redis) {
      console.log("[sweepMatches] Redis not configured — sweep disabled");
      return;
    }

    // scan keys match:*
    const keys = await redis.keys("match:*");
    for (const k of keys) {
      const h = await redis.hGetAll(k);
      const created = Number(h.createdAt || 0);
      if (created && Date.now() - created > 35 * 1000) {
        await redis.del(k);
      }
    }
  } catch (e) {
    console.error("[assignWorker] sweep error:", e);
  }
}
