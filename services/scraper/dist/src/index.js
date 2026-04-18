"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const pg_1 = require("pg");
const bullmq_1 = require("bullmq");
const shared_1 = require("@cartool/shared");
const browser_1 = require("./browser");
const orchestrator_1 = require("./orchestrator");
(0, shared_1.validateEnv)(["DATABASE_URL", "REDIS_URL", "PROXY_LIST"]);
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
const port = Number(process.env["PORT"] ?? 3003);
// ── Database pool ──────────────────────────────────────────────────────────
const pool = new pg_1.Pool({ connectionString: process.env["DATABASE_URL"] });
// ── BullMQ queues (each needs a dedicated Redis connection) ────────────────
const scrapeQueue = new bullmq_1.Queue(shared_1.QUEUE_NAMES.SCRAPE, {
    connection: (0, shared_1.createRedisClient)(),
});
const enrichmentQueue = new bullmq_1.Queue(shared_1.QUEUE_NAMES.ENRICHMENT, {
    connection: (0, shared_1.createRedisClient)(),
});
// ── Orchestrator + Worker ──────────────────────────────────────────────────
const orchestrator = new orchestrator_1.ScrapeOrchestrator(pool, scrapeQueue);
new orchestrator_1.ScrapeWorker({
    connection: (0, shared_1.createRedisClient)(),
    enrichmentQueue,
    redis: shared_1.redisClient,
});
// ── Routes ─────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "scraper" });
});
app.get("/scraper/status", async (_req, res) => {
    try {
        const counts = await scrapeQueue.getJobCounts("waiting", "active", "failed");
        const dealerResult = await pool.query("SELECT id FROM dealers WHERE is_active = TRUE");
        const dealers = await Promise.all(dealerResult.rows.map(async ({ id }) => ({
            dealerId: id,
            lastRun: await shared_1.redisClient.get(`scraped:${id}:last_run`),
        })));
        res.json({ ...counts, dealers });
    }
    catch (err) {
        console.error(JSON.stringify({ level: "error", message: "Status check failed", error: String(err) }));
        res.status(500).json({ error: "Status check failed" });
    }
});
// ── Startup ────────────────────────────────────────────────────────────────
async function start() {
    // Verify stealth Chromium is launchable
    const { browser } = await browser_1.BrowserLauncher.launch();
    const version = browser.version();
    await browser.close();
    console.log(JSON.stringify({ level: "info", message: "Chromium verified (stealth)", version }));
    // Schedule all active dealers
    await orchestrator.start();
}
start().catch((err) => {
    console.error(JSON.stringify({ level: "error", message: "Startup failed", error: String(err) }));
    process.exit(1);
});
app.listen(port, () => {
    console.log(JSON.stringify({ level: "info", message: `scraper service listening on ${port}` }));
});
