import type { Page, Route } from "playwright-core";
import { HumanBehavior } from "../browser/HumanBehavior";
import { storageClient } from "@cartool/shared";
import { BaseExtractor } from "./BaseExtractor";
import type { RawListing } from "../types/RawListing";

// ---------------------------------------------------------------------------
// Sincro price stack assumed types (validate during integration testing)
// ---------------------------------------------------------------------------

interface SincroPriceStackResponse {
  Vehicles: SincroPriceStackVehicle[];
}

interface SincroPriceStackVehicle {
  VIN: string;
  Year: number;
  Make: string;
  Model: string;
  Trim?: string;
  MSRP: number;
  SellingPrice?: number;
  InternetPrice?: number;
  Payments?: {
    Lease?: {
      MonthlyPayment?: number;
      DueAtSigning?: number;
      Term?: number;
      MoneyFactor?: number;
      ResidualPercent?: number;
    };
    Finance?: {
      MonthlyPayment?: number;
      APR?: number;
      Term?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// URL matching patterns for Sincro XHR interception
// ---------------------------------------------------------------------------

const SINCRO_XHR_PATTERNS = [
  /\.sincro\./i,
  /\/SearchNew/i,
  /\/searchnew/i,
  /\/GetVehicles/i,
  /\/api\/inventory/i,
] as const;

const COOKIE_CONSENT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  ".cookie-consent-accept",
  "[data-cookie-accept]",
  "#cookieAccept",
  ".accept-cookies",
] as const;

const NEXT_PAGE_SELECTORS = [
  ".pagination .next:not(.disabled) a",
  "a[aria-label='Next']",
  "a[aria-label='next']",
  ".srpPagination a.next",
  ".pagination-next:not(.disabled) a",
  "a.next-page:not(.disabled)",
] as const;

/** Default timeout in ms to wait for XHR intercept before falling back to HTML. */
const DEFAULT_XHR_TIMEOUT_MS = 10_000;

/**
 * Extractor for Sincro platform pages (e.g. Toyota of Laredo, Powell Watson).
 *
 * Primary strategy: intercept XHR/fetch calls to the internal JSON price stack.
 * Fallback: parse `data-vin` / `data-price` / `data-msrp` HTML attributes
 * when no XHR is captured within the configured timeout.
 */
export class SincroExtractor extends BaseExtractor {
  private interceptedResponses: string[] = [];
  protected xhrTimeoutMs = DEFAULT_XHR_TIMEOUT_MS;

  // -------------------------------------------------------------------------
  // Lifecycle hooks
  // -------------------------------------------------------------------------

  protected override async beforeNavigate(page: Page): Promise<void> {
    this.interceptedResponses = [];

    await page.route("**/*", async (route: Route) => {
      const url = route.request().url();

      if (SINCRO_XHR_PATTERNS.some((p) => p.test(url))) {
        const response = await route.fetch();
        const contentType = response.headers()["content-type"] ?? "";

        if (contentType.includes("json")) {
          try {
            const body = await response.text();
            this.interceptedResponses.push(body);
          } catch {
            // Response body unreadable — continue without capturing
          }
        }

        await route.fulfill({ response });
        return;
      }

      await route.continue();
    });
  }

  // -------------------------------------------------------------------------
  // Core extraction
  // -------------------------------------------------------------------------

  protected override async extractListings(page: Page): Promise<RawListing[]> {
    await this.dismissCookieConsent(page);

    // Wait for XHR intercept to capture a price stack response
    const captured = await this.waitForInterceptedData();

    if (captured.length > 0) {
      const listings = await this.extractFromPriceStack(captured);
      if (listings.length > 0) return listings;
      // Price stack captured but parsing yielded nothing — fall through to HTML
    }

    // Fallback: parse HTML data attributes
    console.log(
      JSON.stringify({
        level: "warn",
        message: "No XHR price stack captured — activating HTML fallback",
        dealerId: this.dealerId,
        dealerDomain: this.dealerDomain,
      })
    );

    return this.extractFromHtmlAttributes(page);
  }

  protected override async handlePagination(page: Page): Promise<boolean> {
    for (const selector of NEXT_PAGE_SELECTORS) {
      const nextLink = await page.$(selector);
      if (nextLink) {
        const box = await nextLink.boundingBox();
        if (box) {
          await HumanBehavior.randomMousePath(
            page,
            box.x + box.width / 2,
            box.y + box.height / 2
          );
          await page.waitForLoadState("networkidle");
          return true;
        }
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // XHR intercept path
  // -------------------------------------------------------------------------

  private async waitForInterceptedData(): Promise<string[]> {
    const start = Date.now();

    while (
      this.interceptedResponses.length === 0 &&
      Date.now() - start < this.xhrTimeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return [...this.interceptedResponses];
  }

  private async extractFromPriceStack(
    responses: string[]
  ): Promise<RawListing[]> {
    const listings: RawListing[] = [];

    for (const raw of responses) {
      let parsed: SincroPriceStackResponse;
      try {
        parsed = JSON.parse(raw) as SincroPriceStackResponse;
      } catch {
        continue; // Skip malformed JSON
      }

      if (!Array.isArray(parsed.Vehicles)) continue;

      // Persist raw JSON to S3
      const jsonS3Key = `dealers/${this.dealerId}/${Date.now()}.json`;
      await storageClient().upload(jsonS3Key, Buffer.from(raw));

      for (const vehicle of parsed.Vehicles) {
        const listing = this.mapVehicleToListing(vehicle, jsonS3Key);
        if (listing) listings.push(listing);
      }
    }

    return listings;
  }

  private mapVehicleToListing(
    v: SincroPriceStackVehicle,
    jsonS3Key: string
  ): RawListing | null {
    if (!v.VIN || !v.Year || !v.Make || !v.Model || !v.MSRP) return null;

    const listing: RawListing = {
      vin: v.VIN,
      year: v.Year,
      make: v.Make,
      model: v.Model,
      trim: v.Trim,
      msrp: v.MSRP,
      sellingPrice: v.SellingPrice ?? v.InternetPrice,
      transactionType: "finance",
      rawS3Key: jsonS3Key,
      scrapedAt: new Date(),
    };

    // Map lease payment fields
    if (v.Payments?.Lease) {
      const lease = v.Payments.Lease;
      listing.advertisedMonthly = lease.MonthlyPayment;
      listing.dueAtSigning = lease.DueAtSigning;
      listing.leaseTermMonths = lease.Term;
      listing.moneyFactor = lease.MoneyFactor;
      listing.residualPercent = lease.ResidualPercent;

      if (
        lease.Term !== undefined ||
        lease.MoneyFactor !== undefined
      ) {
        listing.transactionType = "lease";
      }
    }

    // Map finance payment fields
    if (v.Payments?.Finance) {
      const finance = v.Payments.Finance;
      listing.aprPercent = finance.APR;
      listing.loanTermMonths = finance.Term;

      if (
        !listing.advertisedMonthly &&
        finance.MonthlyPayment !== undefined
      ) {
        listing.advertisedMonthly = finance.MonthlyPayment;
      }
    }

    return listing;
  }

  // -------------------------------------------------------------------------
  // HTML fallback path
  // -------------------------------------------------------------------------

  private async extractFromHtmlAttributes(page: Page): Promise<RawListing[]> {
    const items = await page.$$eval("[data-vin]", (elements) =>
      elements.map((el) => ({
        vin: el.getAttribute("data-vin") ?? "",
        year: el.getAttribute("data-year") ?? "",
        make: el.getAttribute("data-make") ?? "",
        model: el.getAttribute("data-model") ?? "",
        trim: el.getAttribute("data-trim") ?? "",
        msrp: el.getAttribute("data-msrp") ?? "",
        price: el.getAttribute("data-price") ?? "",
      }))
    );

    const listings: RawListing[] = [];

    for (const item of items) {
      const vin = item.vin.trim();
      const year = parseInt(item.year, 10);
      const make = item.make.trim();
      const model = item.model.trim();
      const msrp = parseFloat(item.msrp.replace(/[,$]/g, ""));
      const sellingPrice = item.price
        ? parseFloat(item.price.replace(/[,$]/g, ""))
        : undefined;

      if (!vin || isNaN(year) || !make || !model || isNaN(msrp) || msrp <= 0) {
        continue;
      }

      listings.push({
        vin,
        year,
        make,
        model,
        trim: item.trim || undefined,
        msrp,
        sellingPrice:
          sellingPrice && !isNaN(sellingPrice) && sellingPrice > 0
            ? sellingPrice
            : undefined,
        transactionType: "finance",
        scrapedAt: new Date(),
      });
    }

    return listings;
  }

  // -------------------------------------------------------------------------
  // Cookie consent
  // -------------------------------------------------------------------------

  private async dismissCookieConsent(page: Page): Promise<void> {
    for (const selector of COOKIE_CONSENT_SELECTORS) {
      const btn = await page.$(selector);
      if (btn) {
        const box = await btn.boundingBox();
        if (box) {
          await HumanBehavior.randomMousePath(
            page,
            box.x + box.width / 2,
            box.y + box.height / 2
          );

          console.log(
            JSON.stringify({
              level: "info",
              message: "Dismissed cookie consent",
              dealerId: this.dealerId,
              selector,
            })
          );
        }
        return;
      }
    }
  }
}
