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
 * Stores the route handler registered by SincroExtractor.beforeNavigate().
 * Tests invoke this to simulate XHR responses.
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
const SincroExtractor_1 = require("../../src/extractors/SincroExtractor");
const BrowserLauncher_1 = require("../../src/browser/BrowserLauncher");
const HumanBehavior_1 = require("../../src/browser/HumanBehavior");
const BackoffInterceptor_1 = require("../../src/browser/BackoffInterceptor");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "sincro");
/** Short XHR timeout for unit tests to avoid 10s waits. */
const TEST_XHR_TIMEOUT_MS = 50;
function loadFixture(filename) {
    return fs.readFileSync(path.join(FIXTURES_DIR, filename), "utf-8");
}
function loadJsonFixture() {
    return loadFixture("price-stack-response.json");
}
function createExtractor() {
    const extractor = new SincroExtractor_1.SincroExtractor({
        dealerId: "test-dealer-toyota-001",
        targetUrl: "https://www.toyotaoflaredo.com/searchnew.aspx",
        dealerDomain: "toyotaoflaredo.com",
    });
    // Use short timeout so fallback tests don't wait 10s each
    extractor.xhrTimeoutMs =
        TEST_XHR_TIMEOUT_MS;
    return extractor;
}
/**
 * Simulate a Sincro XHR response flowing through the route handler.
 * Fires the captured route handler registered by beforeNavigate().
 */
