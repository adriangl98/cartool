"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AddonDetector_1 = require("../../src/normalizer/AddonDetector");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function findAddon(addons, name) {
    return addons.find((a) => a.addonName === name);
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AddonDetector", () => {
    let detector;
    beforeEach(() => {
        detector = new AddonDetector_1.AddonDetector();
    });
    // -------------------------------------------------------------------------
    // No add-ons
    // -------------------------------------------------------------------------
    it("returns an empty array when no known keywords are present", () => {
        const result = detector.detect("Standard equipment. See dealer for details.");
        expect(result).toHaveLength(0);
    });
    it("returns an empty array for an empty string", () => {
        expect(detector.detect("")).toHaveLength(0);
    });
    // -------------------------------------------------------------------------
    // Explicit cost extraction
    // -------------------------------------------------------------------------
    it("extracts explicit cost when dollar amount appears near the keyword", () => {
        const result = detector.detect("Vehicle includes window tint ($699) applied at dealer.");
        expect(result).toHaveLength(1);
        const addon = findAddon(result, "Window Tint");
        expect(addon).toBeDefined();
        expect(addon.detectedCost).toBe(699);
        expect(addon.isMandatory).toBe(true);
        expect(addon.keywordMatch).toBe("window tint");
    });
    it("uses explicit cost over midpoint when both are available", () => {
        const result = detector.detect("Price includes ceramic coat ($995).");
        const addon = findAddon(result, "Ceramic Coating");
        expect(addon.detectedCost).toBe(995);
    });
    // -------------------------------------------------------------------------
    // Midpoint fallback (no explicit cost)
    // -------------------------------------------------------------------------
    it("falls back to midpoint cost when no dollar amount is near the keyword", () => {
        const result = detector.detect("All vehicles include nitrogen-filled tires as standard equipment.");
        const addon = findAddon(result, "Nitrogen Fill");
        expect(addon).toBeDefined();
        expect(addon.detectedCost).toBe(249);
    });
    it("uses midpoint $1245 for Ceramic Coating when no explicit cost", () => {
        const result = detector.detect("Includes ceramic shield protection.");
        expect(findAddon(result, "Ceramic Coating").detectedCost).toBe(1245);
    });
    it("uses midpoint $449 for VIN Etching when no explicit cost", () => {
        const result = detector.detect("VIN etch included on all vehicles.");
        expect(findAddon(result, "VIN Etching").detectedCost).toBe(449);
    });
    it("uses midpoint $295 for Interior Protection when no explicit cost", () => {
        const result = detector.detect("All vehicles have fabric protection applied.");
        expect(findAddon(result, "Interior Protection").detectedCost).toBe(295);
    });
    it("uses midpoint $599 for Window Tint when no explicit cost", () => {
        const result = detector.detect("Includes tinted windows on all stock.");
        expect(findAddon(result, "Window Tint").detectedCost).toBe(599);
    });
    // -------------------------------------------------------------------------
    // Multiple add-ons
    // -------------------------------------------------------------------------
    it("returns multiple DetectedAddon records when multiple groups match", () => {
        const result = detector.detect("All vehicles include nitrogen-filled tires and interior protection.");
        expect(result).toHaveLength(2);
        expect(findAddon(result, "Nitrogen Fill").detectedCost).toBe(249);
        expect(findAddon(result, "Interior Protection").detectedCost).toBe(295);
    });
    // -------------------------------------------------------------------------
    // Acceptance criteria test (spec §5.4)
    // -------------------------------------------------------------------------
    it("AC: detects nitrogen at midpoint and window tint at explicit cost from AC fixture text", () => {
        const text = "Includes nitrogen-filled tires and window tint ($699)";
        const result = detector.detect(text);
        expect(result).toHaveLength(2);
        const nitrogen = findAddon(result, "Nitrogen Fill");
        expect(nitrogen).toBeDefined();
        expect(nitrogen.detectedCost).toBe(249);
        expect(nitrogen.isMandatory).toBe(true);
        const tint = findAddon(result, "Window Tint");
        expect(tint).toBeDefined();
        expect(tint.detectedCost).toBe(699);
        expect(tint.isMandatory).toBe(true);
    });
    // -------------------------------------------------------------------------
    // Case-insensitive matching
    // -------------------------------------------------------------------------
    it("matches keywords case-insensitively", () => {
        const result = detector.detect("WINDOW TINT applied to all vehicles.");
        expect(result).toHaveLength(1);
        expect(findAddon(result, "Window Tint")).toBeDefined();
    });
    it("matches mixed-case keyword variants", () => {
        const result = detector.detect("Vehicle has Ceramic Coat and VIN Etch.");
        expect(result).toHaveLength(2);
        expect(findAddon(result, "Ceramic Coating")).toBeDefined();
        expect(findAddon(result, "VIN Etching")).toBeDefined();
    });
    // -------------------------------------------------------------------------
    // Generic Package
    // -------------------------------------------------------------------------
    it("detects Generic Package with explicit cost when dollar amount present", () => {
        const result = detector.detect("Includes dealer installed accessories package ($1,200).");
        const addon = findAddon(result, "Generic Package");
        expect(addon).toBeDefined();
        expect(addon.detectedCost).toBe(1200);
        expect(addon.isMandatory).toBe(true);
    });
    it("returns Generic Package with detectedCost = undefined when no dollar amount found", () => {
        const result = detector.detect("All vehicles include dealer installed accessories.");
        const addon = findAddon(result, "Generic Package");
        expect(addon).toBeDefined();
        expect(addon.detectedCost).toBeUndefined();
        expect(addon.isMandatory).toBe(true);
    });
    // -------------------------------------------------------------------------
    // keywordMatch field
    // -------------------------------------------------------------------------
    it("records the matched keyword string (lowercased) in keywordMatch", () => {
        const result = detector.detect("Includes Nitrogen Tires as standard.");
        const addon = findAddon(result, "Nitrogen Fill");
        expect(addon.keywordMatch).toBe("nitrogen tires");
    });
    // -------------------------------------------------------------------------
    // Each group matches at most once
    // -------------------------------------------------------------------------
    it("matches each keyword group at most once even when multiple triggers appear", () => {
        const result = detector.detect("window tint and tinted windows and window film are all applied.");
        const tintAddons = result.filter((a) => a.addonName === "Window Tint");
        expect(tintAddons).toHaveLength(1);
    });
});
