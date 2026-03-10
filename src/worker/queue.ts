import IORedis from 'ioredis';

// ─── Queue name ───────────────────────────────────────────────────────────────
export const TRANSCRIPTION_QUEUE = 'transcription';

// ─── Job payloads ─────────────────────────────────────────────────────────────

export interface TranscribeJobData {
  /** Record UUID to process */
  recordId: string;
  /** Path or URL to the stored video/audio file */
  blobUrl: string | null;
}

// ─── Redis connection factory ─────────────────────────────────────────────────

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