async function simulateXhrIntercept(url, jsonBody, contentType = "application/json") {
    if (!capturedRouteHandler) {
        throw new Error("No route handler captured — was beforeNavigate called?");
    }
    const mockFulfill = jest.fn().mockResolvedValue(undefined);
    const mockContinue = jest.fn().mockResolvedValue(undefined);
    const route = {
        request: () => ({ url: () => url }),
        fetch: () => Promise.resolve({
            headers: () => ({ "content-type": contentType }),
            text: () => Promise.resolve(jsonBody),
        }),
        fulfill: mockFulfill,
        continue: mockContinue,
    };
    await capturedRouteHandler(route);
}
/**
 * Simulate a non-matching URL passing through the route handler.
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
}
/** Setup page mocks for the HTML fallback path (no XHR captured). */
function setupFallbackPageMocks(html) {
    mockContent.mockResolvedValue(html);
    // parse data-vin elements from fixture HTML
    const vinRegex = /data-vin="([^"]+)"\s+data-year="([^"]+)"\s+data-make="([^"]+)"\s+data-model="([^"]+)"\s+data-trim="([^"]*)"\s+data-msrp="([^"]+)"\s+data-price="([^"]*)"/g;
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
            price: match[7],
        });
    }
    mock$$eval.mockImplementation((selector) => {
        if (selector === "[data-vin]") {
            return Promise.resolve(items);
        }
        return Promise.resolve([]);
    });
    // No cookie consent button by default
    mock$.mockResolvedValue(null);
}
/** Setup mocks with cookie consent button present. */
function setupCookieConsentMocks(html) {
    setupFallbackPageMocks(html);
    // First $ call finds the cookie button, rest return null
    const cookieBtn = {
        boundingBox: jest.fn().mockResolvedValue({
            x: 400,
            y: 300,
            width: 120,
            height: 40,
        }),
    };
    mock$.mockReset();
    mock$
        .mockResolvedValueOnce(cookieBtn) // #onetrust-accept-btn-handler found
        .mockResolvedValue(null); // pagination selectors: no next page
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SincroExtractor", () => {
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
    // XHR intercept path
    // -------------------------------------------------------------------------
    describe("XHR intercept path", () => {
        it("captures price stack and returns correct number of listings", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            const extractor = createExtractor();
            // Override goto to simulate XHR during navigation
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew/GetVehicles", jsonBody);
            });
            const listings = await extractor.run();
            expect(listings).toHaveLength(5);
        });
        it("populates all required RawListing fields", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://cdn.sincro.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.vin).toBeDefined();
                expect(listing.vin.length).toBe(17);
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
        it("maps lease fields correctly and sets transactionType to 'lease'", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // Tundra has lease payment data
            const tundra = listings.find((l) => l.vin === "5TFBY5F18NX901234");
            expect(tundra).toBeDefined();
            expect(tundra.advertisedMonthly).toBe(489);
            expect(tundra.dueAtSigning).toBe(3999);
            expect(tundra.leaseTermMonths).toBe(36);
            expect(tundra.moneyFactor).toBe(0.00125);
            expect(tundra.residualPercent).toBe(58);
            expect(tundra.transactionType).toBe("lease");
        });
        it("maps finance fields correctly and keeps transactionType as 'finance'", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // Camry has only finance data
            const camry = listings.find((l) => l.vin === "JTDKN3DU5R0567890");
            expect(camry).toBeDefined();
            expect(camry.aprPercent).toBe(4.9);
            expect(camry.loanTermMonths).toBe(72);
            expect(camry.advertisedMonthly).toBe(485);
            expect(camry.transactionType).toBe("finance");
        });
        it("sets transactionType 'lease' when vehicle has both lease and finance", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // 4Runner has both lease and finance
            const runner = listings.find((l) => l.vin === "5TDZA23C06S789012");
            expect(runner).toBeDefined();
            expect(runner.transactionType).toBe("lease");
            expect(runner.leaseTermMonths).toBe(36);
            expect(runner.aprPercent).toBe(5.49);
        });
        it("defaults transactionType to 'finance' when no payment data", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // RAV4 has no payment data
            const rav4 = listings.find((l) => l.vin === "JTERU5JR7R5234567");
            expect(rav4).toBeDefined();
            expect(rav4.transactionType).toBe("finance");
            expect(rav4.advertisedMonthly).toBeUndefined();
        });
        it("maps sellingPrice from SellingPrice or InternetPrice", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            const tundra = listings.find((l) => l.vin === "5TFBY5F18NX901234");
            expect(tundra.sellingPrice).toBe(42500);
            const corolla = listings.find((l) => l.vin === "2T1BURHE8RC345678");
            expect(corolla.sellingPrice).toBe(22800);
        });
        it("uploads raw JSON to S3 with .json key", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            await extractor.run();
            // Should have uploaded: 1 HTML (from BaseExtractor) + 1 JSON (from SincroExtractor)
            const jsonUploadCall = mockUpload.mock.calls.find(([key]) => key.endsWith(".json"));
            expect(jsonUploadCall).toBeDefined();
            expect(jsonUploadCall[0]).toMatch(/^dealers\/test-dealer-toyota-001\/\d+\.json$/);
            expect(Buffer.isBuffer(jsonUploadCall[1])).toBe(true);
        });
        it("sets scrapedAt as a Date on every listing", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                expect(listing.scrapedAt).toBeInstanceOf(Date);
            }
        });
        it("does not intercept non-Sincro URLs", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                // Non-matching URL should pass through
                await simulateNonMatchingRequest("https://www.google.com/analytics.js");
                // Matching URL should be intercepted
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings).toHaveLength(5);
        });
    });
    // -------------------------------------------------------------------------
    // HTML fallback path
    // -------------------------------------------------------------------------
    describe("HTML fallback path", () => {
        it("activates when no XHR is captured and parses data attributes", async () => {
            const html = loadFixture("inventory-with-data-attrs.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings).toHaveLength(4);
        }, 15_000);
        it("populates required fields from data-* attributes", async () => {
            const html = loadFixture("inventory-with-data-attrs.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            const tundra = listings.find((l) => l.vin === "5TFBY5F18NX901234");
            expect(tundra).toBeDefined();
            expect(tundra.year).toBe(2025);
            expect(tundra.make).toBe("Toyota");
            expect(tundra.model).toBe("Tundra");
            expect(tundra.trim).toBe("SR5 CrewMax");
            expect(tundra.msrp).toBe(44985);
            expect(tundra.sellingPrice).toBe(42500);
            expect(tundra.transactionType).toBe("finance");
        }, 15_000);
        it("emits a warning log when fallback activates", async () => {
            const html = loadFixture("inventory-with-data-attrs.html");
            setupFallbackPageMocks(html);
            const consoleSpy = jest
                .spyOn(console, "log")
                .mockImplementation(() => { });
            const extractor = createExtractor();
            await extractor.run();
            const warnCalls = consoleSpy.mock.calls.filter((call) => {
                try {
                    const parsed = JSON.parse(call[0]);
                    return (parsed.level === "warn" &&
                        parsed.message.includes("HTML fallback"));
                }
                catch {
                    return false;
                }
            });
            expect(warnCalls.length).toBeGreaterThanOrEqual(1);
        }, 15_000);
        it("sets undefined for missing optional fields (not null or 0)", async () => {
            const html = loadFixture("inventory-with-data-attrs.html");
            setupFallbackPageMocks(html);
            const extractor = createExtractor();
            const listings = await extractor.run();
            for (const listing of listings) {
                // These fields are not in HTML attributes
                expect(listing.advertisedMonthly).toBeUndefined();
                expect(listing.moneyFactor).toBeUndefined();
                expect(listing.residualPercent).toBeUndefined();
                expect(listing.leaseTermMonths).toBeUndefined();
            }
        }, 15_000);
    });
    // -------------------------------------------------------------------------
    // Cookie consent
    // -------------------------------------------------------------------------
    describe("cookie consent", () => {
        it("dismisses cookie consent overlay when present", async () => {
            const html = loadFixture("inventory-with-cookie-consent.html");
            setupCookieConsentMocks(html);
            const extractor = createExtractor();
            await extractor.run();
            expect(HumanBehavior_1.HumanBehavior.randomMousePath).toHaveBeenCalled();
        }, 15_000);
    });
    // -------------------------------------------------------------------------
    // Pagination
    // -------------------------------------------------------------------------
    describe("pagination", () => {
        it("follows next-page links and combines results", async () => {
            const page1Html = loadFixture("inventory-paginated-page1.html");
            const page2Html = loadFixture("inventory-paginated-page2.html");
            // Parse fixture items
            const parseItems = (html) => {
                const vinRegex = /data-vin="([^"]+)"\s+data-year="([^"]+)"\s+data-make="([^"]+)"\s+data-model="([^"]+)"\s+data-trim="([^"]*)"\s+data-msrp="([^"]+)"\s+data-price="([^"]*)"/g;
                const items = [];
                let m;
                while ((m = vinRegex.exec(html)) !== null) {
                    items.push({
                        vin: m[1],
                        year: m[2],
                        make: m[3],
                        model: m[4],
                        trim: m[5],
                        msrp: m[6],
                        price: m[7],
                    });
                }
                return items;
            };
            const page1Items = parseItems(page1Html);
            const page2Items = parseItems(page2Html);
            // Page content returns page1 first, then page2
            mockContent
                .mockResolvedValueOnce(page1Html)
                .mockResolvedValueOnce(page2Html);
            // $$eval returns parsed items per page
            mock$$eval
                .mockResolvedValueOnce(page1Items) // page 1 extractListings
                .mockResolvedValueOnce(page2Items); // page 2 extractListings
            // Pagination next link found on page 1
            const nextLink = {
                boundingBox: jest.fn().mockResolvedValueOnce({
                    x: 500,
                    y: 800,
                    width: 60,
                    height: 30,
                }),
            };
            // mock$ calls in sequence:
            // Page 1: dismissCookieConsent tries 5 selectors (all null)
            // Page 1: handlePagination tries first selector → finds next link
            // Page 2: dismissCookieConsent tries 5 selectors (all null)
            // Page 2: handlePagination tries 6 selectors (all null)
            mock$.mockReset();
            mock$
                // Page 1: cookie consent (5 selectors, all miss)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                // Page 1: handlePagination — first selector finds next link
                .mockResolvedValueOnce(nextLink)
                // Page 2: cookie consent (5 selectors, all miss)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                // Page 2: handlePagination — all 6 selectors miss
                .mockResolvedValue(null);
            const extractor = createExtractor();
            const listings = await extractor.run();
            // 3 from page 1 + 2 from page 2
            expect(listings).toHaveLength(5);
            // S3 HTML upload called once per page (from BaseExtractor)
            const htmlUploads = mockUpload.mock.calls.filter(([key]) => key.endsWith(".html"));
            expect(htmlUploads).toHaveLength(2);
        }, 15_000);
    });
    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------
    describe("edge cases", () => {
        it("returns empty array when price stack has no Vehicles", async () => {
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mock$$eval.mockResolvedValue([]);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", JSON.stringify({ Vehicles: [] }));
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings).toHaveLength(0);
        });
        it("falls back to HTML when intercepted JSON is malformed", async () => {
            const html = loadFixture("inventory-with-data-attrs.html");
            setupFallbackPageMocks(html);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", "{ invalid json ...");
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // Falls back to HTML which has 4 vehicles
            expect(listings).toHaveLength(4);
        }, 15_000);
        it("returns empty when fallback HTML has no data-vin elements", async () => {
            mockContent.mockResolvedValue("<html><body>No inventory</body></html>");
            mock$$eval.mockResolvedValue([]);
            mock$.mockResolvedValue(null);
            const extractor = createExtractor();
            const listings = await extractor.run();
            expect(listings).toHaveLength(0);
        }, 15_000);
        it("skips vehicles with missing required fields in price stack", async () => {
            const incompleteJson = JSON.stringify({
                Vehicles: [
                    {
                        VIN: "5TFBY5F18NX901234",
                        Year: 2025,
                        Make: "Toyota",
                        Model: "Tundra",
                        MSRP: 44985,
                    },
                    {
                        VIN: "",
                        Year: 2025,
                        Make: "Toyota",
                        Model: "Camry",
                        MSRP: 30000,
                    },
                    {
                        VIN: "JTDKN3DU5R0567890",
                        Year: 0,
                        Make: "",
                        Model: "",
                        MSRP: 0,
                    },
                ],
            });
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", incompleteJson);
            });
            const extractor = createExtractor();
            const listings = await extractor.run();
            // Only the first vehicle has all required fields
            expect(listings).toHaveLength(1);
            expect(listings[0].vin).toBe("5TFBY5F18NX901234");
        });
    });
    // -------------------------------------------------------------------------
    // Browser lifecycle
    // -------------------------------------------------------------------------
    describe("browser lifecycle", () => {
        it("launches browser with the correct dealerDomain", async () => {
            mockContent.mockResolvedValue("<html></html>");
            mock$$eval.mockResolvedValue([]);
            mock$.mockResolvedValue(null);
            const extractor = createExtractor();
            await extractor.run();
            expect(BrowserLauncher_1.BrowserLauncher.launch).toHaveBeenCalledWith({
                dealerDomain: "toyotaoflaredo.com",
            });
        }, 15_000);
        it("sets up route interception before navigation", async () => {
            mockContent.mockResolvedValue("<html></html>");
            mock$$eval.mockResolvedValue([]);
            mock$.mockResolvedValue(null);
            const extractor = createExtractor();
            await extractor.run();
            // page.route should be called before page.goto
            const routeOrder = mockRoute.mock.invocationCallOrder[0];
            const gotoOrder = mockGoto.mock.invocationCallOrder[0];
            expect(routeOrder).toBeLessThan(gotoOrder);
        }, 15_000);
        it("closes browser even when extraction throws", async () => {
            mockContent.mockRejectedValue(new Error("Page crashed"));
            const extractor = createExtractor();
            await expect(extractor.run()).rejects.toThrow("Page crashed");
            expect(mockClose).toHaveBeenCalled();
        });
        it("always closes browser after successful run", async () => {
            const jsonBody = loadJsonFixture();
            mockContent.mockResolvedValue("<html></html>");
            mock$.mockResolvedValue(null);
            mockGoto.mockImplementation(async () => {
                await simulateXhrIntercept("https://www.toyotaoflaredo.com/SearchNew", jsonBody);
            });
            const extractor = createExtractor();
            await extractor.run();
            expect(mockClose).toHaveBeenCalled();
        });
    });
});
