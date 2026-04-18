"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddonDetector = void 0;
// ---------------------------------------------------------------------------
// Keyword table (spec §5.4)
// ---------------------------------------------------------------------------
/**
 * Each entry represents one canonical add-on group.
 * `midpointCost` is `undefined` for the "Generic Package" group — cost must
 * be parsed from the surrounding text or the add-on is flagged without a cost.
 */
const ADDON_GROUPS = [
    {
        triggers: ["window tint", "tinted windows", "window film"],
        canonicalName: "Window Tint",
        midpointCost: 599,
    },
    {
        triggers: ["nitrogen", "n2 fill", "nitrogen tires"],
        canonicalName: "Nitrogen Fill",
        midpointCost: 249,
    },
    {
        triggers: ["ceramic coat", "paint protection", "ceramic shield"],
        canonicalName: "Ceramic Coating",
        midpointCost: 1245,
    },
    {
        triggers: ["vin etch", "vehicle identification", "theft protection"],
        canonicalName: "VIN Etching",
        midpointCost: 449,
    },
    {
        triggers: ["interior protection", "fabric protection", "scotchgard"],
        canonicalName: "Interior Protection",
        midpointCost: 295,
    },
    {
        // No midpointCost — cost must be parsed from surrounding text
        triggers: ["protection package", "laredo package", "dealer installed"],
        canonicalName: "Generic Package",
    },
];
/** Characters to capture on each side of a keyword match for cost extraction. */
const CONTEXT_RADIUS = 100;
const DOLLAR_AMOUNT_REGEX = /\$[\d,]+/;
// ---------------------------------------------------------------------------
// AddonDetector
// ---------------------------------------------------------------------------
/**
 * Scans fine-print text for mandatory dealer add-ons defined in spec §5.4.
 *
 * Each keyword group matches at most once per text (first match wins).
 * When a match is found, the detector attempts to extract an explicit dollar
 * amount from the surrounding 200 characters. Failing that, it falls back to
 * the group's spec midpoint cost. For the "Generic Package" group, if no
 * dollar amount is found the add-on is still returned with
 * `detectedCost = undefined` — it is flagged but excluded from the
 * `addonAdjustedPrice` sum.
 */
class AddonDetector {
    detect(text) {
        const allMatches = [];
        for (let i = 0; i < ADDON_GROUPS.length; i++) {
            const group = ADDON_GROUPS[i];
            // Sort triggers longest-first so the most specific pattern wins in alternation
            const sortedTriggers = [...group.triggers].sort((a, b) => b.length - a.length);
            const pattern = new RegExp(sortedTriggers
                .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join("|"), "i");
            const match = pattern.exec(text);
            if (match) {
                allMatches.push({
                    groupIndex: i,
                    matchStart: match.index,
                    matchEnd: match.index + match[0].length,
                    matchedTrigger: match[0].toLowerCase(),
                });
            }
        }
        // Sort by position in text so we can find boundaries between adjacent matches
        allMatches.sort((a, b) => a.matchStart - b.matchStart);
        // ---------------------------------------------------------------------------
        // Pass 2 — extract cost for each match from its forward window only
        //          (from match end to the start of the next match OR +CONTEXT_RADIUS)
        // ---------------------------------------------------------------------------
        const results = [];
        for (let i = 0; i < allMatches.length; i++) {
            const info = allMatches[i];
            const group = ADDON_GROUPS[info.groupIndex];
            const nextMatchStart = allMatches[i + 1]?.matchStart ?? text.length;
            const forwardEnd = Math.min(info.matchEnd + CONTEXT_RADIUS, nextMatchStart);
            const forwardContext = text.slice(info.matchEnd, forwardEnd);
            let detectedCost;
            const dollarMatch = DOLLAR_AMOUNT_REGEX.exec(forwardContext);
            if (dollarMatch) {
                detectedCost = parseInt(dollarMatch[0].replace(/[$,]/g, ""), 10);
            }
            else if (group.midpointCost !== undefined) {
                detectedCost = group.midpointCost;
            }
            // else: Generic Package with no parseable cost — detectedCost stays undefined
            results.push({
                addonName: group.canonicalName,
                detectedCost,
                isMandatory: true,
                keywordMatch: info.matchedTrigger,
            });
        }
        return results;
    }
}
exports.AddonDetector = AddonDetector;
