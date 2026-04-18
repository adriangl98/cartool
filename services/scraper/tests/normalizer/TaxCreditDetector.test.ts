import { TaxCreditDetector } from "../../src/normalizer/TaxCreditDetector";

describe("TaxCreditDetector", () => {
  let detector: TaxCreditDetector;

  beforeEach(() => {
    detector = new TaxCreditDetector();
  });

  // -------------------------------------------------------------------------
  // No match — negative cases
  // -------------------------------------------------------------------------

  it("returns detected = false for an empty string", () => {
    const result = detector.detect("");
    expect(result.detected).toBe(false);
    expect(result.keywordMatch).toBeUndefined();
    expect(result.auditContext).toBeUndefined();
  });

  it("returns detected = false when no keyword is present", () => {
    const result = detector.detect("Standard finance offer. 6.9% APR for 60 months with approved credit.");
    expect(result.detected).toBe(false);
  });

  it('does NOT trigger on "no tax credit" (false-positive guard)', () => {
    const result = detector.detect(
      "This offer includes no tax credit of any kind. See dealer for details.",
    );
    expect(result.detected).toBe(false);
  });

  // -------------------------------------------------------------------------
  // All 5 keyword variants — positive cases (spec §9.2 AC)
  // -------------------------------------------------------------------------

  it('detects "tax relief" keyword', () => {
    const result = detector.detect(
      "NMAC is providing tax relief on qualified Nissan vehicles this month.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("tax relief");
  });

  it('detects "lender tax credit" keyword', () => {
    const result = detector.detect(
      "A lender tax credit has been applied to reduce your out-of-pocket costs.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("lender tax credit");
  });

  it('detects "0% sales tax" keyword', () => {
    const result = detector.detect(
      "This program includes 0% sales tax for eligible buyers. Expires 04/30/2026.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("0% sales tax");
  });

  it('detects "nmac special program" keyword', () => {
    const result = detector.detect(
      "NMAC Special Program — monthly payment based on special program rates.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("nmac special program");
  });

  it('detects "tax credit applied" keyword (spec §9.2 primary AC)', () => {
    const result = detector.detect(
      "Per lender agreement, tax credit applied for this transaction.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("tax credit applied");
  });

  // -------------------------------------------------------------------------
  // Spec §9.2 primary acceptance criterion
  // -------------------------------------------------------------------------

  it('spec AC: "NMAC Special Program — tax credit applied" → detected = true', () => {
    const result = detector.detect("NMAC Special Program — tax credit applied");
    expect(result.detected).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Case-insensitivity
  // -------------------------------------------------------------------------

  it("is case-insensitive for all keywords", () => {
    expect(detector.detect("TAX RELIEF program active.").detected).toBe(true);
    expect(detector.detect("LENDER TAX CREDIT applied.").detected).toBe(true);
    expect(detector.detect("0% SALES TAX offer.").detected).toBe(true);
    expect(detector.detect("NMAC SPECIAL PROGRAM details.").detected).toBe(true);
    expect(detector.detect("TAX CREDIT APPLIED this month.").detected).toBe(true);
  });

  // -------------------------------------------------------------------------
  // auditContext
  // -------------------------------------------------------------------------

  it("populates auditContext with surrounding text when a keyword matches", () => {
    const result = detector.detect(
      "Qualifying vehicles: NMAC Special Program — tax credit applied. Contact dealer.",
    );
    expect(result.auditContext).toBeDefined();
    expect(result.auditContext!.length).toBeGreaterThan(0);
    // auditContext should contain the matched keyword
    expect(result.auditContext!.toLowerCase()).toContain("tax credit applied");
  });

  it("auditContext is bounded within the text when match is near the start", () => {
    const result = detector.detect("tax relief available now. Full details at dealer.");
    expect(result.detected).toBe(true);
    expect(result.auditContext).toBeDefined();
    // Should not throw or produce negative-length strings
    expect(result.auditContext!.length).toBeGreaterThan(0);
  });

  it("auditContext is bounded within the text when match is near the end", () => {
    const result = detector.detect("See dealer for all terms and conditions. tax relief");
    expect(result.detected).toBe(true);
    expect(result.auditContext).toBeDefined();
    expect(result.auditContext!.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // First-match-wins (multiple keywords in text)
  // -------------------------------------------------------------------------

  it("returns the first matched keyword when multiple keywords are present", () => {
    // "tax relief" appears before "tax credit applied" in the keyword table
    const result = detector.detect(
      "Includes tax relief and also tax credit applied for this program.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("tax relief");
  });
});
