import type { Pool } from "pg";
import type { Queue } from "bullmq";
import { QUEUE_NAMES } from "@cartool/shared";
import type { ScrapeJobPayload } from "../types/ScrapeJobPayload";

interface DealerRow {
  id: string;
  platform: string;
  inventory_url: string;
  specials_url: string | null;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const BUY_RATES_CRON = "0 0 1 * *"; // midnight on the 1st of each month

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 8000 },
} as const;

/**
 * Loads all active dealers from the database on startup and registers
 * idempotent BullMQ repeat schedules for each dealer:
 *   - inventory  : every 6 hours
 *   - specials   : every 12 hours (only when specials_url is set)
 *   - buy_rates  : 1st of each month (cron)
 *
 * Uses `upsertJobScheduler` so schedules survive service restarts without
 * creating duplicate jobs.
 */
export class ScrapeOrchestrator {
  constructor(
    private readonly pool: Pool,
    private readonly queue: Queue<ScrapeJobPayload>,
  ) {}

  async start(): Promise<void> {
    const result = await this.pool.query<DealerRow>(
      "SELECT id, platform, inventory_url, specials_url FROM dealers WHERE is_active = TRUE",
    );

    let scheduled = 0;

    for (const dealer of result.rows) {
      // Inventory — every 6 hours
      await this.queue.upsertJobScheduler(
        `inventory:${dealer.id}`,
        { every: SIX_HOURS_MS },
        {
          name: "scrape-job",
          data: {
            dealerId: dealer.id,
            url: dealer.inventory_url,
            platform: dealer.platform,
            jobType: "inventory",
          },
          opts: DEFAULT_JOB_OPTS,
        },
      );

      // Specials — every 12 hours (only if specials_url is set)
      if (dealer.specials_url) {
        await this.queue.upsertJobScheduler(
          `specials:${dealer.id}`,
          { every: TWELVE_HOURS_MS },
          {
            name: "scrape-job",
            data: {
              dealerId: dealer.id,
              url: dealer.specials_url,
              platform: dealer.platform,
              jobType: "specials",
            },
            opts: DEFAULT_JOB_OPTS,
          },
        );
      }

      // Buy rates — 1st of each month at midnight
      await this.queue.upsertJobScheduler(
        `buy_rates:${dealer.id}`,
        { pattern: BUY_RATES_CRON },
        {
          name: "scrape-job",
          data: {
            dealerId: dealer.id,
            url: dealer.inventory_url,
            platform: dealer.platform,
            jobType: "buy_rates",
          },
          opts: DEFAULT_JOB_OPTS,
        },
      );

      scheduled++;
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "ScrapeOrchestrator started",
        dealersScheduled: scheduled,
        queueName: QUEUE_NAMES.SCRAPE,
      }),
    );
  }
}
