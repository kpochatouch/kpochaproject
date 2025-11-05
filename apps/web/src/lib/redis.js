// apps/api/lib/redis.js
import { createClient } from "redis";

const url = process.env.REDIS_URL;

let redis = null;

if (url) {
  const client = createClient({ url });

  client.on("connect", () => console.log("[redis] ✅ Connected"));
  client.on("error", (err) => console.error("[redis] ❌ Error:", err?.message || err));

  try {
    await client.connect();
    redis = client;
  } catch (err) {
    console.error("[redis] ❌ Failed to connect, continuing without Redis:", err?.message || err);
    redis = null;
  }
} else {
  console.warn("[redis] ℹ️ REDIS_URL not set, Redis disabled");
  redis = null;
}

export default redis;
