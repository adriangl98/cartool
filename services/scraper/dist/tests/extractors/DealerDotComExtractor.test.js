"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that touches them
// ---------------------------------------------------------------------------
const mockUpload = jest.fn().mockResolvedValue(undefined);
jest.mock("@cartool/shared", () => ({
    storageClient: () => ({ upload: mockUpload }),
}));
const mockGoto = jest.fn().mockResolvedValue(undefined);
const mockWaitForLoadState = jest.fn().mockResolvedValue(undefined);
const mockWaitForSelector = jest.fn().mockResolvedValue({});
const mockContent = jest.fn();
const mock$$eval = jest.fn();
const mock$$ = jest.fn().mockResolvedValue([]);
const mock$ = jest.fn().mockResolvedValue(null);
const mockEvaluate = jest.fn();
const mockWaitForTimeout = jest.fn().mockResolvedValue(undefined);
const mockMouseMove = jest.fn().mockResolvedValue(undefined);
const mockMouseClick = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockPage = {
    goto: mockGoto,
    waitForLoadState: mockWaitForLoadState,
    waitForSelector: mockWaitForSelector,
    content: mockContent,
    $$eval: mock$$eval,
    $$: mock$$,
    $: mock$,
    evaluate: mockEvaluate,
    waitForTimeout: mockWaitForTimeout,
    mouse: { move: mockMouseMove, click: mockMouseClick },
};
const mockBrowser = { close: mockClose, newContext: jest.fn() };
jest.mock("../../src/browser/BrowserLauncher", () => ({
    BrowserLauncher: {
        launch: jest.fn().mockResolvedValue({
            browser: mockBrowser,
            page: mockPage,
        }),
    },
}));
jest.mock("../../src/browser/HumanBehavior", () => ({
    HumanBehavior: {
        randomScroll: jest.fn().mockResolvedValue(undefined),
        randomMousePath: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock("../../src/browser/BackoffInterceptor", () => ({
    withRetry: jest.fn((fn) => fn()),
}));
const DealerDotComExtractor_1 = require("../../src/extractors/DealerDotComExtractor");
const BrowserLauncher_1 = require("../../src/browser/BrowserLauncher");
const HumanBehavior_1 = require("../../src/browser/HumanBehavior");
const BackoffInterceptor_1 = require("../../src/browser/BackoffInterceptor");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "dealer.com");
function loadFixture(filename) {
    return fs.readFileSync(path.join(FIXTURES_DIR, filename), "utf-8");
}
/** Extract JSON-LD script contents from raw HTML (mirrors what $$eval does). */
function extractJsonLdBlocks(html) {
    const regex = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    const blocks = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        blocks.push(match[1]);
    }
    return blocks;
}
/** Extract special-offer card texts from raw HTML. */
function extractSpecialCards(html) {
    const regex = /<div[^>]+class="special-offer"[^>]*>([\s\S]*?)<\/div>/gi;
    const cards = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        const inner = match[1];
        // Strip HTML tags to get text content
        const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        cards.push({ text, html: inner });
    }
    return cards;
}
function setupPageMocks(html) {
    mockContent.mockResolvedValue(html);
    const jsonLdBlocks = extractJsonLdBlocks(html);
    mock$$eval.mockImplementation((selector, fn) => {
        if (selector === 'script[type="application/ld+json"]') {
            // Simulate browser $$eval: fn receives elements with textContent
            return Promise.resolve(jsonLdBlocks);
        }
        return Promise.resolve([]);
    });
    const specialCards = extractSpecialCards(html);
    mock$$.mockImplementation((selector) => {
        if (selector === ".special-offer") {
            return Promise.resolve(specialCards.map((card) => ({
                evaluate: jest.fn().mockResolvedValue(card.text),
            })));
        }
        // Other selectors return empty
        return Promise.resolve([]);
    });
    // No next page by default
    mock$.mockResolvedValue(null);
}
function createExtractor() {
    return new DealerDotComExtractor_1.DealerDotComExtractor({
        dealerId: "test-dealer-uuid-001",
        targetUrl: "https://www.samesnissan.com/new-inventory/",
        dealerDomain: "samesnissan.com",
    });
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DealerDotComExtractor", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Suppress console.log from structured logging
        jest.spyOn(console, "log").mockImplementation(() => { });
    });
    // -------------------------------------------------------------------------
    // Single page extraction
    // -------------------------------------------------------------------------
    describe("single-page extraction", () => {
        it("extracts all 5 vehicles from a single page fixture", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings).toHaveLength(5);
        });
        it("populates all required RawListing fields on every listing", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.vin).toBeDefined();
                expect(listing.vin).toMatch(/^[A-HJ-NPR-Z0-9]{17}$/);
                expect(listing.year).toBeGreaterThanOrEqual(2020);
                expect(listing.year).toBeLessThanOrEqual(2030);
                expect(typeof listing.make).toBe("string");
                expect(listing.make.length).toBeGreaterThan(0);
                expect(typeof listing.model).toBe("string");
                expect(listing.model.length).toBeGreaterThan(0);
                expect(typeof listing.msrp).toBe("number");
                expect(listing.msrp).toBeGreaterThan(0);
            }
        });
        it("returns expected VINs", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            const vins = listings.map((l) => l.vin).sort();
            expect(vins).toEqual([
                "1N4BL4CV5RN123456",
                "1N4BL4CV7RN234567",
                "3N1AB8DV2RY456789",
                "5N1AT3CB1RC345678",
                "JN8AT3BA5RW567890",
            ]);
        });
        it("satisfies the 80% extraction threshold", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            // 5 vehicles in fixture; 80% = at least 4
            expect(listings.length).toBeGreaterThanOrEqual(4);
        });
        it("maps JSON-LD fields correctly", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            const altima = listings.find((l) => l.vin === "1N4BL4CV5RN123456");
            expect(altima).toBeDefined();
            expect(altima.year).toBe(2025);
            expect(altima.make).toBe("Nissan");
            expect(altima.model).toBe("Altima");
            expect(altima.trim).toBe("SR");
            expect(altima.msrp).toBe(32150);
        });
        it("defaults transactionType to 'finance' when no specials found", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.transactionType).toBe("finance");
            }
        });
    });
    // -------------------------------------------------------------------------
    // S3 archival
    // -------------------------------------------------------------------------
    describe("S3 archival", () => {
        it("uploads raw HTML to S3 for each page", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            await extractor.run();
            expect(mockUpload).toHaveBeenCalledTimes(1);
            const [key, body] = mockUpload.mock.calls[0];
            expect(key).toMatch(/^dealers\/test-dealer-uuid-001\/\d+\.html$/);
            expect(Buffer.isBuffer(body)).toBe(true);
        });
        it("sets rawS3Key on every listing", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.rawS3Key).toBeDefined();
                expect(listing.rawS3Key).toMatch(/^dealers\/test-dealer-uuid-001\/\d+\.html$/);
            }
        });
        it("sets scrapedAt as a Date on every listing", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.scrapedAt).toBeInstanceOf(Date);
            }
        });
    });
    // -------------------------------------------------------------------------
    // Specials fine-print
    // -------------------------------------------------------------------------
    describe("specials fine-print extraction", () => {
        it("extracts lease terms from specials cards matched by VIN", async () => {
            const html = loadFixture("inventory-with-specials.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            const altima = listings.find((l) => l.vin === "1N4BL4CV5RN777777");
            expect(altima).toBeDefined();
            expect(altima.advertisedMonthly).toBe(299);
            expect(altima.dueAtSigning).toBe(2999);
            expect(altima.leaseTermMonths).toBe(36);
            expect(altima.moneyFactor).toBe(0.00125);
            expect(altima.residualPercent).toBe(58);
            expect(altima.transactionType).toBe("lease");
            expect(altima.rawFinePrintText).toBeDefined();
        });
        it("matches specials by model name when VIN not in card", async () => {
            const html = loadFixture("inventory-with-specials.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            const rogue = listings.find((l) => l.vin === "5N1AT3CB1RC888888");
            expect(rogue).toBeDefined();
            expect(rogue.advertisedMonthly).toBe(389);
            expect(rogue.leaseTermMonths).toBe(36);
            expect(rogue.transactionType).toBe("lease");
        });
        it("leaves non-matching vehicles without specials data", async () => {
            const html = loadFixture("inventory-with-specials.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            const sentra = listings.find((l) => l.vin === "3N1AB8DV2RY999999");
            expect(sentra).toBeDefined();
            expect(sentra.advertisedMonthly).toBeUndefined();
            expect(sentra.transactionType).toBe("finance");
        });
    });
    // -------------------------------------------------------------------------
    // Pagination
    // -------------------------------------------------------------------------
    describe("pagination", () => {
        it("follows next-page links and combines results from all pages", async () => {
            const page1Html = loadFixture("inventory-paginated-page1.html");
            const page2Html = loadFixture("inventory-paginated-page2.html");
            // First page loads
            mockContent.mockResolvedValueOnce(page1Html);
            const page1JsonLd = extractJsonLdBlocks(page1Html);
            mock$$eval.mockResolvedValueOnce(page1JsonLd);
            mock$$.mockResolvedValue([]);
            // Pagination: "Next" link found on first page, not on second
            const nextLink = {
                boundingBox: jest.fn().mockResolvedValueOnce({
                    x: 500,
                    y: 800,
                    width: 60,
                    height: 30,
                }),
            };
            mock$
                .mockResolvedValueOnce(nextLink) // first page: "Next" found
                .mockResolvedValueOnce(null) // second page: first selector no match
                .mockResolvedValueOnce(null) // second page: second selector
                .mockResolvedValueOnce(null) // second page: third selector
                .mockResolvedValueOnce(null) // second page: fourth selector
                .mockResolvedValueOnce(null); // second page: fifth selector
            // Second page loads after clicking next
            mockContent.mockResolvedValueOnce(page2Html);
            const page2JsonLd = extractJsonLdBlocks(page2Html);
            mock$$eval.mockResolvedValueOnce(page2JsonLd);
            const extractor = createExtractor();
            const listings = await extractor.run();
            // 3 from page 1 + 2 from page 2
            expect(listings).toHaveLength(5);
            // S3 upload called once per page
            expect(mockUpload).toHaveBeenCalledTimes(2);
        });
    });
    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------
    describe("edge cases", () => {
        it("returns empty array when no JSON-LD is present", async () => {
            const html = loadFixture("inventory-no-jsonld.html");
            mockContent.mockResolvedValue(html);
            mockWaitForSelector.mockRejectedValue(new Error("timeout"));
            mock$$eval.mockResolvedValue([]);
            mock$$.mockResolvedValue([]);
            mock$.mockResolvedValue(null);
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings).toHaveLength(0);
        });
        it("closes browser even when extraction throws", async () => {
            mockContent.mockRejectedValue(new Error("Page crashed"));
            const extractor = createExtractor();
            await expect(extractor.run()).rejects.toThrow("Page crashed");
            expect(mockClose).toHaveBeenCalled();
        });
    });
    // -------------------------------------------------------------------------
    // Browser lifecycle
    // -------------------------------------------------------------------------
    describe("browser lifecycle", () => {
        it("launches browser with the correct dealerDomain", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            await extractor.run();
            expect(BrowserLauncher_1.BrowserLauncher.launch).toHaveBeenCalledWith({
                dealerDomain: "samesnissan.com",
            });
        });
        it("navigates via withRetry wrapper", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            await extractor.run();
            expect(BackoffInterceptor_1.withRetry).toHaveBeenCalled();
        });
        it("calls HumanBehavior.randomScroll after page load", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            await extractor.run();
            expect(HumanBehavior_1.HumanBehavior.randomScroll).toHaveBeenCalledWith(mockPage);
        });
        it("always closes browser after run", async () => {
            const html = loadFixture("inventory-single-page.html");
            setupPageMocks(html);
            const extractor = createExtractor();
            await extractor.run();
            expect(mockClose).toHaveBeenCalled();
        });
    });
});
