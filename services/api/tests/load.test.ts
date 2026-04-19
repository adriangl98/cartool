/**
 * Load test — Phase 3 Definition of Done
 *
 * Validates p95 latency thresholds (spec §12) using autocannon against a
 * real HTTP server started in-process with mocked DB and Redis.
 *
 * Thresholds:
 *   GET  /listings                       < 300 ms  (spec F05.2)
 *   GET  /listings/:id/disclosure        < 300 ms  (spec F05.4)
 *   GET  /dealers                        < 300 ms  (spec F05.6)
 *   POST /reverse-search                 < 500 ms  (spec F05.3)
 *
 * autocannon reports `p97_5` (97.5th percentile) as the finest bucket above
 * p95.  If p97.5 < threshold then p95 < threshold.
 */

import autocannon from "autocannon";
import * as http from "http";
import { createApp } from "../src/app";
import { pool } from "../src/db";
import { redis } from "../src/redis";

// ── Module mocks (must be before any imports that transitively pull config.ts)
jest.mock("../src/db", () => ({ pool: { query: jest.fn() } }));
jest.mock("../src/redis", () => ({
  redis: { get: jest.fn(), set: jest.fn() },
}));

const mockPoolQuery = pool.query as jest.Mock;
const mockRedisGet = redis.get as jest.Mock;
const mockRedisSet = redis.set as jest.Mock;

// ── Preset fixture rows ────────────────────────────────────────────────────────

const LISTING_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const listingRow = {
  id: LISTING_ID,
  vin: "1N4BL4BV5NN123456",
  year: 2026,
  make: "Nissan",
  model: "Rogue",
  trim: "SV AWD",
  msrp: "32490.00",
  selling_price: "30100.00",
  addon_adjusted_price: "31595.00",
  transaction_type: "lease",
  advertised_monthly: "349.00",
  effective_monthly: "489.22",
  tcol: "17611.92",
  money_factor: "0.001750",
  mf_markup_flag: false,
  deal_score: 74,
  obbba_eligible: true,
  assembly_plant: "Smyrna, TN",
  gap_insurance_detected: false,
  scraped_at: "2026-04-16T08:00:00.000Z",
  dealer_id: "bbbbbbbb-0000-4000-8000-000000000001",
  dealer_name: "Sames Laredo Nissan",
  dealer_group: "Sames Auto Group",
  addons: [],
};

const disclosureRow = {
  id: LISTING_ID,
  vin: "1N4BL4BV5NN123456",
  year: 2026,
  make: "Nissan",
  model: "Rogue",
  trim: "SV AWD",
  transaction_type: "lease",
  raw_fine_print_text: "Offer valid through 04/30/2026.",
  tax_credit_flag: false,
  gap_insurance_detected: false,
  deal_score: 74,
  obbba_eligible: true,
  dealer_listing_url: "https://samesnissan.com",
  addons: [],
};

const dealerRow = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  name: "Sames Laredo Nissan",
  group_name: "Sames Auto Group",
  base_url: "https://samesnissan.com",
  zip_code: "78041",
  last_scraped_at: "2026-04-16T08:00:00.000Z",
};

// ── Mock fetch for Financial Engine (POST /solve) ─────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Server lifecycle ──────────────────────────────────────────────────────────

const app = createApp({
  nodeEnv: "test",
  corsAllowedOrigins: [],
  rateLimitMax: 500_000, // effectively unlimited — load test controls concurrency
  financialEngineUrl: "http://localhost:9999",
});

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Listings: pool.query is called twice per request (COUNT + DATA).
  // Use mockImplementation so it handles any number of concurrent calls.
  mockPoolQuery.mockImplementation(
    (query: { text?: string } | string) => {
      const text = typeof query === "string" ? query : (query.text ?? "");
      if (text.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ total: "1" }] });
      }
      // Dealers query (single call, no COUNT)
      if (text.includes("MAX(l.scraped_at)")) {
        return Promise.resolve({ rows: [dealerRow] });
      }
      // Disclosure query (single call, by id)
      if (text.includes("raw_fine_print_text")) {
        return Promise.resolve({ rows: [disclosureRow] });
      }
      // Listings data query and reverse-search data query
      return Promise.resolve({ rows: [listingRow] });
    },
  );

  mockRedisGet.mockResolvedValue(null); // always cache miss
  mockRedisSet.mockResolvedValue("OK");

  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      max_selling_price: "35000.00",
      avg_apr: "6.5",
    }),
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://localhost:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

// ── Helper ────────────────────────────────────────────────────────────────────

type AutocannonResult = Awaited<ReturnType<typeof autocannon>>;

async function runLoad(
  opts: autocannon.Options,
): Promise<AutocannonResult> {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

function printSummary(label: string, result: AutocannonResult) {
  const l = result.latency;
  const s2xx = result["2xx"] ?? 0;
  const errors = result.errors ?? 0;
  const timeouts = result.timeouts ?? 0;
  console.log(
    `\n[${label}]  RPS: ${result.requests.average.toFixed(0)}` +
    `  2xx: ${s2xx}  errors: ${errors}  timeouts: ${timeouts}` +
    `  latency p50=${l.p50}ms  p90=${l.p90}ms  p97.5=${l.p97_5}ms  p99=${l.p99}ms`,
  );
}

// ── Tests (50 concurrent connections, 10 s each) ─────────────────────────────

const CONNECTIONS = 50;
const DURATION_S = 10;

describe("Load test — Phase 3 DoD (50 concurrent users)", () => {
  // Generous test-suite timeout: 4 endpoints × 10s each + buffer
  jest.setTimeout(90_000);

  it("GET /listings — p97.5 < 300 ms", async () => {
    const result = await runLoad({
      url: `${baseUrl}/listings`,
      connections: CONNECTIONS,
      duration: DURATION_S,
    });

    printSummary("GET /listings", result);

    expect(result.errors).toBe(0);
    expect(result.timeouts).toBe(0);
    expect(result.latency.p97_5).toBeLessThan(300);
  });

  it("GET /listings/:id/disclosure — p97.5 < 300 ms", async () => {
    const result = await runLoad({
      url: `${baseUrl}/listings/${LISTING_ID}/disclosure`,
      connections: CONNECTIONS,
      duration: DURATION_S,
    });

    printSummary("GET /listings/:id/disclosure", result);

    expect(result.errors).toBe(0);
    expect(result.timeouts).toBe(0);
    expect(result.latency.p97_5).toBeLessThan(300);
  });

  it("GET /dealers — p97.5 < 300 ms", async () => {
    const result = await runLoad({
      url: `${baseUrl}/dealers`,
      connections: CONNECTIONS,
      duration: DURATION_S,
    });

    printSummary("GET /dealers", result);

    expect(result.errors).toBe(0);
    expect(result.timeouts).toBe(0);
    expect(result.latency.p97_5).toBeLessThan(300);
  });

  it("POST /reverse-search — p97.5 < 500 ms", async () => {
    const result = await runLoad({
      url: `${baseUrl}/reverse-search`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        desired_monthly: 500,
        down_payment: 0,
        term_months: 36,
        transaction_type: "lease",
      }),
      connections: CONNECTIONS,
      duration: DURATION_S,
    });

    printSummary("POST /reverse-search", result);

    expect(result.errors).toBe(0);
    expect(result.timeouts).toBe(0);
    expect(result.latency.p97_5).toBeLessThan(500);
  });
});
