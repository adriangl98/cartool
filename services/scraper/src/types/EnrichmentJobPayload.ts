import type { RawListing } from "./RawListing";

/**
 * Payload enqueued by `ScrapeWorker` into the `enrichment-jobs` BullMQ queue.
 * Consumed by `VinEnrichmentWorker` (spec §5.5 / F03.5).
 */
export interface EnrichmentJobPayload {
  /** UUID of the dealer that owns this listing. */
  dealerId: string;
  /** Raw listing data as produced by the platform extractor. */
  listing: RawListing;
}
