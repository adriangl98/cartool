/**
 * BullMQ queue name constants.
 * Always import from here — never use magic strings inline.
 */
export const QUEUE_NAMES = {
  SCRAPE: "scrape-jobs",
  ENRICHMENT: "enrichment-jobs",
  NOTIFICATION: "notification-jobs",
} as const;

/** Deal Score cache TTL in seconds (spec §3). */
export const CACHE_TTL_SECONDS = 3600;
