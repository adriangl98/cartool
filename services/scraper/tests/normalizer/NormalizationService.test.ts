import type { RawListing } from "../../src/types/RawListing";
import { NormalizationService } from "../../src/normalizer/NormalizationService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeListing(overrides: Partial<RawListing> = {}): RawListing {
  return {
    vin: "1HGCM82633A123456",
    year: 2026,
    make: "Honda",
    model: "Accord",
    msrp: 30000,
    transactionType: "finance",
    scrapedAt: new Date("2026-04-17T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NormalizationService", () => {
  let service: NormalizationService;

  beforeEach(() => {
    service = new NormalizationService();
  });

  // -------------------------------------------------------------------------
  // adjustedSellingPrice — 7 dealer-alias name cases (spec §5.3)
  // -------------------------------------------------------------------------

  describe("adjustedSellingPrice — alias coverage", () => {
    const cases: Array<{ alias: string; sellingPrice: number }> = [
      { alias: "Sames Price", sellingPrice: 27500 },
      { alias: "Internet Price", sellingPrice: 27800 },
      { alias: "Market Value", sellingPrice: 28100 },
      { alias: "Dealer Discount Price", sellingPrice: 26900 },
      { alias: "e-Price", sellingPrice: 27200 },
      { alias: "Online Price", sellingPrice: 27650 },
      { alias: "Discounted Price", sellingPrice: 26750 },
    ];

    test.each(cases)(
      'maps "$alias" alias to adjustedSellingPrice',
      ({ sellingPrice }) => {
        const listing = makeListing({ sellingPrice });
        const result = service.normalize(listing);
        expect(result.adjustedSellingPrice).toBe(sellingPrice);
      },
    );
  });

  // -------------------------------------------------------------------------
  // adjustedSellingPrice — MSRP fallback
  // -------------------------------------------------------------------------

  describe("adjustedSellingPrice — MSRP fallback", () => {
    it("falls back to msrp when sellingPrice is undefined", () => {
      const listing = makeListing({ msrp: 32000, sellingPrice: undefined });
      const result = service.normalize(listing);
      expect(result.adjustedSellingPrice).toBe(32000);
    });
  });

  // -------------------------------------------------------------------------
  // Rebate detection — 3 keyword patterns (spec §5.3)
  // -------------------------------------------------------------------------

  describe("rebate detection", () => {
    it('detects "after rebates" keyword and extracts dollar amount', () => {
      const listing = makeListing({
        sellingPrice: 25000,
        rawFinePrintText: "Discounted price of $500 after rebates. See dealer for details.",
      });
      const result = service.normalize(listing);
      expect(result.rebateDetected).toBe(true);
      expect(result.rebateAmount).toBe(500);
    });

    it('detects "includes $X rebate" keyword and captures embedded amount', () => {
      const listing = makeListing({
        sellingPrice: 26000,
        rawFinePrintText:
          "Special offer includes $1,500 rebate for qualified buyers.",
      });
      const result = service.normalize(listing);
      expect(result.rebateDetected).toBe(true);
      expect(result.rebateAmount).toBe(1500);
    });

    it('detects "with loyalty bonus" keyword and extracts dollar amount', () => {
      const listing = makeListing({
        sellingPrice: 24000,
        rawFinePrintText: "Price of $24,000 with loyalty bonus applied. See terms.",
      });
      const result = service.normalize(listing);
      expect(result.rebateDetected).toBe(true);
      expect(result.rebateAmount).toBe(24000);
    });

    it("is case-insensitive for rebate keywords", () => {
      const listing = makeListing({
        rawFinePrintText: "INCLUDES $750 REBATE for conquest customers.",
      });
      const result = service.normalize(listing);
      expect(result.rebateDetected).toBe(true);
      expect(result.rebateAmount).toBe(750);
    });

    it("sets rebateDetected to false when no rebate keyword is present", () => {
      const listing = makeListing({
        rawFinePrintText: "Standard dealer fee of $299 applies. See terms.",
      });
      const result = service.normalize(listing);
      expect(result.rebateDetected).toBe(false);
      expect(result.rebateAmount).toBeUndefined();
    });

    it("sets rebateDetected to false when rawFinePrintText is undefined", () => {
      const listing = makeListing({ rawFinePrintText: undefined });
      const result = service.normalize(listing);
      expect(result.rebateDetected).toBe(false);
      expect(result.rebateAmount).toBeUndefined();
    });

    it("does NOT subtract rebateAmount from adjustedSellingPrice (spec §5.3)", () => {
      const listing = makeListing({
        sellingPrice: 26000,
        rawFinePrintText: "Includes $1,500 rebate for qualified buyers.",
      });
      const result = service.normalize(listing);
      expect(result.adjustedSellingPrice).toBe(26000);
      expect(result.rebateAmount).toBe(1500);
    });
  });

  // -------------------------------------------------------------------------
  // Output shape — all RawListing fields preserved
  // -------------------------------------------------------------------------

  describe("output shape", () => {
    it("preserves all source RawListing fields on the output", () => {
      const listing = makeListing({
        trim: "Sport",
        sellingPrice: 27000,
        advertisedMonthly: 299,
        moneyFactor: 0.00125,
        transactionType: "lease",
        rawS3Key: "dealers/abc/2026-04-17.html",
      });
      const result = service.normalize(listing);
      expect(result.vin).toBe(listing.vin);
      expect(result.trim).toBe("Sport");
      expect(result.advertisedMonthly).toBe(299);
      expect(result.moneyFactor).toBe(0.00125);
      expect(result.transactionType).toBe("lease");
      expect(result.rawS3Key).toBe("dealers/abc/2026-04-17.html");
    });
  });

  // -------------------------------------------------------------------------
  // Add-on detection integration (spec §5.4) — via NormalizationService
  // -------------------------------------------------------------------------

  describe("addonAdjustedPrice and detectedAddons", () => {
    it("sets detectedAddons to [] and addonAdjustedPrice to adjustedSellingPrice when no add-ons present", () => {
      const listing = makeListing({
        sellingPrice: 30000,
        rawFinePrintText: "Standard equipment only. No dealer add-ons.",
      });
      const result = service.normalize(listing);
      expect(result.detectedAddons).toHaveLength(0);
      expect(result.addonAdjustedPrice).toBe(30000);
    });

    it("computes addonAdjustedPrice = adjustedSellingPrice + detected add-on costs", () => {
      // nitrogen ($249 midpoint) + window tint ($699 explicit) = $948
      const listing = makeListing({
        sellingPrice: 25000,
        rawFinePrintText:
          "Includes nitrogen-filled tires and window tint ($699)",
      });
      const result = service.normalize(listing);
      expect(result.detectedAddons).toHaveLength(2);
      expect(result.addonAdjustedPrice).toBe(25948);
    });

    it("excludes Generic Package with no cost from addonAdjustedPrice sum", () => {
      const listing = makeListing({
        sellingPrice: 28000,
        rawFinePrintText: "All vehicles include dealer installed accessories.",
      });
      const result = service.normalize(listing);
      const genericAddon = result.detectedAddons.find(
        (a) => a.addonName === "Generic Package",
      );
      expect(genericAddon).toBeDefined();
      expect(genericAddon!.detectedCost).toBeUndefined();
      // Excluded from sum — addonAdjustedPrice unchanged
      expect(result.addonAdjustedPrice).toBe(28000);
    });

    it("falls back to adjustedSellingPrice = msrp when addonAdjustedPrice is computed without sellingPrice", () => {
      const listing = makeListing({
        msrp: 32000,
        sellingPrice: undefined,
        rawFinePrintText: "Includes window film.",
      });
      const result = service.normalize(listing);
      // Window Tint midpoint $599
      expect(result.addonAdjustedPrice).toBe(32599);
    });
  });

  // -------------------------------------------------------------------------
  // Tax credit detection (spec §9.2) — via NormalizationService
  // -------------------------------------------------------------------------

  describe("taxCreditFlag and texasTax", () => {
    it("spec AC: fine-print containing \"NMAC Special Program — tax credit applied\" sets taxCreditFlag = true and texasTax = 0", () => {
      const listing = makeListing({
        rawFinePrintText: "NMAC Special Program — tax credit applied. See participating dealer.",
      });
      const result = service.normalize(listing);
      expect(result.taxCreditFlag).toBe(true);
      expect(result.texasTax).toBe(0);
    });

    it("sets taxCreditFlag = false and texasTax = null when no keyword is present", () => {
      const listing = makeListing({
        rawFinePrintText: "Standard dealer fee of $299 applies. Contact dealer for details.",
      });
      const result = service.normalize(listing);
      expect(result.taxCreditFlag).toBe(false);
      expect(result.texasTax).toBeNull();
    });

    it("sets taxCreditFlag = false and texasTax = null when rawFinePrintText is undefined", () => {
      const listing = makeListing({ rawFinePrintText: undefined });
      const result = service.normalize(listing);
      expect(result.taxCreditFlag).toBe(false);
      expect(result.texasTax).toBeNull();
    });

    it('detects "tax relief" keyword', () => {
      const listing = makeListing({
        rawFinePrintText: "NMAC is providing tax relief on qualified vehicles.",
      });
      expect(service.normalize(listing).taxCreditFlag).toBe(true);
    });

    it('detects "lender tax credit" keyword', () => {
      const listing = makeListing({
        rawFinePrintText: "A lender tax credit has been applied to this offer.",
      });
      expect(service.normalize(listing).taxCreditFlag).toBe(true);
    });

    it('detects "0% sales tax" keyword', () => {
      const listing = makeListing({
        rawFinePrintText: "0% sales tax for eligible buyers. Expires 04/30/2026.",
      });
      expect(service.normalize(listing).taxCreditFlag).toBe(true);
    });

    it('detects "nmac special program" keyword', () => {
      const listing = makeListing({
        rawFinePrintText: "NMAC Special Program — payment based on special rates.",
      });
      expect(service.normalize(listing).taxCreditFlag).toBe(true);
    });

    it('false-positive guard: "no tax credit" does NOT trigger taxCreditFlag', () => {
      const listing = makeListing({
        rawFinePrintText: "This offer includes no tax credit of any kind.",
      });
      const result = service.normalize(listing);
      expect(result.taxCreditFlag).toBe(false);
      expect(result.texasTax).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // GAP insurance detection (spec F03.4) — via NormalizationService
  // -------------------------------------------------------------------------

  describe("gapInsuranceDetected", () => {
    it("spec AC: balloon listing with no GAP keyword returns gapInsuranceDetected = false", () => {
      const listing = makeListing({
        transactionType: "balloon",
        rawFinePrintText: "36-month balloon. $0 down. Subject to credit approval. See dealer.",
      });
      const result = service.normalize(listing);
      expect(result.gapInsuranceDetected).toBe(false);
    });

    it('spec AC: balloon listing containing "GAP coverage included" returns gapInsuranceDetected = true', () => {
      const listing = makeListing({
        transactionType: "balloon",
        rawFinePrintText: "GAP coverage included with this balloon finance agreement.",
      });
      const result = service.normalize(listing);
      expect(result.gapInsuranceDetected).toBe(true);
    });

    it("non-balloon finance listing returns gapInsuranceDetected = null", () => {
      const listing = makeListing({
        transactionType: "finance",
        rawFinePrintText: "60-month finance offer at 4.9% APR. GAP insurance available separately.",
      });
      const result = service.normalize(listing);
      expect(result.gapInsuranceDetected).toBeNull();
    });

    it("non-balloon lease listing returns gapInsuranceDetected = null", () => {
      const listing = makeListing({
        transactionType: "lease",
        rawFinePrintText: "36-month lease. $299/mo. GAP insurance not applicable.",
      });
      const result = service.normalize(listing);
      expect(result.gapInsuranceDetected).toBeNull();
    });
  });
});
