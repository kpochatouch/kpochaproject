// apps/api/redis.js
import { createClient } from "redis";

const url = process.env.REDIS_URL;

let redis = null;

if (url) {
  const client = createClient({ url });

  client.on("connect", () => console.log("[redis] ✅ Connected"));
  client.on("error", (err) =>
    console.error("[redis] ❌ Error:", err?.message || err)
  );

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

export default redis;
