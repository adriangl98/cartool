"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ScrapeOrchestrator_1 = require("../../src/orchestrator/ScrapeOrchestrator");
// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock("@cartool/shared", () => ({
    QUEUE_NAMES: {
        SCRAPE: "scrape-jobs",
        ENRICHMENT: "enrichment-jobs",
        NOTIFICATION: "notification-jobs",
    },
}));
const mockUpsertJobScheduler = jest.fn().mockResolvedValue(undefined);
const mockQuery = jest.fn();
const mockPool = { query: mockQuery };
const mockQueue = { upsertJobScheduler: mockUpsertJobScheduler };
// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------
const DEALER_WITH_SPECIALS = {
    id: "dealer-uuid-1",
    platform: "dealer.com",
    inventory_url: "https://sames.nissan.com/new-inventory/index.htm",
    specials_url: "https://sames.nissan.com/specials/",
};
const DEALER_WITHOUT_SPECIALS = {
    id: "dealer-uuid-2",
    platform: "sincro",
    inventory_url: "https://toyotalaredo.com/searchnew.aspx",
    specials_url: null,
};
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function upsertCallsForDealer(dealerId) {
    return mockUpsertJobScheduler.mock.calls
        .filter(([id]) => id.includes(dealerId));
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ScrapeOrchestrator", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, "log").mockImplementation(() => { });
        mockQuery.mockResolvedValue({ rows: [DEALER_WITH_SPECIALS, DEALER_WITHOUT_SPECIALS] });
    });
    // ── DB query ─────────────────────────────────────────────────────────────
    it("queries only active dealers on start()", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(mockQuery.mock.calls[0][0]).toContain("is_active = TRUE");
    });
    // ── Inventory schedule ───────────────────────────────────────────────────
    it("schedules one inventory job per dealer with a 6-hour repeat", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        const inventoryCalls = mockUpsertJobScheduler.mock.calls
            .filter(([id]) => id.startsWith("inventory:"));
        expect(inventoryCalls).toHaveLength(2);
        for (const [, repeatOpts] of inventoryCalls) {
            expect(repeatOpts.every).toBe(6 * 60 * 60 * 1000);
        }
    });
    it("sets jobType=inventory and correct url on inventory jobs", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        const calls = upsertCallsForDealer(DEALER_WITH_SPECIALS.id).filter(([id]) => id.startsWith("inventory:"));
        expect(calls).toHaveLength(1);
        const jobTemplate = calls[0][2];
        expect(jobTemplate.data.jobType).toBe("inventory");
        expect(jobTemplate.data.url).toBe(DEALER_WITH_SPECIALS.inventory_url);
        expect(jobTemplate.data.platform).toBe(DEALER_WITH_SPECIALS.platform);
    });
    it("configures inventory jobs with 3 attempts and exponential back-off at 8s", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        const [, , jobTemplate] = mockUpsertJobScheduler.mock.calls
            .find(([id]) => id.startsWith("inventory:"));
        expect(jobTemplate.opts.attempts).toBe(3);
        expect(jobTemplate.opts.backoff.type).toBe("exponential");
        expect(jobTemplate.opts.backoff.delay).toBe(8000);
    });
    // ── Specials schedule ────────────────────────────────────────────────────
    it("schedules one specials job for a dealer that has specials_url", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        const specialsCalls = mockUpsertJobScheduler.mock.calls
            .filter(([id]) => id.startsWith("specials:"));
        expect(specialsCalls).toHaveLength(1);
        expect(specialsCalls[0][0]).toBe(`specials:${DEALER_WITH_SPECIALS.id}`);
    });
    it("does NOT schedule a specials job when specials_url is null", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        const specialsCalls = mockUpsertJobScheduler.mock.calls
            .filter(([id]) => id === `specials:${DEALER_WITHOUT_SPECIALS.id}`);
        expect(specialsCalls).toHaveLength(0);
    });
    it("schedules specials job with 12-hour repeat and jobType=specials", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        const [, repeatOpts, jobTemplate] = mockUpsertJobScheduler.mock.calls
            .find(([id]) => id.startsWith("specials:"));
        expect(repeatOpts.every).toBe(12 * 60 * 60 * 1000);
        expect(jobTemplate.data.jobType).toBe("specials");
        expect(jobTemplate.data.url).toBe(DEALER_WITH_SPECIALS.specials_url);
    });
    // ── Buy-rates schedule ───────────────────────────────────────────────────
    it("schedules one buy_rates job per dealer with a monthly cron pattern", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        const buyRatesCalls = mockUpsertJobScheduler.mock.calls
            .filter(([id]) => id.startsWith("buy_rates:"));
        expect(buyRatesCalls).toHaveLength(2);
        for (const [, repeatOpts, jobTemplate] of buyRatesCalls) {
            expect(repeatOpts.pattern).toBe("0 0 1 * *");
            expect(jobTemplate.data.jobType).toBe("buy_rates");
        }
    });
    // ── Total call count ─────────────────────────────────────────────────────
    it("calls upsertJobScheduler 5 times for 2 dealers (one with specials, one without)", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        // dealer-1: inventory + specials + buy_rates = 3
        // dealer-2: inventory + buy_rates = 2
        expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(5);
    });
    // ── Idempotency ──────────────────────────────────────────────────────────
    it("calling start() twice doubles the upsert calls (idempotency is on BullMQ side)", async () => {
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        await orchestrator.start();
        expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(10);
    });
    // ── Logging ──────────────────────────────────────────────────────────────
    it("logs a structured summary after scheduling with dealersScheduled count", async () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => { });
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        expect(logSpy).toHaveBeenCalledTimes(1);
        const logArg = JSON.parse(logSpy.mock.calls[0][0]);
        expect(logArg.level).toBe("info");
        expect(logArg.dealersScheduled).toBe(2);
        expect(typeof logArg.queueName).toBe("string");
    });
    // ── Empty dealer list ────────────────────────────────────────────────────
    it("logs 0 dealers scheduled when no active dealers exist", async () => {
        mockQuery.mockResolvedValue({ rows: [] });
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => { });
        const orchestrator = new ScrapeOrchestrator_1.ScrapeOrchestrator(mockPool, mockQueue);
        await orchestrator.start();
        expect(mockUpsertJobScheduler).not.toHaveBeenCalled();
        const logArg = JSON.parse(logSpy.mock.calls[0][0]);
        expect(logArg.dealersScheduled).toBe(0);
    });
});
