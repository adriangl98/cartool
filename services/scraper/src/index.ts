import express from "express";
import helmet from "helmet";
import { Pool } from "pg";
import { Queue } from "bullmq";
import {
  validateEnv,
  createRedisClient,
  redisClient,
  QUEUE_NAMES,
} from "@cartool/shared";
import { BrowserLauncher } from "./browser";
import { ScrapeOrchestrator, ScrapeWorker } from "./orchestrator";
import { VinEnrichmentWorker } from "./enrichment";
import type { ScrapeJobPayload, EnrichmentJobPayload } from "./types";

validateEnv(["DATABASE_URL", "REDIS_URL", "PROXY_LIST"]);

const app = express();
app.use(helmet());
const port = Number(process.env["PORT"] ?? 3003);

// ── Database pool ──────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

// ── BullMQ queues (each needs a dedicated Redis connection) ────────────────
const scrapeQueue = new Queue<ScrapeJobPayload>(QUEUE_NAMES.SCRAPE, {
  connection: createRedisClient(),
});

const enrichmentQueue = new Queue<EnrichmentJobPayload>(QUEUE_NAMES.ENRICHMENT, {
  connection: createRedisClient(),
});

// ── Orchestrator + Worker ──────────────────────────────────────────────────
const orchestrator = new ScrapeOrchestrator(pool, scrapeQueue);

new ScrapeWorker({
  connection: createRedisClient(),
  enrichmentQueue,
  redis: redisClient,
  pool,
});

// ── Enrichment Worker ─────────────────────────────────────────────────────
new VinEnrichmentWorker({
  connection: createRedisClient(),
  pool,
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "scraper" });
});

app.get("/scraper/status", async (_req, res) => {
  try {
    const counts = await scrapeQueue.getJobCounts("waiting", "active", "failed");

    const dealerResult = await pool.query<{ id: string }>(
      "SELECT id FROM dealers WHERE is_active = TRUE",
    );

    const dealers = await Promise.all(
      dealerResult.rows.map(async ({ id }) => ({
        dealerId: id,
        lastRun: await redisClient.get(`scraped:${id}:last_run`),
      })),
    );

    res.json({ ...counts, dealers });
  } catch (err) {
    console.error(
      JSON.stringify({ level: "error", message: "Status check failed", error: String(err) }),
    );
    res.status(500).json({ error: "Status check failed" });
  }
});

// ── Startup ────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  // Verify stealth Chromium is launchable
  const { browser } = await BrowserLauncher.launch();
  const version = browser.version();
  await browser.close();
  console.log(
    JSON.stringify({ level: "info", message: "Chromium verified (stealth)", version }),
  );

  // Schedule all active dealers
  await orchestrator.start();
}

start().catch((err) => {
  console.error(
    JSON.stringify({ level: "error", message: "Startup failed", error: String(err) }),
  );
  process.exit(1);
});

app.listen(port, () => {
  console.log(
    JSON.stringify({ level: "info", message: `scraper service listening on ${port}` }),
  );
});

