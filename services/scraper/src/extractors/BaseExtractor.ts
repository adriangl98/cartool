import type { Page, Browser } from "playwright-core";
import { BrowserLauncher } from "../browser/BrowserLauncher";
import { HumanBehavior } from "../browser/HumanBehavior";
import { withRetry } from "../browser/BackoffInterceptor";
import { storageClient } from "@cartool/shared";
import type { RawListing } from "../types/RawListing";

export interface ExtractorConfig {
  dealerId: string;
  targetUrl: string;
  dealerDomain: string;
}

/**
 * Abstract base class for all platform extractors.
 *
 * Handles the shared lifecycle: launch browser → navigate → extract pages →
 * archive HTML to S3 → close browser. Platform-specific subclasses override
 * `extractListings()` and `handlePagination()`.
 */
export abstract class BaseExtractor {
  protected readonly dealerId: string;
  protected readonly targetUrl: string;
  protected readonly dealerDomain: string;

  constructor(config: ExtractorConfig) {
    this.dealerId = config.dealerId;
    this.targetUrl = config.targetUrl;
    this.dealerDomain = config.dealerDomain;
  }

  /**
   * Execute the full scrape lifecycle:
   * 1. Launch stealth browser with proxy rotation
   * 2. Navigate to target URL (with retry)
   * 3. Human-like scroll
   * 4. Extract listings from each page, archiving HTML to S3
   * 5. Follow pagination until exhausted
   * 6. Close browser
   */
  async run(): Promise<RawListing[]> {
    const { browser, page } = await BrowserLauncher.launch({
      dealerDomain: this.dealerDomain,
    });

    try {
      await this.beforeNavigate(page);

      await withRetry(() =>
        page.goto(this.targetUrl, { waitUntil: "networkidle" })
      );

      await HumanBehavior.randomScroll(page);

      const allListings: RawListing[] = [];
      const scrapedAt = new Date();
      let pageNum = 0;

      do {
        pageNum++;
        const html = await page.content();
        const s3Key = `dealers/${this.dealerId}/${Date.now()}.html`;
        await storageClient().upload(s3Key, Buffer.from(html));

        const listings = await this.extractListings(page);

        for (const listing of listings) {
          listing.rawS3Key = s3Key;
          listing.scrapedAt = scrapedAt;
          allListings.push(listing);
        }

        console.log(
          JSON.stringify({
            level: "info",
            message: "Page extracted",
            dealerId: this.dealerId,
            page: pageNum,
            listingsFound: listings.length,
            s3Key,
          })
        );
      } while (await this.handlePagination(page));

      return allListings;
    } finally {
      await browser.close();
    }
  }

  /**
   * Hook called after the browser launches but before navigation.
   * Override in subclasses to set up request interception, route handlers, etc.
   */
  protected async beforeNavigate(_page: Page): Promise<void> {
    // No-op by default
  }

  /**
   * Extract inventory listings from the current page.
   * Must be implemented by each platform extractor.
   */
  protected abstract extractListings(page: Page): Promise<RawListing[]>;

  /**
   * Advance to the next page if one exists.
   * Returns `true` if navigation to a new page occurred, `false` if exhausted.
   */
  protected abstract handlePagination(page: Page): Promise<boolean>;
}
