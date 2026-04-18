// ---------------------------------------------------------------------------
// Tax-credit keyword table (spec §9.2)
// ---------------------------------------------------------------------------

/**
 * Keyword patterns that signal a lender (e.g. NMAC) is absorbing the Texas
 * sales tax for this listing.  All matches are case-insensitive.
 * Order determines priority — first match wins.
 */
const TAX_CREDIT_KEYWORDS: ReadonlyArray<string> = [
  "tax relief",
  "lender tax credit",
  "0% sales tax",
  "nmac special program",
  "tax credit applied",
];

/** Characters captured on each side of the match for the audit log. */
const AUDIT_CONTEXT_RADIUS = 50;

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface TaxCreditResult {
  /** Whether a lender tax credit keyword was detected. */
  detected: boolean;
  /** The raw keyword string that triggered the match (if any). */
  keywordMatch?: string;
  /**
   * Up to 100 characters surrounding the matched keyword for audit logging
   * (spec §9.2: "log matched keyword and surrounding 100 characters").
   */
  auditContext?: string;
}

// ---------------------------------------------------------------------------
// TaxCreditDetector
// ---------------------------------------------------------------------------

/**
 * Scans fine-print text for lender tax-credit keywords defined in spec §9.2.
 *
 * First match wins — a single detected keyword is sufficient to override
 * the standard Texas sales-tax calculation (§6.2).
 */
export class TaxCreditDetector {
  detect(text: string): TaxCreditResult {
    if (!text) {
      return { detected: false };
    }

    const lower = text.toLowerCase();

    for (const keyword of TAX_CREDIT_KEYWORDS) {
      const idx = lower.indexOf(keyword);
      if (idx === -1) {
        continue;
      }

      // Build audit context: up to AUDIT_CONTEXT_RADIUS chars either side
      const contextStart = Math.max(0, idx - AUDIT_CONTEXT_RADIUS);
      const contextEnd = Math.min(text.length, idx + keyword.length + AUDIT_CONTEXT_RADIUS);
      const auditContext = text.slice(contextStart, contextEnd);

      return {
        detected: true,
        keywordMatch: keyword,
        auditContext,
      };
    }

    return { detected: false };
  }
}
