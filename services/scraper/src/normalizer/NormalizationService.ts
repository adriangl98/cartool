import type { RawListing } from "../types/RawListing";
import type { NormalizedListing } from "../types/NormalizedListing";
import { AddonDetector } from "./AddonDetector";
import { TaxCreditDetector } from "./TaxCreditDetector";
import { GapInsuranceDetector } from "./GapInsuranceDetector";

// ---------------------------------------------------------------------------
// Rebate detection patterns (spec §5.3)
// ---------------------------------------------------------------------------

interface RebateMatch {
  keyword: string;
  amount?: number;
}

/**
 * Each pattern represents one of the three rebate keyword groups (spec §5.3).
 * When `amountGroup` is set, the capture group at that index holds the dollar
 * amount embedded in the keyword itself. Otherwise the first `\$[\d,]+` found
 * anywhere in the text is used.
 */
const REBATE_PATTERNS: ReadonlyArray<{
  regex: RegExp;
  amountGroup?: number;
  label: string;
}> = [
  { regex: /after\s+rebates?/i, label: "after rebates" },
  {
    regex: /includes?\s+(\$[\d,]+)\s+rebate/i,
    amountGroup: 1,
    label: "includes $X rebate",
  },
  { regex: /with\s+loyalty\s+bonus/i, label: "with loyalty bonus" },
];

function detectRebate(text: string): RebateMatch | null {
  for (const { regex, amountGroup, label } of REBATE_PATTERNS) {
    const match = regex.exec(text);
    if (match) {
      let amount: number | undefined;

      if (amountGroup !== undefined && match[amountGroup]) {
        // Dollar amount is captured directly inside the keyword match
        amount = parseInt(match[amountGroup].replace(/[$,]/g, ""), 10);
      } else {
        // Fall back to the first dollar figure anywhere in the text
        const amountMatch = /\$[\d,]+/.exec(text);
        if (amountMatch) {
          amount = parseInt(amountMatch[0].replace(/[$,]/g, ""), 10);
        }
      }

      return { keyword: label, amount };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// NormalizationService
// ---------------------------------------------------------------------------

/**
 * Transforms a raw scraped listing into a `NormalizedListing` ready for
 * financial scoring (spec §5.3).
 *
 * Alias resolution: extractors already map dealer-specific price label names
 * ("Sames Price", "Internet Price", "Market Value", "Dealer Discount Price",
 * "e-Price", "Online Price", "Discounted Price") to `sellingPrice`. This
 * service promotes that resolved value to `adjustedSellingPrice`, falling
 * back to `msrp` when no selling price was scraped.
 */
export class NormalizationService {
  private readonly addonDetector = new AddonDetector();
  private readonly taxCreditDetector = new TaxCreditDetector();
  private readonly gapInsuranceDetector = new GapInsuranceDetector();

  normalize(listing: RawListing): NormalizedListing {
    // Precedence: sellingPrice (extractor-resolved alias) → msrp (spec §5.3)
    const adjustedSellingPrice = listing.sellingPrice ?? listing.msrp;

    let rebateDetected = false;
    let rebateAmount: number | undefined;

    if (listing.rawFinePrintText) {
      const rebate = detectRebate(listing.rawFinePrintText);
      if (rebate) {
        rebateDetected = true;
        rebateAmount = rebate.amount;
        console.log(
          JSON.stringify({
            level: "info",
            message: "Rebate detected in fine print",
            vin: listing.vin,
            rebateAmount,
            keywordMatch: rebate.keyword,
          }),
        );
      }
    }

    // ---- Add-on detection (spec §5.4) -------------------------------------
    const detectedAddons = this.addonDetector.detect(
      listing.rawFinePrintText ?? "",
    );

    const addonAdjustedPrice =
      adjustedSellingPrice +
      detectedAddons
        .filter((a) => a.isMandatory && a.detectedCost !== undefined)
        .reduce((sum, a) => sum + a.detectedCost!, 0);

    if (detectedAddons.length > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "Dealer add-ons detected in fine print",
          vin: listing.vin,
          addonCount: detectedAddons.length,
          addonAdjustedPrice,
          addons: detectedAddons.map((a) => ({
            addonName: a.addonName,
            detectedCost: a.detectedCost,
            keywordMatch: a.keywordMatch,
          })),
        }),
      );
    }

    // ---- Tax credit detection (spec §9.2) ----------------------------------
    const taxCreditResult = this.taxCreditDetector.detect(
      listing.rawFinePrintText ?? "",
    );

    const taxCreditFlag = taxCreditResult.detected;
    const texasTax: number | null = taxCreditFlag ? 0 : null;

    if (taxCreditFlag) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "Lender tax credit detected in fine print",
          vin: listing.vin,
          keywordMatch: taxCreditResult.keywordMatch,
          auditContext: taxCreditResult.auditContext,
        }),
      );
    }

    // ---- GAP insurance detection (spec F03.4 / §9.3) ----------------------
    let gapInsuranceDetected: boolean | null = null;

    if (listing.transactionType === "balloon") {
      const gapResult = this.gapInsuranceDetector.detect(
        listing.rawFinePrintText ?? "",
      );
      gapInsuranceDetected = gapResult.detected;

      if (!gapInsuranceDetected) {
        console.log(
          JSON.stringify({
            level: "warn",
            message: "Balloon listing missing GAP insurance mention",
            vin: listing.vin,
          }),
        );
      } else {
        console.log(
          JSON.stringify({
            level: "info",
            message: "GAP insurance detected in balloon listing fine print",
            vin: listing.vin,
            keywordMatch: gapResult.keywordMatch,
          }),
        );
      }
    }

    return {
      ...listing,
      adjustedSellingPrice,
      rebateDetected,
      ...(rebateAmount !== undefined ? { rebateAmount } : {}),
      detectedAddons,
      addonAdjustedPrice,
      taxCreditFlag,
      texasTax,
      gapInsuranceDetected,
    };
  }
}
