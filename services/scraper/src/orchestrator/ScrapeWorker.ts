import { Worker, Queue, type Job } from "bullmq";
import type Redis from "ioredis";
import { QUEUE_NAMES } from "@cartool/shared";
import type { ScrapeJobPayload } from "../types/ScrapeJobPayload";
import type { RawListing } from "../types/RawListing";
import {
  BaseExtractor,
  DealerDotComExtractor,
  DealerInspireExtractor,
  DealerOnExtractor,
  SincroExtractor,
  type ExtractorConfig,
} from "../extractors";

type ExtractorConstructor = new (config: ExtractorConfig) => BaseExtractor;

const EXTRACTOR_MAP: Record<string, ExtractorConstructor> = {
  "dealer.com": DealerDotComExtractor,
  sincro: SincroExtractor,
  dealeron: DealerOnExtractor,
  dealer_inspire: DealerInspireExtractor,
};

/** Max simultaneous Playwright browser instances (spec §12). */
const MAX_CONCURRENCY = 20;

export interface ProcessJobDeps {
  enrichmentQueue: Queue;
  redis: Pick<Redis, "set">;
}

/**
 * Extracted processor function — exported for direct unit testing.
 *
 * Routes a scrape job to the correct extractor by platform, enqueues each
 * resulting RawListing as an `enrich-listing` job for E03, and records the
 * dealer's last-run timestamp in Redis.
 */
export async function processScrapeJob(
  job: Job<ScrapeJobPayload>,
  deps: ProcessJobDeps,
): Promise<void> {
  const { dealerId, url, platform, jobType } = job.data;

  // buy_rates extractor not yet implemented — skip gracefully
  if (jobType === "buy_rates") {
    console.log(
      JSON.stringify({
        level: "info",
        message: "buy_rates scrape not yet implemented — skipping",
        dealerId,
      }),
    );
    return;
  }

  const ExtractorClass = EXTRACTOR_MAP[platform];
  if (!ExtractorClass) {
    // Throw so BullMQ retries (and eventually dead-letters) the job
    throw new Error(`Unknown platform: ${platform}`);
  }

  const extractor = new ExtractorClass({
    dealerId,
    targetUrl: url,
    dealerDomain: new URL(url).hostname,
  });

  const listings: RawListing[] = await extractor.run();

  if (listings.length > 0) {
    await deps.enrichmentQueue.addBulk(
      listings.map((listing) => ({
        name: "enrich-listing",
        data: { dealerId, listing },
      })),
    );
  }

  await deps.redis.set(`scraped:${dealerId}:last_run`, new Date().toISOString());

  console.log(
    JSON.stringify({
      level: "info",
      message: "Scrape job completed",
      dealerId,
      url,
      platform,
      jobType,
      listingsFound: listings.length,
    }),
  );
}

export interface ScrapeWorkerOptions {
  /** Dedicated ioredis connection for the BullMQ Worker. */
  connection: Redis;
  /** BullMQ Queue used to enqueue enrichment jobs for E03. */
  enrichmentQueue: Queue;
  /** Redis client used for writing per-dealer last-run timestamps. */
  redis: Pick<Redis, "set">;
}

/**
 * BullMQ worker that consumes `scrape-jobs`, dispatches each job to the
 * correct platform extractor, and pipelines results to the enrichment queue.
 *
 * Concurrency is capped at 20 simultaneous Playwright instances (spec §12).
 */
export class ScrapeWorker {
  readonly worker: Worker<ScrapeJobPayload>;

  constructor(opts: ScrapeWorkerOptions) {
    this.worker = new Worker<ScrapeJobPayload>(
      QUEUE_NAMES.SCRAPE,
      (job) => processScrapeJob(job, opts),
      { connection: opts.connection, concurrency: MAX_CONCURRENCY },
    );

    this.worker.on(
      "failed",
      (job: Job<ScrapeJobPayload> | undefined, err: Error) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "Scrape job failed",
            dealerId: job?.data.dealerId,
            url: job?.data.url,
            attemptsMade: job?.attemptsMade,
            error: String(err),
          }),
        );
      },
    );
  }
}
