"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScrapeWorker = void 0;
exports.processScrapeJob = processScrapeJob;
const bullmq_1 = require("bullmq");
const shared_1 = require("@cartool/shared");
const extractors_1 = require("../extractors");
const EXTRACTOR_MAP = {
    "dealer.com": extractors_1.DealerDotComExtractor,
    sincro: extractors_1.SincroExtractor,
    dealeron: extractors_1.DealerOnExtractor,
    dealer_inspire: extractors_1.DealerInspireExtractor,
};
/** Max simultaneous Playwright browser instances (spec §12). */
const MAX_CONCURRENCY = 20;
/**
 * Extracted processor function — exported for direct unit testing.
 *
 * Routes a scrape job to the correct extractor by platform, enqueues each
 * resulting RawListing as an `enrich-listing` job for E03, and records the
 * dealer's last-run timestamp in Redis.
 */
async function processScrapeJob(job, deps) {
    const { dealerId, url, platform, jobType } = job.data;
    // buy_rates extractor not yet implemented — skip gracefully
    if (jobType === "buy_rates") {
        console.log(JSON.stringify({
            level: "info",
            message: "buy_rates scrape not yet implemented — skipping",
            dealerId,
        }));
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
    const listings = await extractor.run();
    if (listings.length > 0) {
        await deps.enrichmentQueue.addBulk(listings.map((listing) => ({
            name: "enrich-listing",
            data: { dealerId, listing },
        })));
    }
    await deps.redis.set(`scraped:${dealerId}:last_run`, new Date().toISOString());
    console.log(JSON.stringify({
        level: "info",
        message: "Scrape job completed",
        dealerId,
        url,
        platform,
        jobType,
        listingsFound: listings.length,
    }));
}
/**
 * BullMQ worker that consumes `scrape-jobs`, dispatches each job to the
 * correct platform extractor, and pipelines results to the enrichment queue.
 *
 * Concurrency is capped at 20 simultaneous Playwright instances (spec §12).
 */
class ScrapeWorker {
    worker;
    constructor(opts) {
        this.worker = new bullmq_1.Worker(shared_1.QUEUE_NAMES.SCRAPE, (job) => processScrapeJob(job, opts), { connection: opts.connection, concurrency: MAX_CONCURRENCY });
        this.worker.on("failed", (job, err) => {
            console.error(JSON.stringify({
                level: "error",
                message: "Scrape job failed",
                dealerId: job?.data.dealerId,
                url: job?.data.url,
                attemptsMade: job?.attemptsMade,
                error: String(err),
            }));
        });
    }
}
exports.ScrapeWorker = ScrapeWorker;
