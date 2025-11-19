// apps/api/redis.js
import { createClient } from "redis";

const url = process.env.REDIS_URL;

let redis = null;
let baseClient = null;

if (url) {
  const client = createClient({ url });
  baseClient = client;

  client.on("connect", () => console.log("[redis] ✅ Connected"));
  client.on("error", (err) => console.error("[redis] ❌ Error:", err?.message || err));

  try {
    // top-level await is fine because your server.js is ESM
    await client.connect();
    redis = client;
  } catch (err) {
    console.error(
      "[redis] ❌ Failed to connect, continuing without Redis:",
      err?.message || err
    );
    redis = null;
  }
} else {
  console.warn("[redis] ℹ️ REDIS_URL not set, Redis disabled");
  redis = null;
}

/**
 * createSubscriber()
 * Preferred way to create a dedicated Redis subscriber client (duplicates main client).
 * Returns the connected duplicate client or null on failure.
 */
export async function createSubscriber() {
  if (!baseClient) return null;
  if (typeof baseClient.duplicate !== "function") {
    console.warn("[redis] ⚠️ duplicate() not available on this Redis client");
    return null;
  }
  try {
    const sub = baseClient.duplicate();
    await sub.connect();
    return sub;
  } catch (err) {
    console.warn("[redis] ⚠️ Failed to create dedicated subscriber:", err?.message || err);
    return null;
  }
}

export default redis;
