// apps/api/scripts/readMatches.js
import redis from "../redis.js"; // uses your existing redis.js
async function main() {
  try {
    console.log("[readMatches] connected? (redis client present):", !!redis);
    // WARNING: scan may list many keys; use pattern you expect
    const keys = await redis.keys("match:*");
    console.log("[readMatches] keys:", keys);
    for (const k of keys) {
      try {
        const h = await redis.hGetAll(k);
        console.log(k, "=>", h);
      } catch (e) {
        console.warn("failed to read", k, e?.message || e);
      }
    }
  } catch (e) {
    console.error("readMatches error:", e?.stack || e);
  } finally {
    // Don't force quit — let runtime exit
    process.exit(0);
  }
}
main();
