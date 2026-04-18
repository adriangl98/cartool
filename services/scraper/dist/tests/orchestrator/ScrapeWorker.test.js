"use strict";
// ---------------------------------------------------------------------------
// Mocks — declared before any import that touches them
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock("@cartool/shared", () => ({
    QUEUE_NAMES: {
        SCRAPE: "scrape-jobs",
        ENRICHMENT: "enrichment-jobs",
        NOTIFICATION: "notification-jobs",
    },
}));
const mockRun = jest.fn().mockResolvedValue([]);
const mockDealerDotCom = jest.fn().mockImplementation(() => ({ run: mockRun }));
const mockDealerInspire = jest.fn().mockImplementation(() => ({ run: mockRun }));
const mockDealerOn = jest.fn().mockImplementation(() => ({ run: mockRun }));
const mockSincro = jest.fn().mockImplementation(() => ({ run: mockRun }));
jest.mock("../../src/extractors", () => ({
    DealerDotComExtractor: mockDealerDotCom,
    DealerInspireExtractor: mockDealerInspire,
    DealerOnExtractor: mockDealerOn,
    SincroExtractor: mockSincro,
    BaseExtractor: jest.fn(),
}));
const mockWorkerOn = jest.fn();
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
jest.mock("bullmq", () => ({
    Worker: jest.fn().mockImplementation(() => ({
        on: mockWorkerOn,
        close: mockWorkerClose,
    })),
    Queue: jest.fn(),
}));
const mockAddBulk = jest.fn().mockResolvedValue([]);
const mockRedisSet = jest.fn().mockResolvedValue("OK");
const ScrapeWorker_1 = require("../../src/orchestrator/ScrapeWorker");
const bullmq_1 = require("bullmq");
const shared_1 = require("@cartool/shared");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeJob(data) {
    return { data, attemptsMade: 1 };
}
function makeDeps() {
    return {
        enrichmentQueue: { addBulk: mockAddBulk },
        redis: { set: mockRedisSet },
    };
}
const LISTING = {
    vin: "1HGBH41JXMN109186",
    year: 2024,
    make: "Toyota",
    model: "Camry",
    msrp: 28000,
    transactionType: "lease",
    scrapedAt: new Date("2026-04-17T00:00:00Z"),
};
// ---------------------------------------------------------------------------
// Tests — processScrapeJob
// ---------------------------------------------------------------------------
describe("processScrapeJob", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, "log").mockImplementation(() => { });
        jest.spyOn(console, "error").mockImplementation(() => { });
    });
    // ── Platform routing ─────────────────────────────────────────────────────
    it.each([
        ["dealer.com", mockDealerDotCom],
        ["sincro", mockSincro],
        ["dealeron", mockDealerOn],
        ["dealer_inspire", mockDealerInspire],
    ])("routes platform '%s' to the correct extractor", async (platform, ExtractorMock) => {
        const job = makeJob({
            dealerId: "dealer-1",
            url: "https://example.com/inventory",
            platform,
            jobType: "inventory",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        expect(ExtractorMock).toHaveBeenCalledTimes(1);
        expect(ExtractorMock).toHaveBeenCalledWith({
            dealerId: "dealer-1",
            targetUrl: "https://example.com/inventory",
            dealerDomain: "example.com",
        });
        expect(mockRun).toHaveBeenCalledTimes(1);
    });
    it("passes dealerDomain derived from the URL hostname", async () => {
        const job = makeJob({
            dealerId: "dealer-1",
            url: "https://sames.nissan.com/new-inventory/index.htm",
            platform: "dealer.com",
            jobType: "inventory",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        expect(mockDealerDotCom).toHaveBeenCalledWith(expect.objectContaining({ dealerDomain: "sames.nissan.com" }));
    });
    // ── buy_rates stub ────────────────────────────────────────────────────────
    it("skips extraction and does NOT call any extractor for buy_rates jobs", async () => {
        const job = makeJob({
            dealerId: "dealer-1",
            url: "https://example.com/inventory",
            platform: "dealer.com",
            jobType: "buy_rates",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        expect(mockRun).not.toHaveBeenCalled();
        expect(mockAddBulk).not.toHaveBeenCalled();
        expect(mockRedisSet).not.toHaveBeenCalled();
    });
    it("logs a structured 'not yet implemented' message for buy_rates", async () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => { });
        const job = makeJob({
            dealerId: "dealer-99",
            url: "https://example.com/inventory",
            platform: "dealer.com",
            jobType: "buy_rates",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        expect(logSpy).toHaveBeenCalledTimes(1);
        const logArg = JSON.parse(logSpy.mock.calls[0][0]);
        expect(logArg.level).toBe("info");
        expect(logArg.dealerId).toBe("dealer-99");
    });
    // ── Unknown platform ─────────────────────────────────────────────────────
    it("throws for an unknown platform so BullMQ can retry the job", async () => {
        const job = makeJob({
            dealerId: "dealer-1",
            url: "https://example.com/inventory",
            platform: "unknown-platform",
            jobType: "inventory",
        });
        await expect((0, ScrapeWorker_1.processScrapeJob)(job, makeDeps())).rejects.toThrow("Unknown platform: unknown-platform");
    });
    // ── Enrichment queue ─────────────────────────────────────────────────────
    it("enqueues one enrichment job per listing via addBulk", async () => {
        mockRun.mockResolvedValue([LISTING, { ...LISTING, vin: "1HGBH41JXMN109187" }]);
        const job = makeJob({
            dealerId: "dealer-1",
            url: "https://example.com/inventory",
            platform: "sincro",
            jobType: "inventory",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        expect(mockAddBulk).toHaveBeenCalledTimes(1);
        const bulkPayload = mockAddBulk.mock.calls[0][0];
        expect(bulkPayload).toHaveLength(2);
        for (const item of bulkPayload) {
            expect(item.name).toBe("enrich-listing");
            expect(item.data.dealerId).toBe("dealer-1");
        }
    });
    it("does NOT call addBulk when extractor returns no listings", async () => {
        mockRun.mockResolvedValue([]);
        const job = makeJob({
            dealerId: "dealer-1",
            url: "https://example.com/inventory",
            platform: "dealeron",
            jobType: "inventory",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        expect(mockAddBulk).not.toHaveBeenCalled();
    });
    // ── Redis last_run ───────────────────────────────────────────────────────
    it("writes scraped:{dealerId}:last_run to Redis after successful scrape", async () => {
        mockRun.mockResolvedValue([LISTING]);
        const job = makeJob({
            dealerId: "dealer-42",
            url: "https://example.com/inventory",
            platform: "dealer_inspire",
            jobType: "inventory",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        expect(mockRedisSet).toHaveBeenCalledTimes(1);
        expect(mockRedisSet.mock.calls[0][0]).toBe("scraped:dealer-42:last_run");
        // Value should be an ISO timestamp string
        expect(new Date(mockRedisSet.mock.calls[0][1]).toISOString()).toBeTruthy();
    });
    it("writes last_run even when the extractor returns 0 listings", async () => {
        mockRun.mockResolvedValue([]);
        const job = makeJob({
            dealerId: "dealer-55",
            url: "https://example.com/inventory",
            platform: "dealer.com",
            jobType: "specials",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        expect(mockRedisSet).toHaveBeenCalledWith("scraped:dealer-55:last_run", expect.any(String));
    });
    // ── Success log ──────────────────────────────────────────────────────────
    it("logs a structured completion message with listingsFound count", async () => {
        mockRun.mockResolvedValue([LISTING, LISTING]);
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => { });
        const job = makeJob({
            dealerId: "dealer-1",
            url: "https://example.com/inventory",
            platform: "dealer.com",
            jobType: "inventory",
        });
        await (0, ScrapeWorker_1.processScrapeJob)(job, makeDeps());
        const logArg = JSON.parse(logSpy.mock.calls[0][0]);
        expect(logArg.level).toBe("info");
        expect(logArg.listingsFound).toBe(2);
        expect(logArg.dealerId).toBe("dealer-1");
    });
});
// ---------------------------------------------------------------------------
// Tests — ScrapeWorker constructor
// ---------------------------------------------------------------------------
describe("ScrapeWorker", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it("creates a BullMQ Worker on the scrape-jobs queue", () => {
        new ScrapeWorker_1.ScrapeWorker({
            connection: {},
            enrichmentQueue: { addBulk: mockAddBulk },
            redis: { set: mockRedisSet },
        });
        expect(bullmq_1.Worker).toHaveBeenCalledTimes(1);
        expect(bullmq_1.Worker.mock.calls[0][0]).toBe(shared_1.QUEUE_NAMES.SCRAPE);
    });
    it("sets concurrency to 20", () => {
        new ScrapeWorker_1.ScrapeWorker({
            connection: {},
            enrichmentQueue: { addBulk: mockAddBulk },
            redis: { set: mockRedisSet },
        });
        const workerOpts = bullmq_1.Worker.mock.calls[0][2];
        expect(workerOpts.concurrency).toBe(20);
    });
    it("registers a 'failed' event listener on the worker", () => {
        new ScrapeWorker_1.ScrapeWorker({
            connection: {},
            enrichmentQueue: { addBulk: mockAddBulk },
            redis: { set: mockRedisSet },
        });
        expect(mockWorkerOn).toHaveBeenCalledWith("failed", expect.any(Function));
    });
    it("logs a structured error when the failed event fires", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => { });
        new ScrapeWorker_1.ScrapeWorker({
            connection: {},
            enrichmentQueue: { addBulk: mockAddBulk },
            redis: { set: mockRedisSet },
        });
        const failedHandler = mockWorkerOn.mock.calls.find(([evt]) => evt === "failed")[1];
        failedHandler({ data: { dealerId: "d-1", url: "https://x.com" }, attemptsMade: 3 }, new Error("Playwright crashed"));
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const logArg = JSON.parse(errorSpy.mock.calls[0][0]);
        expect(logArg.level).toBe("error");
        expect(logArg.dealerId).toBe("d-1");
        expect(logArg.attemptsMade).toBe(3);
        expect(logArg.error).toContain("Playwright crashed");
    });
    it("handles undefined job in failed event without throwing", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => { });
        new ScrapeWorker_1.ScrapeWorker({
            connection: {},
            enrichmentQueue: { addBulk: mockAddBulk },
            redis: { set: mockRedisSet },
        });
        const failedHandler = mockWorkerOn.mock.calls.find(([evt]) => evt === "failed")[1];
        expect(() => failedHandler(undefined, new Error("lost connection"))).not.toThrow();
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });
});
