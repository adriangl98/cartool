import express from "express";
import { chromium } from "playwright";

const app = express();
const port = Number(process.env.PORT ?? 3003);

// Verify Chromium is launchable at startup (AC: scraper must launch Chromium).
async function verifyChromium(): Promise<void> {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const version = browser.version();
  await browser.close();
  console.log(JSON.stringify({ level: "info", message: `Chromium verified`, version }));
}

verifyChromium().catch((err) => {
  console.error(JSON.stringify({ level: "error", message: "Chromium launch failed", error: String(err) }));
  process.exit(1);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "scraper" });
});

app.listen(port, () => {
  console.log(JSON.stringify({ level: "info", message: `scraper service listening on ${port}` }));
});
