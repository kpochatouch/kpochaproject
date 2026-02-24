//apps/api/bullmqRedis.js
import IORedis from "ioredis";

const url = process.env.REDIS_URL || "";
if (!url) console.warn("[bullmq] REDIS_URL missing");

const bullRedis = new IORedis(url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: url.startsWith("rediss://") ? {} : undefined,
});

export default bullRedis;
