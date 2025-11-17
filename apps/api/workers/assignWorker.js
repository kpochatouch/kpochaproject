// Optional: simple background worker that can re-check active match requests and
// escalate or clean stale ones. This file is intentionally small and optional.
import redis from "../redis.js";

export async function sweepMatches() {
  try {
    // scan keys match:*
    const keys = await redis.keys("match:*");
    for (const k of keys) {
      const h = await redis.hGetAll(k);
      // if searching older than TTL, delete
      const created = Number(h.createdAt || 0);
      if (created && Date.now() - created > 35 * 1000) {
        await redis.del(k);
      }
    }
  } catch (e) {
    console.error("[assignWorker] sweep error:", e);
  }
}

// If you want to run periodically: set up a small cron in server.js to import and call sweepMatches()
