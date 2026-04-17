# E02 — Scraper Foundation

**Phase:** Phase 1 (Weeks 1–4)  
**Goal:** Reliably extract inventory and pricing data from all supported dealer platforms and persist raw HTML to S3.  
**Spec Reference:** §5 (Scraping & Data Ingestion Layer)  
**Depends On:** E01 (F01.1 DB, F01.2 Redis, F01.3 S3, F01.4 Docker)

---

## Features

### F02.1 — Playwright Browser Base Setup

**Description:** Bootstrap the Playwright project with anti-bot hardening so all subsequent scrapers inherit a stealth-capable, proxy-aware browser launcher.

**Tasks:**
- [x] Initialize Node.js project in `services/scraper/`
- [x] Install `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth`
- [x] Create `BrowserLauncher` class:
  - Launches Chromium with stealth plugin active
  - Randomizes `viewport` (width: 1280–1920, height: 720–1080)
  - Randomizes `userAgent` from a curated list of real Chrome UAs
  - Randomizes `Accept-Language` header (en-US, es-MX variants)
- [x] Create `HumanBehavior` helper:
  - `randomScroll(page)` — scrolls in steps of 100–400ms delays
  - `randomMousePath(page, targetX, targetY)` — moves mouse in curved path before clicking
- [x] Implement exponential back-off interceptor: on HTTP 429 or Cloudflare challenge, retry up to 3 times with base delay 8s (spec §5.2.1)

**Acceptance Criteria:**
- `BrowserLauncher.launch()` returns a Playwright `Page` object with stealth plugin active.
- Running the browser against `bot.sannysoft.com` produces no "detected" results for standard fingerprint checks.
- A test confirms back-off retries fire at 8s, 16s, 32s and then throw after the third failure.

---

### F02.2 — Residential Proxy Rotation Module

**Description:** A proxy manager that keeps a pool of residential proxy URLs and rotates them per request, ensuring no IP is reused within a 15-minute window for the same dealer domain.

**Tasks:**
- [x] Create `ProxyManager` class:
  - Loads proxy list from environment variable `PROXY_LIST` (newline-separated `host:port:user:pass` strings)
  - `getProxy(dealerDomain: string)`: returns a proxy not used for `dealerDomain` in the last 15 minutes
  - Tracks `lastUsed` timestamps per `(dealerDomain, proxyIp)` in Redis with a 15-minute TTL key
- [x] Integrate `ProxyManager` into `BrowserLauncher` so every `launch()` call receives a fresh proxy
- [x] Add a `proxyHealth` check: flag proxies that return 3 consecutive non-200 responses

**Acceptance Criteria:**
- The same proxy IP is never returned for the same dealer domain within a 15-minute window.
- A unit test with a mock Redis client verifies proxy rotation logic across 20 simulated requests.
- Unhealthy proxies are excluded from the rotation pool after 3 consecutive failures.

---

### F02.3 — Dealer.com Extractor (Sames Laredo Nissan)

**Description:** Scraper that extracts new inventory listings from Dealer.com platform pages using JSON-LD schema markup.

**Tasks:**
- [ ] Create `DealerDotComExtractor` class extending the base scraper:
  - Navigate to `{dealer.inventory_url}` (pattern: `/new-inventory/index.htm`)
  - Wait for JSON-LD `<script type="application/ld+json">` with `@type: "Car"` to be present in DOM
  - Parse all JSON-LD `Car` objects from the page
  - Map JSON-LD fields to the canonical `RawListing` interface (see below)
- [ ] Handle pagination: detect "next page" button or XHR-based infinite scroll and extract all pages
- [ ] Extract specials fine-print: scan repeating "Special" card elements and extract `perMonth`, `dueAtSigning`, `termMonths`, `mf`, `residual` using regex patterns
- [ ] Persist raw HTML of each page to S3 via `StorageClient.upload(key, html)` where `key = dealers/{dealerId}/{timestamp}.html`

**Canonical `RawListing` interface:**
```typescript
interface RawListing {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  msrp: number;
  sellingPrice?: number;
  advertisedMonthly?: number;
  moneyFactor?: number;
  residualPercent?: number;
  leaseTermMonths?: number;
  dueAtSigning?: number;
  aprPercent?: number;
  loanTermMonths?: number;
  transactionType: 'lease' | 'finance' | 'balloon';
  rawFinePrintText?: string;
  rawS3Key?: string;
  scrapedAt: Date;
}
```

