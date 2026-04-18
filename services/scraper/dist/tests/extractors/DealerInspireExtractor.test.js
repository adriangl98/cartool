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
const mockContent = jest.fn();
const mock$$eval = jest.fn().mockResolvedValue([]);
const mock$ = jest.fn().mockResolvedValue(null);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockMouseMove = jest.fn().mockResolvedValue(undefined);
const mockMouseClick = jest.fn().mockResolvedValue(undefined);
/**
 * Stores the route handler registered by DealerInspireExtractor.beforeNavigate().
 * Tests invoke this to simulate API feed responses.
 */
let capturedRouteHandler = null;
const mockRoute = jest.fn().mockImplementation((_pattern, handler) => {
    capturedRouteHandler = handler;
    return Promise.resolve();
});
const mockPage = {
    goto: mockGoto,
    waitForLoadState: mockWaitForLoadState,
    content: mockContent,
    $$eval: mock$$eval,
    $: mock$,
    route: mockRoute,
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
const DealerInspireExtractor_1 = require("../../src/extractors/DealerInspireExtractor");
const BrowserLauncher_1 = require("../../src/browser/BrowserLauncher");
const HumanBehavior_1 = require("../../src/browser/HumanBehavior");
const BackoffInterceptor_1 = require("../../src/browser/BackoffInterceptor");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "dealer-inspire");
/** Short XHR timeout for unit tests to avoid 10s waits. */
const TEST_XHR_TIMEOUT_MS = 50;
function loadFixture(filename) {
    return fs.readFileSync(path.join(FIXTURES_DIR, filename), "utf-8");
}
function loadApiFeedFixture() {
    return loadFixture("api-feed-response.json");
}
function createExtractor() {
    const extractor = new DealerInspireExtractor_1.DealerInspireExtractor({
        dealerId: "test-dealer-honda-001",
        targetUrl: "https://www.hondaoflaredo.com/api/inventory",
        dealerDomain: "hondaoflaredo.com",
    });
    // Use short timeout so fallback tests do not wait 10s each
    extractor.xhrTimeoutMs =
        TEST_XHR_TIMEOUT_MS;
    return extractor;
}
/**
 * Simulate a Dealer Inspire API response flowing through the route handler.
 */
async function simulateApiIntercept(url, jsonBody, contentType = "application/json") {
    if (!capturedRouteHandler) {
        throw new Error("No route handler captured — was beforeNavigate called?");
    }
    const route = {
        request: () => ({ url: () => url }),
        fetch: () => Promise.resolve({
            headers: () => ({ "content-type": contentType }),
            text: () => Promise.resolve(jsonBody),
        }),
        fulfill: jest.fn().mockResolvedValue(undefined),
        continue: jest.fn().mockResolvedValue(undefined),
    };
    await capturedRouteHandler(route);
}
/**
 * Simulate a non-matching URL passing through the route handler (expect route.continue).
 */
async function simulateNonMatchingRequest(url) {
    if (!capturedRouteHandler)
        return;
    const mockContinue = jest.fn().mockResolvedValue(undefined);
    const route = {
        request: () => ({ url: () => url }),
        fetch: () => Promise.resolve({
            headers: () => ({}),
            text: () => Promise.resolve(""),
        }),
        fulfill: jest.fn().mockResolvedValue(undefined),
        continue: mockContinue,
    };
    await capturedRouteHandler(route);
    expect(mockContinue).toHaveBeenCalledTimes(1);
}
/**
 * Set up page mocks for the HTML fallback path (no API call captured).
 * Returns parsed items extracted from the fixture HTML.
 */
