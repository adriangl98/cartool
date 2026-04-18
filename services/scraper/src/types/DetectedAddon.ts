/**
 * A single dealer add-on detected in a listing's fine-print text.
 *
 * Maps directly to a row in the `dealer_addons` table (spec §4.1 / §5.4).
 * `detectedCost` is `undefined` only for the "Generic Package" group when no
 * dollar amount is found in the surrounding text — the add-on is still flagged
 * for review but excluded from the `addonAdjustedPrice` sum.
 */
export interface DetectedAddon {
  /** Canonical add-on name from the spec §5.4 keyword table. */
  addonName: string;
  /**
   * Dollar amount: explicit cost parsed from fine-print, or the spec §5.4
   * midpoint when no explicit cost is present.
   * `undefined` only for "Generic Package" with no parseable dollar amount.
   */
  detectedCost?: number;
  /** Always `true` for add-ons detected via the spec §5.4 keyword table. */
  isMandatory: boolean;
  /** Raw keyword string that triggered detection (for audit / DB storage). */
  keywordMatch: string;
}
