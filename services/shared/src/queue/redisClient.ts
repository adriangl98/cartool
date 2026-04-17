import Redis from "ioredis";

function getRedisUrl(): string {
  const url = process.env["REDIS_URL"];
  if (!url) {
    throw new Error(
      "RedisClient: missing required environment variable: REDIS_URL"
    );
  }
  return url;
}

/**
 * Create a new ioredis client from the REDIS_URL environment variable.
 * Throws on startup if REDIS_URL is not set.
 *
 * Use the exported `redisClient` singleton for most cases.
 * Call `createRedisClient()` when you need an isolated connection
 * (e.g. for a BullMQ worker that requires a dedicated connection).
 */
export function createRedisClient(): Redis {
  return new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
}

/** Pre-constructed singleton Redis client. */
export const redisClient = createRedisClient();
