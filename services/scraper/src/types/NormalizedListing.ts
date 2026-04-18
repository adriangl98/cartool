import type { RawListing } from "./RawListing";
import type { DetectedAddon } from "./DetectedAddon";

/**
 * A `RawListing` that has been processed by `NormalizationService`.
 *
 * `adjustedSellingPrice` is the canonical price used by all downstream
 * financial calculations (spec §5.3). It is derived from `sellingPrice`
 * (whichever dealer-specific alias the extractor resolved) or falls back
 * to `msrp` when no selling price was scraped.
 *
 * Rebate fields are populated when `rawFinePrintText` contains rebate
 * keywords. The rebate is logged and stored separately — it is NOT
 * subtracted from `adjustedSellingPrice` (spec §5.3).
 */
export interface NormalizedListing extends RawListing {
  /** Canonical selling price selected by NormalizationService (spec §5.3). */
  adjustedSellingPrice: number;
  /** True when a rebate keyword was detected in fine-print text. */
  rebateDetected: boolean;
  /** Dollar amount extracted from the rebate mention, when available. */
  rebateAmount?: number;
  /** Add-ons detected in fine-print text by `AddonDetector` (spec §5.4). */
  detectedAddons: DetectedAddon[];
  /**
   * `adjustedSellingPrice` plus the sum of all mandatory detected add-on costs
   * (excludes Generic Package entries where no dollar amount was parseable).
   * Used by the Financial Engine for deal scoring (spec §5.4).
   */
  addonAdjustedPrice: number;
  /**
   * True when a lender tax credit keyword is detected in fine-print text (spec §9.2).
   * Indicates a lender (e.g. NMAC) is absorbing the Texas sales tax.
   */
  taxCreditFlag: boolean;
  /**
   * Texas sales tax override for financial calculations (spec §9.2 / §6.2).
   * `0` when a lender tax credit is detected (lender absorbs the tax).
   * `null` when no credit is detected — the Financial Engine applies the
   * standard §6.2 formula.
   */
  texasTax: number | null;
  /**
   * Whether GAP insurance is mentioned in fine-print text for balloon finance
   * listings (spec §9.3 / F03.4).
   * `true`  — GAP keyword detected and `transactionType === 'balloon'`.
   * `false` — No GAP keyword and `transactionType === 'balloon'`; triggers an
   *            API warning in the response (spec §9.3).
   * `null`  — Listing is not a balloon transaction; field is not evaluated.
   */
  gapInsuranceDetected: boolean | null;
}
