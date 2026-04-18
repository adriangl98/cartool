// ---------------------------------------------------------------------------
// GAP insurance keyword table (spec F03.4)
// ---------------------------------------------------------------------------

/**
 * Keyword patterns that signal GAP insurance is mentioned in the fine print
 * of a balloon finance listing.  All matches are case-insensitive.
 * Order determines priority — first match wins.
 */
const GAP_KEYWORDS: ReadonlyArray<string> = [
  "gap insurance",
  "gap coverage",
  "guaranteed asset protection",
];

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface GapInsuranceResult {
  /** Whether a GAP insurance keyword was detected. */
  detected: boolean;
  /** The raw keyword string that triggered the match (if any). */
  keywordMatch?: string;
}

// ---------------------------------------------------------------------------
// GapInsuranceDetector
// ---------------------------------------------------------------------------

/**
 * Scans fine-print text for GAP insurance keywords defined in spec F03.4.
 *
 * First match wins.  The caller (`NormalizationService`) is responsible for
 * applying the balloon-only guard — this detector is purely textual and has
 * no knowledge of `transactionType`.
 */
export class GapInsuranceDetector {
  detect(text: string): GapInsuranceResult {
    if (!text) {
      return { detected: false };
    }

    const lower = text.toLowerCase();

    for (const keyword of GAP_KEYWORDS) {
      const idx = lower.indexOf(keyword);
      if (idx === -1) {
        continue;
      }

      return {
        detected: true,
        keywordMatch: keyword,
      };
    }

    return { detected: false };
  }
}
