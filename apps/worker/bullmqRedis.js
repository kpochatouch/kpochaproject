// apps/worker/bullmqRedis.js
import IORedis from "ioredis";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[worker] Missing env ${name}`);
  return v;
}

const url = mustEnv("REDIS_URL");

const bullRedis = new IORedis(url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  tls: url.startsWith("rediss://") ? {} : undefined,
});

bullRedis.on("ready", async () => {
  try {
    const pong = await bullRedis.ping();
    console.log("[worker] ✅ redis ready:", pong);
  } catch (e) {
    console.error("[worker] ❌ redis ping failed:", e?.message || e);
  }
});

bullRedis.on("error", (e) => {
  console.error("[worker] ❌ redis error:", e?.message || e);
});

export default bullRedis;
