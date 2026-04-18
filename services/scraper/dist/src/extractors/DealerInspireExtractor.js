"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DealerInspireExtractor = void 0;
const HumanBehavior_1 = require("../browser/HumanBehavior");
const shared_1 = require("@cartool/shared");
const BaseExtractor_1 = require("./BaseExtractor");
// ---------------------------------------------------------------------------
// URL matching patterns for Dealer Inspire API interception
// ---------------------------------------------------------------------------
const DEALER_INSPIRE_API_PATTERNS = [
    /\/api\/inventory/i,
    /\/vehicles\/api/i,
    /\/inventory\/search/i,
    /\/wp-json\/.*inventory/i,
    /\/api\/vehicles/i,
];
const NEXT_PAGE_SELECTORS = [
    ".pagination .next:not(.disabled) a",
    "a[aria-label='Next']",
    "a[aria-label='next']",
    ".di-search-pagination a.next",
    ".pagination-next:not(.disabled) a",
    "a.next-page:not(.disabled)",
];
/** Default timeout in ms to wait for API intercept before falling back to HTML. */
const DEFAULT_XHR_TIMEOUT_MS = 10_000;
/**
 * Extractor for Dealer Inspire platform pages.
 *
 * Primary strategy: intercept async API feed calls matching patterns like
 * `/api/inventory*` or `/vehicles/api*` and parse the JSON response.
 * Fallback: parse `data-*` HTML attributes on listing cards when no matching
 * API call is captured within the configured timeout.
 */
class DealerInspireExtractor extends BaseExtractor_1.BaseExtractor {
    interceptedResponses = [];
    xhrTimeoutMs = DEFAULT_XHR_TIMEOUT_MS;
    // -------------------------------------------------------------------------
    // Lifecycle hooks
    // -------------------------------------------------------------------------
    async beforeNavigate(page) {
        this.interceptedResponses = [];
        await page.route("**/*", async (route) => {
            const url = route.request().url();
            if (DEALER_INSPIRE_API_PATTERNS.some((p) => p.test(url))) {
                const response = await route.fetch();
                const contentType = response.headers()["content-type"] ?? "";
                if (contentType.includes("json")) {
                    try {
                        const body = await response.text();
                        this.interceptedResponses.push(body);
                    }
                    catch {
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
    async extractListings(page) {
        // Wait for API intercept to capture a feed response
        const captured = await this.waitForInterceptedData();
        if (captured.length > 0) {
            const listings = await this.extractFromApiFeed(captured);
            if (listings.length > 0)
                return listings;
            // Feed captured but parsing yielded nothing — fall through to HTML
        }
        // Fallback: parse HTML data attributes
        console.log(JSON.stringify({
            level: "warn",
            message: "No API feed captured — activating HTML fallback",
            dealerId: this.dealerId,
            dealerDomain: this.dealerDomain,
        }));
        return this.extractFromHtmlAttributes(page);
    }
    // -------------------------------------------------------------------------
    // Pagination
    // -------------------------------------------------------------------------
    async handlePagination(page) {
        for (const selector of NEXT_PAGE_SELECTORS) {
            const nextLink = await page.$(selector);
            if (nextLink) {
                const box = await nextLink.boundingBox();
                if (box) {
                    await HumanBehavior_1.HumanBehavior.randomMousePath(page, box.x + box.width / 2, box.y + box.height / 2);
                    await page.waitForLoadState("networkidle");
                    return true;
                }
            }
        }
        return false;
    }
    // -------------------------------------------------------------------------
    // API intercept path
    // -------------------------------------------------------------------------
    async waitForInterceptedData() {
        const start = Date.now();
        while (this.interceptedResponses.length === 0 &&
            Date.now() - start < this.xhrTimeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return [...this.interceptedResponses];
    }
    async extractFromApiFeed(responses) {
        const listings = [];
        for (const raw of responses) {
            let parsed;
            try {
                parsed = JSON.parse(raw);
            }
            catch {
                continue; // Skip malformed JSON
            }
            if (!Array.isArray(parsed.inventory))
                continue;
            // Persist raw JSON feed to S3
            const jsonS3Key = `dealers/${this.dealerId}/${Date.now()}.json`;
            await (0, shared_1.storageClient)().upload(jsonS3Key, Buffer.from(raw));
            for (const vehicle of parsed.inventory) {
                const listing = this.mapVehicleToListing(vehicle, jsonS3Key);
                if (listing)
                    listings.push(listing);
            }
        }
        return listings;
    }
    mapVehicleToListing(v, jsonS3Key) {
        if (!v.vin || !v.year || !v.make || !v.model || !v.msrp)
            return null;
        const listing = {
            vin: v.vin,
            year: v.year,
            make: v.make,
            model: v.model,
            trim: v.trim,
            msrp: v.msrp,
            sellingPrice: v.internet_price,
            transactionType: "finance",
            rawS3Key: jsonS3Key,
            scrapedAt: new Date(),
        };
        // Map lease payment fields
        if (v.payments?.lease) {
            const lease = v.payments.lease;
            listing.advertisedMonthly = lease.monthly_payment;
            listing.dueAtSigning = lease.due_at_signing;
            listing.leaseTermMonths = lease.term_months;
            listing.moneyFactor = lease.money_factor;
            listing.residualPercent = lease.residual_percent;
            if (lease.term_months !== undefined || lease.money_factor !== undefined) {
                listing.transactionType = "lease";
            }
        }
        // Map finance payment fields
        if (v.payments?.finance) {
            const finance = v.payments.finance;
            listing.aprPercent = finance.apr_percent;
            listing.loanTermMonths = finance.term_months;
            if (listing.advertisedMonthly === undefined &&
                finance.monthly_payment !== undefined) {
                listing.advertisedMonthly = finance.monthly_payment;
            }
        }
        return listing;
    }
    // -------------------------------------------------------------------------
    // HTML fallback path
    // -------------------------------------------------------------------------
    async extractFromHtmlAttributes(page) {
        const items = await page.$$eval("[data-vin]", (elements) => elements.map((el) => ({
            vin: el.getAttribute("data-vin") ?? "",
            year: el.getAttribute("data-year") ?? "",
            make: el.getAttribute("data-make") ?? "",
            model: el.getAttribute("data-model") ?? "",
            trim: el.getAttribute("data-trim") ?? "",
            msrp: el.getAttribute("data-msrp") ?? "",
            sellingPrice: el.getAttribute("data-selling-price") ??
                el.getAttribute("data-price") ??
                "",
        })));
        const listings = [];
        for (const item of items) {
            const vin = item.vin.trim();
            const year = parseInt(item.year, 10);
            const make = item.make.trim();
            const model = item.model.trim();
            const msrp = parseFloat(item.msrp.replace(/[,$]/g, ""));
            const sellingPrice = item.sellingPrice
                ? parseFloat(item.sellingPrice.replace(/[,$]/g, ""))
                : undefined;
            if (!vin || isNaN(year) || !make || !model || isNaN(msrp) || msrp <= 0) {
                continue;
            }
            listings.push({
                vin,
                year,
                make,
                model,
                trim: item.trim.trim() || undefined,
                msrp,
                sellingPrice: sellingPrice !== undefined && !isNaN(sellingPrice) && sellingPrice > 0
                    ? sellingPrice
                    : undefined,
                transactionType: "finance",
                scrapedAt: new Date(),
            });
        }
        return listings;
    }
}
exports.DealerInspireExtractor = DealerInspireExtractor;
