import * as fs from "node:fs";
import * as path from "node:path";
import type { RawListing } from "../../src/types/RawListing";

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
  withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
}));

import { DealerOnExtractor } from "../../src/extractors/DealerOnExtractor";
import { BrowserLauncher } from "../../src/browser/BrowserLauncher";
import { HumanBehavior } from "../../src/browser/HumanBehavior";
import { withRetry } from "../../src/browser/BackoffInterceptor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "dealeron");

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), "utf-8");
}

/** Parse data-vin elements from raw HTML (mirrors what $$eval does in-browser). */
function extractDataVinItems(html: string): Array<{
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  msrp: string;
  sellingPrice: string;
}> {
  const regex =
    /<div[^>]+data-vin="([^"]*)"[^>]*>/gi;
  const items: Array<{
    vin: string;
    year: string;
    make: string;
    model: string;
    trim: string;
    msrp: string;
    sellingPrice: string;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const tag = match[0];
    const attr = (name: string): string => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`));
      return m ? m[1] : "";
    };
    items.push({
      vin: attr("data-vin"),
      year: attr("data-year"),
      make: attr("data-make"),
      model: attr("data-model"),
      trim: attr("data-trim"),
      msrp: attr("data-msrp"),
      sellingPrice: attr("data-selling-price") || attr("data-price"),
    });
  }
  return items;
}

/** Extract special-offer card texts from raw HTML. */
function extractSpecialCards(
  html: string,
): Array<{ text: string }> {
  const regex =
    /<div[^>]+class="special-offer"[^>]*>([\s\S]*?)<\/div>/gi;
  const cards: Array<{ text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const inner = match[1];
    const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    cards.push({ text });
  }
  return cards;
}

function setupPageMocks(html: string) {
  mockContent.mockResolvedValue(html);

  const dataItems = extractDataVinItems(html);
  mock$$eval.mockImplementation(
    (selector: string, _fn: (els: unknown[]) => unknown) => {
      if (selector === "[data-vin]") {
        return Promise.resolve(dataItems);
      }
      return Promise.resolve([]);
    },
  );

  const specialCards = extractSpecialCards(html);
  mock$$.mockImplementation((selector: string) => {
    if (selector === ".special-offer") {
      return Promise.resolve(
        specialCards.map((card) => ({
          evaluate: jest.fn().mockResolvedValue(card.text),
        })),
      );
    }
    return Promise.resolve([]);
  });

  // No pagination by default
  mock$.mockResolvedValue(null);
}

function createExtractor() {
  return new DealerOnExtractor({
    dealerId: "test-dealer-uuid-002",
    targetUrl: "https://www.lonestarchevy.com/new-inventory/",
    dealerDomain: "lonestarchevy.com",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DealerOnExtractor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
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
        "1G1FE1S37R0500005",
        "1G1YC2D45R5300003",
        "1GCUYEED5RZ100001",
        "3GNAXKEV1RS200002",
        "KL79MPS26RB400004",
      ]);
    });

    it("maps data attributes correctly", async () => {
      const html = loadFixture("inventory-single-page.html");
      setupPageMocks(html);

      const extractor = createExtractor();
      const listings = await extractor.run();

      const silverado = listings.find(
        (l) => l.vin === "1GCUYEED5RZ100001",
      ) as RawListing;
      expect(silverado).toBeDefined();
      expect(silverado.year).toBe(2025);
      expect(silverado.make).toBe("Chevrolet");
      expect(silverado.model).toBe("Silverado 1500");
      expect(silverado.trim).toBe("LT");
      expect(silverado.msrp).toBe(52350);
      expect(silverado.sellingPrice).toBe(49999);
    });

    it("sets undefined for missing optional fields (not null or 0)", async () => {
      const html = loadFixture("inventory-single-page.html");
      setupPageMocks(html);

      const extractor = createExtractor();
      const listings = await extractor.run();

      // Traverse has no trim or sellingPrice
      const traverse = listings.find(
        (l) => l.vin === "KL79MPS26RB400004",
      ) as RawListing;
      expect(traverse).toBeDefined();
      expect(traverse.trim).toBeUndefined();
      expect(traverse.sellingPrice).toBeUndefined();
      expect(traverse.advertisedMonthly).toBeUndefined();
      expect(traverse.moneyFactor).toBeUndefined();
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
  // Acceptance criteria: attribute name compliance (data-vin, data-price, data-msrp)
  // -------------------------------------------------------------------------

  describe("acceptance criteria — attribute name compliance", () => {
    it("reads msrp from data-msrp attribute", async () => {
      mockContent.mockResolvedValue("<html></html>");
      mock$$eval.mockResolvedValue([
        { vin: "1GCUYEED5RZ100001", year: "2025", make: "Chevrolet", model: "Silverado 1500", trim: "", msrp: "52350", sellingPrice: "" },
      ]);
      mock$$.mockResolvedValue([]);
      mock$.mockResolvedValue(null);

      const extractor = createExtractor();
      const listings = await extractor.run();

      expect(listings).toHaveLength(1);
      expect(listings[0].msrp).toBe(52350);
    });

    it("reads sellingPrice from data-price attribute when data-selling-price is absent", async () => {
      // data-price path: $$eval returns sellingPrice from data-price (no data-selling-price)
      mockContent.mockResolvedValue("<html></html>");
      mock$$eval.mockImplementation(
        (selector: string, _fn: (els: unknown[]) => unknown) => {
          if (selector === "[data-vin]") {
            return Promise.resolve([
              { vin: "1GCUYEED5RZ100001", year: "2025", make: "Chevrolet", model: "Silverado 1500", trim: "", msrp: "52350", sellingPrice: "49500" },
            ]);
          }
          return Promise.resolve([]);
        },
      );
      mock$$.mockResolvedValue([]);
      mock$.mockResolvedValue(null);

      const extractor = createExtractor();
      const listings = await extractor.run();

      expect(listings).toHaveLength(1);
      expect(listings[0].sellingPrice).toBe(49500);
    });

    it("reads vin from data-vin attribute", async () => {
      mockContent.mockResolvedValue("<html></html>");
      mock$$eval.mockResolvedValue([
        { vin: "1GCUYEED5RZ100001", year: "2025", make: "Chevrolet", model: "Silverado 1500", trim: "", msrp: "52350", sellingPrice: "" },
      ]);
      mock$$.mockResolvedValue([]);
      mock$.mockResolvedValue(null);

      const extractor = createExtractor();
      const listings = await extractor.run();

      expect(listings[0].vin).toBe("1GCUYEED5RZ100001");
    });

    it("parses data-price, data-vin, and data-msrp from DealerOn fixture HTML via $$eval", async () => {
      // End-to-end: confirm the extractor calls page.$$eval('[data-vin]', ...)
      // which is the selector that reads data-vin, data-msrp, and data-price attributes
      const html = loadFixture("inventory-single-page.html");
      setupPageMocks(html);

      const extractor = createExtractor();
      await extractor.run();

      expect(mock$$eval).toHaveBeenCalledWith(
        "[data-vin]",
        expect.any(Function),
      );
    });

    it("Load More pagination extracts items beyond the initial page load", async () => {
      // Dedicated AC validation: items from page 2 (post-load-more) are included
      const page1Html = loadFixture("inventory-with-load-more.html");
      const page2Html = loadFixture("inventory-page2.html");

      mockContent
        .mockResolvedValueOnce(page1Html)
        .mockResolvedValueOnce(page2Html);

      const page1Items = extractDataVinItems(page1Html);  // 3 items
      const page2Items = extractDataVinItems(page2Html);  // 5 items
      mock$$eval
        .mockResolvedValueOnce(page1Items)
        .mockResolvedValueOnce(page2Items);
      mock$$.mockResolvedValue([]);

      const loadMoreButton = {
        boundingBox: jest.fn().mockResolvedValueOnce({ x: 400, y: 900, width: 120, height: 40 }),
      };
      mock$
        .mockResolvedValueOnce(loadMoreButton) // page 1: load-more found
        .mockResolvedValue(null);               // page 2: no load-more

      const extractor = createExtractor();
      const listings = await extractor.run();

      // Confirm we got listings from BOTH pages (beyond the initial load)
      const page1Vins = page1Items.map((i) => i.vin);
      const page2Vins = page2Items.map((i) => i.vin);
      const resultVins = listings.map((l) => l.vin);

      // All page 1 VINs are present
      for (const vin of page1Vins) {
        expect(resultVins).toContain(vin);
      }
      // All page 2 VINs (beyond the initial load) are also present
      for (const vin of page2Vins) {
        expect(resultVins).toContain(vin);
      }

      expect(listings.length).toBeGreaterThan(page1Items.length);
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
      expect(key).toMatch(/^dealers\/test-dealer-uuid-002\/\d+\.html$/);
      expect(Buffer.isBuffer(body)).toBe(true);
    });

    it("sets rawS3Key on every listing", async () => {
      const html = loadFixture("inventory-single-page.html");
      setupPageMocks(html);

      const extractor = createExtractor();
      const listings = await extractor.run();

      for (const listing of listings) {
        expect(listing.rawS3Key).toBeDefined();
        expect(listing.rawS3Key).toMatch(
          /^dealers\/test-dealer-uuid-002\/\d+\.html$/,
        );
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

      const silverado = listings.find(
        (l) => l.vin === "1GCUYEED5RZ777771",
      );
      expect(silverado).toBeDefined();
      expect(silverado!.advertisedMonthly).toBe(399);
      expect(silverado!.dueAtSigning).toBe(3499);
      expect(silverado!.leaseTermMonths).toBe(36);
      expect(silverado!.moneyFactor).toBe(0.00185);
      expect(silverado!.residualPercent).toBe(52);
      expect(silverado!.transactionType).toBe("lease");
      expect(silverado!.rawFinePrintText).toBeDefined();
    });

    it("matches specials by model name when VIN not in card", async () => {
      const html = loadFixture("inventory-with-specials.html");
      setupPageMocks(html);

      const extractor = createExtractor();
      const listings = await extractor.run();

      const equinox = listings.find(
        (l) => l.vin === "3GNAXKEV1RS888882",
      );
      expect(equinox).toBeDefined();
      expect(equinox!.advertisedMonthly).toBe(279);
      expect(equinox!.leaseTermMonths).toBe(39);
      expect(equinox!.transactionType).toBe("lease");
    });

    it("leaves non-matching vehicles without specials data", async () => {
      const html = loadFixture("inventory-with-specials.html");
      setupPageMocks(html);

      const extractor = createExtractor();
      const listings = await extractor.run();

      const traverse = listings.find(
        (l) => l.vin === "KL79MPS26RB999993",
      );
      expect(traverse).toBeDefined();
      expect(traverse!.advertisedMonthly).toBeUndefined();
      expect(traverse!.transactionType).toBe("finance");
    });
  });

  // -------------------------------------------------------------------------
  // Pagination — "Load More" button
  // -------------------------------------------------------------------------

  describe("pagination", () => {
    it("clicks 'Load More' button and combines results from both loads", async () => {
      const page1Html = loadFixture("inventory-with-load-more.html");
      const page2Html = loadFixture("inventory-page2.html");

      // First page load
      mockContent.mockResolvedValueOnce(page1Html);
      const page1Items = extractDataVinItems(page1Html);
      mock$$eval.mockResolvedValueOnce(page1Items);
      mock$$.mockResolvedValue([]);

      // "Load More" button found on first page
      const loadMoreButton = {
        boundingBox: jest.fn().mockResolvedValueOnce({
          x: 400,
          y: 900,
          width: 120,
          height: 40,
        }),
      };
      mock$
        .mockResolvedValueOnce(loadMoreButton) // first page: load-more found
        .mockResolvedValueOnce(null) // second page: no load-more selectors
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        // next-page link selectors also null
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      // Second page loads after clicking "Load More"
      mockContent.mockResolvedValueOnce(page2Html);
      const page2Items = extractDataVinItems(page2Html);
      mock$$eval.mockResolvedValueOnce(page2Items);

      const extractor = createExtractor();
      const listings = await extractor.run();

      // 3 from page 1 + 5 from page 2
      expect(listings).toHaveLength(8);

      // S3 upload called once per page
      expect(mockUpload).toHaveBeenCalledTimes(2);
    });

    it("uses HumanBehavior.randomMousePath before clicking Load More", async () => {
      const page1Html = loadFixture("inventory-with-load-more.html");
      const page2Html = loadFixture("inventory-page2.html");

      mockContent
        .mockResolvedValueOnce(page1Html)
        .mockResolvedValueOnce(page2Html);

      const page1Items = extractDataVinItems(page1Html);
      const page2Items = extractDataVinItems(page2Html);
      mock$$eval
        .mockResolvedValueOnce(page1Items)
        .mockResolvedValueOnce(page2Items);
      mock$$.mockResolvedValue([]);

      const loadMoreButton = {
        boundingBox: jest.fn().mockResolvedValueOnce({
          x: 400,
          y: 900,
          width: 120,
          height: 40,
        }),
      };
      mock$
        .mockResolvedValueOnce(loadMoreButton)
        .mockResolvedValue(null);

      const extractor = createExtractor();
      await extractor.run();

      expect(HumanBehavior.randomMousePath).toHaveBeenCalledWith(
        mockPage,
        460, // x + width/2
        920, // y + height/2
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("returns empty array when no data-vin elements are present", async () => {
      const html = loadFixture("inventory-no-listings.html");
      mockContent.mockResolvedValue(html);
      mockWaitForSelector.mockRejectedValue(new Error("timeout"));
      mock$$eval.mockResolvedValue([]);
      mock$$.mockResolvedValue([]);
      mock$.mockResolvedValue(null);

      const extractor = createExtractor();
      const listings = await extractor.run();

      expect(listings).toHaveLength(0);
    });

    it("skips listings with missing required attributes", async () => {
      // Simulate items where some are missing required fields
      mockContent.mockResolvedValue("<html></html>");
      mock$$eval.mockResolvedValue([
        { vin: "1GCUYEED5RZ100001", year: "2025", make: "Chevrolet", model: "Silverado 1500", trim: "LT", msrp: "52350", sellingPrice: "49999" },
        { vin: "", year: "2025", make: "Chevrolet", model: "Equinox", trim: "", msrp: "34500", sellingPrice: "" }, // missing VIN
        { vin: "1G1YC2D45R5300003", year: "", make: "Chevrolet", model: "Corvette", trim: "", msrp: "66300", sellingPrice: "" }, // missing year
        { vin: "KL79MPS26RB400004", year: "2025", make: "", model: "Traverse", trim: "", msrp: "38100", sellingPrice: "" }, // missing make
        { vin: "1G1FE1S37R0500005", year: "2025", make: "Chevrolet", model: "Camaro", trim: "", msrp: "0", sellingPrice: "" }, // msrp = 0
      ]);
      mock$$.mockResolvedValue([]);
      mock$.mockResolvedValue(null);

      const extractor = createExtractor();
      const listings = await extractor.run();

      // Only the first item has all required fields
      expect(listings).toHaveLength(1);
      expect(listings[0].vin).toBe("1GCUYEED5RZ100001");
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

      expect(BrowserLauncher.launch).toHaveBeenCalledWith({
        dealerDomain: "lonestarchevy.com",
      });
    });

    it("navigates via withRetry wrapper", async () => {
      const html = loadFixture("inventory-single-page.html");
      setupPageMocks(html);

      const extractor = createExtractor();
      await extractor.run();

      expect(withRetry).toHaveBeenCalled();
    });

    it("calls HumanBehavior.randomScroll after page load", async () => {
      const html = loadFixture("inventory-single-page.html");
      setupPageMocks(html);

      const extractor = createExtractor();
      await extractor.run();

      expect(HumanBehavior.randomScroll).toHaveBeenCalledWith(mockPage);
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
