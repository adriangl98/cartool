"use strict";
/**
 * Integration test: validates stealth plugin effectiveness against bot.sannysoft.com.
 *
 * Skipped unless RUN_INTEGRATION=true is set — requires a real Chromium browser
 * and network access. Run in a dedicated CI job, not in the unit test suite.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const describeIfIntegration = process.env["RUN_INTEGRATION"] === "true" ? describe : describe.skip;
describeIfIntegration("Stealth integration — bot.sannysoft.com", () => {
    // Dynamic import to avoid initializing playwright-extra in unit test runs
    let BrowserLauncher;
    beforeAll(async () => {
        const mod = await Promise.resolve().then(() => __importStar(require("../../src/browser/BrowserLauncher")));
        BrowserLauncher = mod.BrowserLauncher;
    });
    it("produces no 'detected' results for standard fingerprint checks", async () => {
        const { browser, page } = await BrowserLauncher.launch();
        try {
            await page.goto("https://bot.sannysoft.com/", {
                waitUntil: "networkidle",
                timeout: 30_000,
            });
            // The page has a table with test results.
            // "failed" cells have a red background and text like "FAIL" or "detected".
            const failedResults = await page.$$eval("table#fp-table tr td.failed, table tr td[style*='red']", (cells) => cells.map((c) => c.textContent?.trim() ?? ""));
            // Filter out empty and irrelevant false positives
            const actual = failedResults.filter((r) => r.length > 0);
            expect(actual).toEqual([]);
        }
        finally {
            await browser.close();
        }
    }, 60_000);
});