function setupFallbackPageMocks(html) {
    mockContent.mockResolvedValue(html);
    const vinRegex = /data-vin="([^"]+)"\s+data-year="([^"]+)"\s+data-make="([^"]+)"\s+data-model="([^"]+)"\s+data-trim="([^"]*)"\s+data-msrp="([^"]+)"\s+data-selling-price="([^"]*)"/g;
    const items = [];
    let match;
    while ((match = vinRegex.exec(html)) !== null) {
        items.push({
            vin: match[1],
            year: match[2],
            make: match[3],
            model: match[4],
            trim: match[5],
            msrp: match[6],
            sellingPrice: match[7],
        });
    }
    mock$$eval.mockImplementation((selector) => {
        if (selector === "[data-vin]") {
            return Promise.resolve(items);
        }
        return Promise.resolve([]);
    });
    mock$.mockResolvedValue(null);
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DealerInspireExtractor", () => {
    beforeEach(() => {
        jest.resetAllMocks();
        capturedRouteHandler = null;
        jest.spyOn(console, "log").mockImplementation(() => { });
        // Re-apply default mock implementations after reset
        mockGoto.mockResolvedValue(undefined);
        mockWaitForLoadState.mockResolvedValue(undefined);
        mockContent.mockResolvedValue("<html></html>");
        mock$$eval.mockResolvedValue([]);
        mock$.mockResolvedValue(null);
        mockClose.mockResolvedValue(undefined);
        mockMouseMove.mockResolvedValue(undefined);
        mockMouseClick.mockResolvedValue(undefined);
        mockUpload.mockResolvedValue(undefined);
        mockRoute.mockImplementation((_pattern, handler) => {
            capturedRouteHandler = handler;
            return Promise.resolve();
        });
        BrowserLauncher_1.BrowserLauncher.launch.mockResolvedValue({
            browser: mockBrowser,
            page: mockPage,
        });
        HumanBehavior_1.HumanBehavior.randomScroll.mockResolvedValue(undefined);
        HumanBehavior_1.HumanBehavior.randomMousePath.mockResolvedValue(undefined);
        BackoffInterceptor_1.withRetry.mockImplementation((fn) => fn());
    });
    // -------------------------------------------------------------------------
    // API feed intercept path
    // -------------------------------------------------------------------------
    describe("API feed intercept path", () => {
        it("returns correct number of listings from fixture", async () => {
            const jsonBody = loadApiFeedFixture();
            mockContent.mockResolvedValue("<html></html>");
            const extractor = createExtractor();
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory/new", jsonBody);
            });
            const listings = await extractor.run();
            expect(listings).toHaveLength(3);
        });
        it("populates all required RawListing fields on every listing", async () => {
            const jsonBody = loadApiFeedFixture();
            mockContent.mockResolvedValue("<html></html>");
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.vin).toBeTruthy();
                expect(listing.year).toBeGreaterThan(0);
                expect(listing.make).toBeTruthy();
                expect(listing.model).toBeTruthy();
                expect(listing.msrp).toBeGreaterThan(0);
                expect(listing.rawS3Key).toBeTruthy();
                expect(listing.scrapedAt).toBeInstanceOf(Date);
            }
        });
        it("uploads raw JSON to S3 with a .json key", async () => {
            const jsonBody = loadApiFeedFixture();
            mockContent.mockResolvedValue("<html></html>");
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", jsonBody);
            });
            const extractor = createExtractor();
            await extractor.run();
            const jsonUploadCall = mockUpload.mock.calls.find(([key]) => typeof key === "string" && key.endsWith(".json"));
            expect(jsonUploadCall).toBeDefined();
            expect(jsonUploadCall[0]).toMatch(/^dealers\/test-dealer-honda-001\/\d+\.json$/);
        });
        it("sets rawS3Key on every returned listing", async () => {
            const jsonBody = loadApiFeedFixture();
            mockContent.mockResolvedValue("<html></html>");
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // BaseExtractor.run() archives the page HTML and overwrites rawS3Key with
            // the .html key; the JSON feed is also uploaded separately as extra archival.
            for (const listing of listings) {
                expect(listing.rawS3Key).toMatch(/^dealers\/test-dealer-honda-001\/\d+\.html$/);
            }
        });
        it("maps transactionType to 'lease' when lease fields are present", async () => {
            const jsonBody = loadApiFeedFixture();
            mockContent.mockResolvedValue("<html></html>");
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            const leaseListing = listings.find((l) => l.vin === "1HGCV1F31LA001001");
            expect(leaseListing).toBeDefined();
            expect(leaseListing.transactionType).toBe("lease");
            expect(leaseListing.advertisedMonthly).toBe(299);
            expect(leaseListing.dueAtSigning).toBe(2499);
            expect(leaseListing.leaseTermMonths).toBe(36);
            expect(leaseListing.moneyFactor).toBe(0.00153);
            expect(leaseListing.residualPercent).toBe(52);
        });
        it("maps transactionType to 'finance' when only finance fields are present", async () => {
            const jsonBody = loadApiFeedFixture();
            mockContent.mockResolvedValue("<html></html>");
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            const financeListing = listings.find((l) => l.vin === "1HGCV1F34LA002002");
            expect(financeListing).toBeDefined();
            expect(financeListing.transactionType).toBe("finance");
            expect(financeListing.aprPercent).toBe(2.9);
            expect(financeListing.loanTermMonths).toBe(60);
            expect(financeListing.advertisedMonthly).toBe(485);
        });
        it("skips vehicles missing required fields (vin, year, make, model, msrp)", async () => {
            const payload = {
                inventory: [
                    // Missing VIN
                    { vin: "", year: 2020, make: "Honda", model: "Accord", msrp: 28000 },
                    // Missing MSRP
                    { vin: "1HGCV1F31LA001001", year: 2020, make: "Honda", model: "Accord", msrp: 0 },
                    // Valid
                    { vin: "VALID0VIN00000001", year: 2021, make: "Toyota", model: "Camry", msrp: 25000 },
                ],
            };
            mockContent.mockResolvedValue("<html></html>");
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", JSON.stringify(payload));
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings).toHaveLength(1);
            expect(listings[0].vin).toBe("VALID0VIN00000001");
        });
        it("matches /vehicles/api URL pattern", async () => {
            const jsonBody = loadApiFeedFixture();
            mockContent.mockResolvedValue("<html></html>");
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/vehicles/api/new", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings.length).toBeGreaterThan(0);
        });
        it("does not intercept non-matching URLs", async () => {
            mockContent.mockResolvedValue("<html></html>");
            const extractor = createExtractor();
            // Start run but don't simulate API intercept — route must call continue for non-matching URLs
            mockGoto.mockImplementation(async () => {
                await simulateNonMatchingRequest("https://www.hondaoflaredo.com/styles/main.css");
            });
            // No API captured — falls through to HTML fallback (empty page)
            const listings = await extractor.run();
            expect(listings).toHaveLength(0);
        });
        it("falls through to HTML fallback when captured feed has no inventory array", async () => {
            const malformedPayload = JSON.stringify({ data: [] }); // wrong shape
            const html = loadFixture("inventory-fallback.html");
            setupFallbackPageMocks(html);
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", malformedPayload);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // Falls back to data-* HTML attributes
            expect(listings.length).toBeGreaterThan(0);
        });
    });
    // -------------------------------------------------------------------------
    // HTML fallback path
    // -------------------------------------------------------------------------
    describe("HTML fallback path", () => {
        it("activates when no API call is captured within timeout", async () => {
            const html = loadFixture("inventory-fallback.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings.length).toBeGreaterThan(0);
        });
        it("emits a structured warn log when activating fallback", async () => {
            const html = loadFixture("inventory-fallback.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            await extractor.run();
            const logSpy = jest.mocked(console.log);
            const warnCall = logSpy.mock.calls.find((args) => {
                try {
                    const parsed = JSON.parse(args[0]);
                    return parsed.level === "warn";
                }
                catch {
                    return false;
                }
            });
            expect(warnCall).toBeDefined();
            const logObj = JSON.parse(warnCall[0]);
            expect(logObj.message).toMatch(/HTML fallback/i);
            expect(logObj.dealerId).toBe("test-dealer-honda-001");
        });
        it("parses data-vin, data-make, data-model, data-msrp from fallback HTML", async () => {
            const html = loadFixture("inventory-fallback.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            const accord = listings.find((l) => l.vin === "1HGCV1F31LA001001");
            expect(accord).toBeDefined();
            expect(accord.year).toBe(2020);
            expect(accord.make).toBe("Honda");
            expect(accord.model).toBe("Accord");
            expect(accord.msrp).toBe(28530);
            expect(accord.sellingPrice).toBe(26995);
        });
        it("populates all required fields from HTML attributes", async () => {
            const html = loadFixture("inventory-fallback.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.vin).toBeTruthy();
                expect(listing.year).toBeGreaterThan(0);
                expect(listing.make).toBeTruthy();
                expect(listing.model).toBeTruthy();
                expect(listing.msrp).toBeGreaterThan(0);
                expect(listing.scrapedAt).toBeInstanceOf(Date);
            }
        });
        it("sets transactionType to 'finance' for all fallback HTML listings", async () => {
            const html = loadFixture("inventory-fallback.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.transactionType).toBe("finance");
            }
        });
        it("handles empty selling price gracefully (sellingPrice is undefined)", async () => {
            const html = loadFixture("inventory-fallback.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            // The Pilot in the fallback fixture has data-selling-price=""
            const pilot = listings.find((l) => l.vin === "5FNYF5H59LB003003");
            expect(pilot).toBeDefined();
            expect(pilot.sellingPrice).toBeUndefined();
        });
    });
    // -------------------------------------------------------------------------
    // handlePagination
    // -------------------------------------------------------------------------
    describe("handlePagination", () => {
        it("returns false when no next-page selector is found", async () => {
            const jsonBody = loadApiFeedFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null); // no pagination elements
            mockGoto.mockImplementation(async () => {
                await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // run() exits the do-while after one page when handlePagination returns false
            expect(listings).toHaveLength(3);
        });
        it("navigates to next page when a next-page link is found", async () => {
            const jsonBody = loadApiFeedFixture();
            let pageCount = 0;
            // Return listings on first page only, empty on second
            mockContent.mockResolvedValue("<html></html>");
            const nextLink = {
                boundingBox: jest.fn().mockResolvedValue({
                    x: 600,
                    y: 800,
                    width: 80,
                    height: 30,
                }),
            };
            mockGoto.mockImplementation(async () => {
                pageCount++;
                if (pageCount === 1) {
                    await simulateApiIntercept("https://www.hondaoflaredo.com/api/inventory", jsonBody);
                }
            });
            // First handlePagination call: finds next link and returns true
            // Second: returns null (no more pages)
            mock$
                .mockResolvedValueOnce(nextLink) // first pagination check — next link found
                .mockResolvedValue(null); // subsequent checks — no more pages
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(HumanBehavior_1.HumanBehavior.randomMousePath).toHaveBeenCalled();
            expect(mockWaitForLoadState).toHaveBeenCalledWith("networkidle");
            // interceptedResponses is not cleared between pages (same as SincroExtractor),
            // so page 2 re-uses the captured page-1 data — 3 listings × 2 pages = 6.
            expect(listings).toHaveLength(6);
        });
    });
});
