/**
 * Integration test: validates stealth plugin effectiveness against bot.sannysoft.com.
 *
 * Skipped unless RUN_INTEGRATION=true is set — requires a real Chromium browser
 * and network access. Run in a dedicated CI job, not in the unit test suite.
 */

const describeIfIntegration =
  process.env["RUN_INTEGRATION"] === "true" ? describe : describe.skip;

describeIfIntegration("Stealth integration — bot.sannysoft.com", () => {
  // Dynamic import to avoid initializing playwright-extra in unit test runs
  let BrowserLauncher: typeof import("../../src/browser/BrowserLauncher").BrowserLauncher;

  beforeAll(async () => {
    const mod = await import("../../src/browser/BrowserLauncher");
    BrowserLauncher = mod.BrowserLauncher;
  });

  it(
    "produces no 'detected' results for standard fingerprint checks",
    async () => {
      const { browser, page } = await BrowserLauncher.launch();

      try {
        await page.goto("https://bot.sannysoft.com/", {
          waitUntil: "networkidle",
          timeout: 30_000,
        });

        // The page has a table with test results.
        // "failed" cells have a red background and text like "FAIL" or "detected".
        const failedResults = await page.$$eval(
          "table#fp-table tr td.failed, table tr td[style*='red']",
          (cells) => cells.map((c) => c.textContent?.trim() ?? "")
        );

        // Filter out empty and irrelevant false positives
        const actual = failedResults.filter((r) => r.length > 0);

        expect(actual).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60_000
  );
});