**Acceptance Criteria:**
- Extractor returns at least 80% of visible inventory items from a Dealer.com test page fixture.
- All required `RawListing` fields (`vin`, `year`, `make`, `model`, `msrp`) are populated on every returned item.
- Raw HTML is persisted to S3 and the `rawS3Key` is set on the listing.
- Unit tests run against local HTML fixtures (no live network calls in CI).

---

### F02.4 — Sincro Extractor (Toyota of Laredo / Powell Watson)

**Description:** Scraper that extracts inventory from Sincro-platform pages by intercepting XHR calls to the internal JSON price stack.

**Tasks:**
- [x] Create `SincroExtractor` class:
  - Set up Playwright request interception targeting `*.sincro.*` or `/SearchNew*` XHR patterns
  - Capture JSON price stack response body before page fully renders
  - Parse the price stack JSON into the `RawListing` interface
  - Fallback: if XHR intercept misses, parse `data-price` / `data-vin` HTML attributes
- [x] Handle session cookies: Sincro may require a cookie consent click before data loads
- [x] Persist raw response JSON to S3 (in addition to raw HTML)

**Acceptance Criteria:**
- XHR intercept captures the price stack on at least 95% of test runs against local Sincro page fixtures.
- HTML attribute fallback activates automatically when no XHR is captured within 10 seconds.
- Unit tests (fixture-based) cover both the intercept path and the fallback path.

---

### F02.5 — DealerOn Extractor

**Description:** Scraper for DealerOn-platform dealer sites using `wait-for-element` and `data-*` HTML attribute parsing.

**Tasks:**
- [x] Create `DealerOnExtractor` class:
  - Wait for CSS selector `[data-selling-price]` or equivalent to appear (spec §5.1)
  - Extract inventory items from `data-*` attributes on listing cards
  - Map to `RawListing` interface
- [x] Implement "load more" / pagination handling for infinite-scroll inventory grids

**Acceptance Criteria:**
- Extractor correctly parses `data-vin`, `data-price`, `data-msrp` attributes from DealerOn fixture HTML.
- "Load more" pagination extracts items beyond the initial page load.

---

### F02.6 — Dealer Inspire Extractor

**Description:** Scraper for Dealer Inspire sites by intercepting async API feed calls.

**Tasks:**
- [x] Create `DealerInspireExtractor` class:
  - Intercept API calls matching patterns like `/api/inventory*` or `/vehicles/api*`
  - Parse the JSON response into `RawListing` interface
  - Fallback to HTML parsing if API call pattern doesn't match

**Acceptance Criteria:**
- API feed intercept correctly parses at least one complete listing from a Dealer Inspire fixture.
- Fallback HTML path activates when the API intercept finds no matching requests.

---

### F02.7 — Scrape Job Queue & Orchestrator

**Description:** A BullMQ-based orchestrator that schedules and dispatches scrape jobs per dealer on the schedule defined in the spec.

**Tasks:**
- [x] Create `ScrapeOrchestrator` service:
  - On startup, load all `is_active = TRUE` dealers from the `dealers` table
  - Enqueue a `scrape-job` for each dealer with the correct repeat schedule (spec §5.2.2):
    - Dealer inventory pages: every 6 hours
    - Specials pages: every 12 hours
    - Buy rate database: 1st of each month
  - Job payload: `{ dealerId, url, platform, jobType: 'inventory' | 'specials' | 'buy_rates' }`
- [x] Create `ScrapeWorker`:
  - Consumes `scrape-jobs` queue
  - Routes job to correct Extractor based on `platform` field
  - On success: writes `RawListing[]` to a `raw_listings` stage table or directly triggers E03 enrichment pipeline
  - On failure: logs error with `dealerId`, `url`, retry count; BullMQ handles retries
- [x] Implement job concurrency limit: max 20 concurrent Playwright instances (spec §12)

**Acceptance Criteria:**
- All active dealers are scheduled correctly; schedules survive a service restart.
- Failed jobs retry up to 3 times with exponential back-off before moving to the dead-letter queue.
- Concurrency is capped at 20 simultaneous Playwright instances.
- A `GET /scraper/status` internal endpoint returns queue depth and last-run timestamp per dealer.

---

## Testing Strategy

- All extractors must have unit tests against **local HTML fixture files** — no live network calls in CI.
- Fixture files are stored in `services/scraper/test/fixtures/{platform}/`.
- Integration tests (tagged `@integration`) run against live dealer sites in a separate CI job with proxy configured.

---

## Dependencies for Downstream Epics

| Downstream Epic | Requires from E02 |
|---|---|
| E03 (Data Enrichment) | F02.3–F02.6 `RawListing` output, F02.7 orchestrator pipeline |
