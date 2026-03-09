import IORedis from 'ioredis';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates an IORedis connection suitable for BullMQ.
 * `maxRetriesPerRequest: null` is required by BullMQ.
 */
export function createRedisConnection(): IORedis {
  // Prefer an explicit REDIS_URL; fall back to REDIS_HOST + REDIS_PORT from .env.
  const url =
    process.env.REDIS_URL ??
    `redis://${process.env.REDIS_HOST ?? 'localhost'}:${process.env.REDIS_PORT ?? '6379'}`;

  return new IORedis(url, {
    maxRetriesPerRequest: null,
  });
}
