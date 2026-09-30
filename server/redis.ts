// Redis: rate limits, lockouts, one-time tokens and the revocation channel. A second connection is needed
// for subscribing (a subscribed connection can't run other commands).
import { Redis } from 'ioredis';

/** Published with an account id whenever that account's live game connections must close. */
export const REVOCATION_CHANNEL = 'oc:revogacao';

export function createRedis(url: string) {
  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  redis.on('error', (err) => console.error('[redis]', err.message));
  return redis;
}

export type RedisClient = ReturnType<typeof createRedis>;

/**
 * Fixed-window counter: returns how many hits `key` has in the current window (the window starts on the
 * first hit and lasts `seconds`).
 */
export async function hit(redis: RedisClient, key: string, seconds: number): Promise<number> {
  const [[, n]] = (await redis.multi().incr(key).expire(key, seconds, 'NX').exec()) as [[unknown, number], unknown];
  return n;
}
