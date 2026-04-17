/**
 * Canonical interface for raw scraped inventory listings.
 * All platform extractors must map their output to this shape.
 *
 * Fields that cannot be extracted must be `undefined` (not `null`, not `0`).
 */
export interface RawListing {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  msrp: number;
  sellingPrice?: number;
  advertisedMonthly?: number;
  moneyFactor?: number;
  residualPercent?: number;
  leaseTermMonths?: number;
  dueAtSigning?: number;
  aprPercent?: number;
  loanTermMonths?: number;
  transactionType: "lease" | "finance" | "balloon";
  rawFinePrintText?: string;
  rawS3Key?: string;
  scrapedAt: Date;
}
