"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseExtractor = void 0;
const BrowserLauncher_1 = require("../browser/BrowserLauncher");
const HumanBehavior_1 = require("../browser/HumanBehavior");
const BackoffInterceptor_1 = require("../browser/BackoffInterceptor");
const shared_1 = require("@cartool/shared");
/**
 * Abstract base class for all platform extractors.
 *
 * Handles the shared lifecycle: launch browser → navigate → extract pages →
 * archive HTML to S3 → close browser. Platform-specific subclasses override
 * `extractListings()` and `handlePagination()`.
 */
class BaseExtractor {
    dealerId;
    targetUrl;
    dealerDomain;
    constructor(config) {
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
    async run() {
        const { browser, page } = await BrowserLauncher_1.BrowserLauncher.launch({
            dealerDomain: this.dealerDomain,
        });
        try {
            await this.beforeNavigate(page);
            await (0, BackoffInterceptor_1.withRetry)(() => page.goto(this.targetUrl, { waitUntil: "networkidle" }));
            await HumanBehavior_1.HumanBehavior.randomScroll(page);
            const allListings = [];
            const scrapedAt = new Date();
            let pageNum = 0;
            do {
                pageNum++;
                const html = await page.content();
                const s3Key = `dealers/${this.dealerId}/${Date.now()}.html`;
                await (0, shared_1.storageClient)().upload(s3Key, Buffer.from(html));
                const listings = await this.extractListings(page);
                for (const listing of listings) {
                    listing.rawS3Key = s3Key;
                    listing.scrapedAt = scrapedAt;
                    allListings.push(listing);
                }
                console.log(JSON.stringify({
                    level: "info",
                    message: "Page extracted",
                    dealerId: this.dealerId,
                    page: pageNum,
                    listingsFound: listings.length,
                    s3Key,
                }));
            } while (await this.handlePagination(page));
            return allListings;
        }
        finally {
            await browser.close();
        }
    }
    /**
     * Hook called after the browser launches but before navigation.
     * Override in subclasses to set up request interception, route handlers, etc.
     */
    async beforeNavigate(_page) {
        // No-op by default
    }
}
exports.BaseExtractor = BaseExtractor;
