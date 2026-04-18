import { GapInsuranceDetector } from "../../src/normalizer/GapInsuranceDetector";

describe("GapInsuranceDetector", () => {
  let detector: GapInsuranceDetector;

  beforeEach(() => {
    detector = new GapInsuranceDetector();
  });

  // -------------------------------------------------------------------------
  // No match — negative cases
  // -------------------------------------------------------------------------

  it("returns detected = false for an empty string", () => {
    const result = detector.detect("");
    expect(result.detected).toBe(false);
    expect(result.keywordMatch).toBeUndefined();
  });

  it("returns detected = false when no GAP keyword is present", () => {
    const result = detector.detect(
      "Balloon finance offer. 36 months. $0 down. Subject to credit approval.",
    );
    expect(result.detected).toBe(false);
    expect(result.keywordMatch).toBeUndefined();
  });

  it("returns detected = false for unrelated insurance text", () => {
    const result = detector.detect(
      "Comprehensive insurance and extended warranty available. See dealer for details.",
    );
    expect(result.detected).toBe(false);
  });

  // -------------------------------------------------------------------------
  // All 3 keyword variants — positive cases (spec F03.4 AC)
  // -------------------------------------------------------------------------

  it('detects "gap insurance" keyword', () => {
    const result = detector.detect(
      "This balloon offer includes GAP insurance for your protection.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("gap insurance");
  });

  it('detects "gap coverage" keyword (spec F03.4 primary AC)', () => {
    const result = detector.detect(
      "GAP coverage included with all balloon finance agreements.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("gap coverage");
  });

  it('detects "guaranteed asset protection" keyword', () => {
    const result = detector.detect(
      "Guaranteed Asset Protection is provided at no additional cost on this program.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("guaranteed asset protection");
  });

  // -------------------------------------------------------------------------
  // Case-insensitivity
  // -------------------------------------------------------------------------

  it("matches keywords case-insensitively — all caps", () => {
    const result = detector.detect("GAP INSURANCE is mandatory on balloon deals.");
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("gap insurance");
  });

  it("matches keywords case-insensitively — mixed case", () => {
    const result = detector.detect("Gap Coverage is included per lender agreement.");
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("gap coverage");
  });

  it("matches 'Guaranteed Asset Protection' with title case", () => {
    const result = detector.detect(
      "Offer includes Guaranteed Asset Protection. See dealer for details.",
    );
    expect(result.detected).toBe(true);
    expect(result.keywordMatch).toBe("guaranteed asset protection");
  });

  // -------------------------------------------------------------------------
  // First-match-wins (multiple keywords present)
  // -------------------------------------------------------------------------

  it("returns the first matching keyword when multiple are present", () => {
    const result = detector.detect(
      "GAP insurance and GAP coverage are both mentioned here.",
    );
    expect(result.detected).toBe(true);
    // "gap insurance" appears before "gap coverage" in the keyword list
    expect(result.keywordMatch).toBe("gap insurance");
  });
});
