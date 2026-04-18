"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DealerDotComExtractor = void 0;
const HumanBehavior_1 = require("../browser/HumanBehavior");
const BaseExtractor_1 = require("./BaseExtractor");
const NEXT_PAGE_SELECTORS = [
    "a[aria-label='Next']",
    "a[aria-label='next']",
    ".pagination-next:not(.disabled) a",
    ".pagination .next:not(.disabled) a",
    "a.next-page:not(.disabled)",
];
/**
 * Extractor for Dealer.com platform pages.
 *
 * Primary data source: JSON-LD `<script type="application/ld+json">` blocks
 * containing `@type: "Car"` objects.
 *
 * Specials fine-print is extracted from repeating card elements and merged
 * with inventory listings by VIN or model match.
 */
class DealerDotComExtractor extends BaseExtractor_1.BaseExtractor {
    async extractListings(page) {
        // Wait for JSON-LD to appear in the DOM
        await page
            .waitForSelector('script[type="application/ld+json"]', { timeout: 15_000 })
            .catch(() => null); // Returns empty array when no JSON-LD found
        const jsonLdBlocks = await page.$$eval('script[type="application/ld+json"]', (scripts) => scripts.map((s) => s.textContent ?? ""));
        const cars = this.parseJsonLdCars(jsonLdBlocks);
        const specials = await this.extractSpecials(page);
        return this.mapToRawListings(cars, specials);
    }
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
    // ---------------------------------------------------------------------------
    // JSON-LD parsing
    // ---------------------------------------------------------------------------
    parseJsonLdCars(blocks) {
        const cars = [];
        for (const raw of blocks) {
            try {
                const parsed = JSON.parse(raw);
                this.collectCars(parsed, cars);
            }
            catch {
                // Skip malformed JSON-LD blocks
            }
        }
        return cars;
    }
    collectCars(data, results) {
        if (Array.isArray(data)) {
            for (const item of data) {
                this.collectCars(item, results);
            }
            return;
        }
        if (data && typeof data === "object") {
            const obj = data;
            if (obj["@type"] === "Car" || obj["@type"] === "Vehicle") {
                results.push(obj);
            }
            // Some sites wrap cars in @graph
            if (Array.isArray(obj["@graph"])) {
                this.collectCars(obj["@graph"], results);
            }
        }
    }
    // ---------------------------------------------------------------------------
    // JSON-LD → RawListing mapping
    // ---------------------------------------------------------------------------
    mapToRawListings(cars, specials) {
        const listings = [];
        for (const car of cars) {
            const vin = car.vehicleIdentificationNumber ?? car.sku;
            if (!vin)
                continue;
            const year = this.parseYear(car);
            const make = this.parseMake(car);
            const model = car.model ?? this.parseFieldFromName(car.name, "model");
            const msrp = this.parsePrice(car.offers?.price);
            if (year === undefined || !make || !model || msrp === undefined)
                continue;
            const listing = {
                vin,
                year,
                make,
                model,
                trim: car.vehicleConfiguration ?? this.parseFieldFromName(car.name, "trim"),
                msrp,
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
                if (special.leaseTermMonths !== undefined || special.moneyFactor !== undefined) {
                    listing.transactionType = "lease";
                }
            }
            listings.push(listing);
        }
        return listings;
    }
    parseYear(car) {
        if (car.vehicleModelDate) {
            const yr = parseInt(car.vehicleModelDate, 10);
            if (!isNaN(yr) && yr >= 1900 && yr <= 2100)
                return yr;
        }
        if (car.name) {
            const match = car.name.match(/\b(19|20)\d{2}\b/);
            if (match)
                return parseInt(match[0], 10);
        }
        return undefined;
    }
    parseMake(car) {
        if (typeof car.brand === "object" && car.brand?.name)
            return car.brand.name;
        if (typeof car.brand === "string")
            return car.brand;
        if (car.manufacturer)
            return car.manufacturer;
        return this.parseFieldFromName(car.name, "make");
    }
    parsePrice(price) {
        if (price === undefined || price === null)
            return undefined;
        const num = typeof price === "number" ? price : parseFloat(String(price).replace(/[,$]/g, ""));
        return isNaN(num) || num <= 0 ? undefined : num;
    }
    /**
     * Attempt to extract make, model, or trim from a name string like
     * "2025 Nissan Altima SR".
     */
    parseFieldFromName(name, field) {
        if (!name)
            return undefined;
        // Expected format: "YYYY Make Model Trim..."
        const parts = name.trim().split(/\s+/);
        // Skip leading year if present
        const start = /^\d{4}$/.test(parts[0] ?? "") ? 1 : 0;
        if (field === "make")
            return parts[start];
        if (field === "model")
            return parts[start + 1];
        if (field === "trim") {
            const trimParts = parts.slice(start + 2);
            return trimParts.length > 0 ? trimParts.join(" ") : undefined;
        }
        return undefined;
    }
    // ---------------------------------------------------------------------------
    // Specials fine-print extraction
    // ---------------------------------------------------------------------------
    async extractSpecials(page) {
        const selectors = [
            ".special-offer",
            ".payment-info",
            "[data-special]",
            ".incentive-card",
            ".offer-card",
        ];
        const specialsMap = new Map();
        for (const selector of selectors) {
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
                // Try to find a VIN or model reference in the card
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
            if (key.startsWith("__model__") && data.rawFinePrintText.toLowerCase().includes(lowerModel)) {
                return data;
            }
        }
        return undefined;
    }
}
exports.DealerDotComExtractor = DealerDotComExtractor;
