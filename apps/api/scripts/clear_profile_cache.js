// apps/api/scripts/clear_profile_cache.js
import redisClient from '../redis.js';

async function main() {
  try {
    if (!redisClient) {
      console.error('Redis client not available (REDIS_URL may be unset).');
      process.exit(2);
    }

    console.log('[info] connected? client truthy ->', !!redisClient);

    const keysAll = await redisClient.keys('public:profile*');
    console.log('[info] public:profile keys:', keysAll);

    const uid = 'ldzCvKGbGheOtHQ3qvKs1nMRdDg2';
    const keysUid = await redisClient.keys(`*${uid}*`);
    console.log('[info] keys matching uid:', keysUid);

    if (keysUid.length) {
      for (const k of keysUid) {
        const res = await redisClient.del(k);
        console.log('[deleted]', k, '->', res);
      }
    } else {
      console.log('[info] no uid-specific keys found.');
      if (process.env.CLEAR_ALL === 'true' && keysAll.length) {
        for (const k of keysAll) {
          const res = await redisClient.del(k);
          console.log('[deleted-all]', k, '->', res);
        }
      }
    }

    const left = await redisClient.keys('public:profile*');
    console.log('[info] keys after:', left);
    process.exit(0);
  } catch (err) {
    console.error('[error]', err);
    process.exit(1);
  }
}

main();
