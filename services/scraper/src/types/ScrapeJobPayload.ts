/**
 * Payload for a scrape-jobs BullMQ job.
 * Each job targets one dealer URL for a specific job type.
 */
export interface ScrapeJobPayload {
  /** UUID of the dealer record in the dealers table. */
  dealerId: string;
  /** The URL to scrape (inventory_url or specials_url). */
  url: string;
  /** Dealer platform identifier — must match a key in EXTRACTOR_MAP. */
  platform: string;
  /** Determines which scrape logic to run. */
  jobType: "inventory" | "specials" | "buy_rates";
}
