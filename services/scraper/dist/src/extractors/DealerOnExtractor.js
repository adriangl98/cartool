"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DealerOnExtractor = void 0;
const HumanBehavior_1 = require("../browser/HumanBehavior");
const BaseExtractor_1 = require("./BaseExtractor");
// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------
const LOAD_MORE_SELECTORS = [
    "button.load-more",
    ".show-more-inventory",
    "[data-load-more]",
    "button.see-more",
    ".load-more-btn",
];
const NEXT_PAGE_SELECTORS = [
    "a[aria-label='Next']",
    "a[aria-label='next']",
    ".pagination-next:not(.disabled) a",
    ".pagination .next:not(.disabled) a",
    "a.next-page:not(.disabled)",
];
const SPECIALS_SELECTORS = [
    ".special-offer",
    ".payment-info",
    "[data-special]",
    ".incentive-card",
    ".offer-card",
];
/**
 * Extractor for DealerOn platform pages.
 *
 * Primary data source: `data-*` HTML attributes on inventory listing cards
 * (`data-vin`, `data-year`, `data-make`, `data-model`, `data-trim`,
 * `data-msrp`, `data-selling-price`).
 *
 * Supports "Load More" / infinite-scroll pagination as well as traditional
 * next-page links.
 */
class DealerOnExtractor extends BaseExtractor_1.BaseExtractor {
    // -------------------------------------------------------------------------
    // Core extraction
    // -------------------------------------------------------------------------
    async extractListings(page) {
        // Wait for at least one listing card to appear
        await page
            .waitForSelector("[data-vin]", { timeout: 15_000 })
            .catch(() => null);
        const items = await this.extractDataAttributes(page);
        const specials = await this.extractSpecials(page);
        return this.mapToRawListings(items, specials);
    }
    // -------------------------------------------------------------------------
    // Pagination — "Load More" button and traditional next links
    // -------------------------------------------------------------------------
    async handlePagination(page) {
        // Try "Load More" / "Show More" buttons first
        for (const selector of LOAD_MORE_SELECTORS) {
            const button = await page.$(selector);
            if (button) {
                const box = await button.boundingBox();
                if (box) {
                    await HumanBehavior_1.HumanBehavior.randomMousePath(page, box.x + box.width / 2, box.y + box.height / 2);
                    await page.waitForLoadState("networkidle");
                    return true;
                }
            }
        }
        // Fallback: traditional next-page links
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
    // data-* attribute extraction
    // -------------------------------------------------------------------------
    async extractDataAttributes(page) {
        return page.$$eval("[data-vin]", (elements) => elements.map((el) => ({
            vin: el.getAttribute("data-vin") ?? "",
            year: el.getAttribute("data-year") ?? "",
            make: el.getAttribute("data-make") ?? "",
            model: el.getAttribute("data-model") ?? "",
            trim: el.getAttribute("data-trim") ?? "",
            msrp: el.getAttribute("data-msrp") ?? "",
            sellingPrice: el.getAttribute("data-selling-price") ?? el.getAttribute("data-price") ?? "",
        })));
    }
    // -------------------------------------------------------------------------
    // Mapping to RawListing
    // -------------------------------------------------------------------------
    mapToRawListings(items, specials) {
        const listings = [];
        for (const item of items) {
            const vin = item.vin.trim();
            const year = parseInt(item.year, 10);
            const make = item.make.trim();
            const model = item.model.trim();
            const msrp = parseFloat(item.msrp.replace(/[,$]/g, ""));
            // Skip listings missing required fields
            if (!vin || isNaN(year) || !make || !model || isNaN(msrp) || msrp <= 0) {
                continue;
            }
            const sellingPrice = item.sellingPrice
                ? parseFloat(item.sellingPrice.replace(/[,$]/g, ""))
                : undefined;
            const listing = {
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
            };
            // Merge specials data if a match exists (by VIN or model)
            const special = specials.get(vin) ?? this.findSpecialByModel(specials, model);
            if (special) {
                listing.advertisedMonthly = special.advertisedMonthly;
                listing.dueAtSigning = special.dueAtSigning;
                listing.leaseTermMonths = special.leaseTermMonths;
                listing.moneyFactor = special.moneyFactor;
                listing.residualPercent = special.residualPercent;
                listing.rawFinePrintText = special.rawFinePrintText;
                if (special.leaseTermMonths !== undefined ||
                    special.moneyFactor !== undefined) {
                    listing.transactionType = "lease";
                }
            }
            listings.push(listing);
        }
        return listings;
    }
    // -------------------------------------------------------------------------
    // Specials fine-print extraction
    // -------------------------------------------------------------------------
    async extractSpecials(page) {
        const specialsMap = new Map();
        for (const selector of SPECIALS_SELECTORS) {
            const cards = await page.$$(selector);
            if (cards.length === 0)
                continue;
            for (const card of cards) {
                const text = await card.evaluate((el) => el.textContent ?? "");
                if (!text.trim())
                    continue;
                const data = this.parseFinePrint(text);
                if (!data)
                    continue;
                // Try to find a VIN reference in the card
                const vinMatch = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
                const key = vinMatch ? vinMatch[0] : `__model__${text.slice(0, 50)}`;
                specialsMap.set(key, data);
            }
            // Only use the first matching selector that has results
            break;
        }
        return specialsMap;
    }
    parseFinePrint(text) {
        const monthly = text.match(/\$([\d,]+\.?\d*)\s*\/?\s*mo/i);
        const due = text.match(/\$([\d,]+\.?\d*)\s*due\s*(at\s*signing)?/i);
        const term = text.match(/(\d+)\s*months?/i);
        const mf = text.match(/(?:money\s*factor|mf)\s*[:=]?\s*(0?\.\d+)/i);
        const residual = text.match(/([\d.]+)%\s*residual/i);
        // Only return if at least one payment field was found
        if (!monthly && !due && !term && !mf && !residual)
            return null;
        return {
            advertisedMonthly: monthly
                ? parseFloat(monthly[1].replace(/,/g, ""))
                : undefined,
            dueAtSigning: due
                ? parseFloat(due[1].replace(/,/g, ""))
                : undefined,
            leaseTermMonths: term ? parseInt(term[1], 10) : undefined,
            moneyFactor: mf ? parseFloat(mf[1]) : undefined,
            residualPercent: residual ? parseFloat(residual[1]) : undefined,
            rawFinePrintText: text.trim(),
        };
    }
    findSpecialByModel(specials, model) {
        const lowerModel = model.toLowerCase();
        for (const [key, data] of specials) {
            if (key.startsWith("__model__") &&
                data.rawFinePrintText.toLowerCase().includes(lowerModel)) {
                return data;
            }
        }
        return undefined;
    }
}
exports.DealerOnExtractor = DealerOnExtractor;
