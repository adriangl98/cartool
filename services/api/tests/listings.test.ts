import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/db";
import { redis } from "../src/redis";

// Mock DB and Redis so tests never open real connections and config.ts env
// validation never fires from these modules.
jest.mock("../src/db", () => ({
  pool: { query: jest.fn() },
}));
jest.mock("../src/redis", () => ({
  redis: { get: jest.fn(), set: jest.fn() },
}));

const mockPoolQuery = pool.query as jest.Mock;
const mockRedisGet = redis.get as jest.Mock;
const mockRedisSet = redis.set as jest.Mock;

// Reusable app instance — rate-limited high so tests are not throttled.
const app = createApp({
  nodeEnv: "test",
  corsAllowedOrigins: [],
  rateLimitMax: 1000,
  financialEngineUrl: "http://localhost:9999",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeListingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
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
    scraped_at: "2026-04-16T08:00:00.000Z",
    dealer_id: "bbbbbbbb-0000-4000-8000-000000000001",
    dealer_name: "Sames Laredo Nissan",
    dealer_group: "Sames Auto Group",
    addons: [],
    ...overrides,
  };
}

/** Set up mocks for a successful DB round-trip returning `rows` as the data. */
function setupDbMock(rows: ReturnType<typeof makeListingRow>[], total = rows.length) {
  mockRedisGet.mockResolvedValue(null); // Cache miss
  mockRedisSet.mockResolvedValue("OK");
  mockPoolQuery
    .mockResolvedValueOnce({ rows: [{ total: String(total) }] }) // COUNT
    .mockResolvedValueOnce({ rows }); // DATA
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── F05.2 Integration Tests ───────────────────────────────────────────────────

describe("F05.2 — GET /listings", () => {
  // ── No filters ──────────────────────────────────────────────────────────────

  describe("empty filter set returns all listings (paginated)", () => {
    it("returns 200 with paginated data and correct shape", async () => {
      const rows = [makeListingRow(), makeListingRow({ id: "aaaaaaaa-0000-4000-8000-000000000002", make: "Toyota" })];
      setupDbMock(rows, 2);

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        pagination: { page: 1, per_page: 20, total: 2 },
      });
      expect(res.body.data).toHaveLength(2);
    });

    it("applies default page=1 and per_page=20", async () => {
      setupDbMock([makeListingRow()]);

      await request(app).get("/listings");

      // The COUNT query is first; the DATA query has LIMIT/OFFSET appended.
      const dataCall = mockPoolQuery.mock.calls[1][0];
      expect(dataCall.values).toContain(20); // per_page
      expect(dataCall.values).toContain(0);  // offset = (1 - 1) * 20
    });
  });

  // ── Response shape ───────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("includes all required fields including equivalent_apr and deal_quality", async () => {
      setupDbMock([makeListingRow()]);

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      const listing = res.body.data[0];
      expect(listing).toMatchObject({
        id: expect.any(String),
        vin: "1N4BL4BV5NN123456",
        year: 2026,
        make: "Nissan",
        model: "Rogue",
        transaction_type: "lease",
        effective_monthly: 489.22,
        tcol: 17611.92,
        money_factor: 0.00175,
        equivalent_apr: 4.2, // 0.00175 * 2400
        deal_score: 74,
        deal_quality: "Competitive Deal",
        dealer: {
          id: expect.any(String),
          name: "Sames Laredo Nissan",
          group: "Sames Auto Group",
        },
        addons: [],
        scraped_at: expect.any(String),
      });
    });

    it("sets deal_quality to 'Excellent Deal' for deal_score >= 85", async () => {
      setupDbMock([makeListingRow({ deal_score: 92 })]);

      const res = await request(app).get("/listings");
      expect(res.body.data[0].deal_quality).toBe("Excellent Deal");
    });

    it("sets deal_quality to 'Average Deal' for deal_score between 50 and 69", async () => {
      setupDbMock([makeListingRow({ deal_score: 60 })]);

      const res = await request(app).get("/listings");
      expect(res.body.data[0].deal_quality).toBe("Average Deal");
    });

    it("sets deal_quality to 'Sub-Optimal Deal' for deal_score < 50", async () => {
      setupDbMock([makeListingRow({ deal_score: 30 })]);

      const res = await request(app).get("/listings");
      expect(res.body.data[0].deal_quality).toBe("Sub-Optimal Deal");
    });
  });

  // ── Filter: make ────────────────────────────────────────────────────────────

  describe("filter by make=Nissan", () => {
    it("returns only Nissan listings", async () => {
      const rows = [makeListingRow({ make: "Nissan" })];
      setupDbMock(rows);

      const res = await request(app).get("/listings?make=Nissan");

      expect(res.status).toBe(200);
      res.body.data.forEach((l: { make: string }) => {
        expect(l.make).toBe("Nissan");
      });
    });

    it("passes make as an array to the parameterized query", async () => {
      setupDbMock([makeListingRow()]);

      await request(app).get("/listings?make=Nissan");

      const countCall = mockPoolQuery.mock.calls[0][0];
      // First value in the WHERE clause must be the makes array
      expect(countCall.values[0]).toEqual(["Nissan"]);
    });

    it("supports comma-separated makes", async () => {
      setupDbMock([makeListingRow(), makeListingRow({ make: "Toyota" })]);

      await request(app).get("/listings?make=Nissan,Toyota");

      const countCall = mockPoolQuery.mock.calls[0][0];
      expect(countCall.values[0]).toEqual(["Nissan", "Toyota"]);
    });
  });

  // ── Filter: min_deal_score ──────────────────────────────────────────────────

  describe("filter by min_deal_score=70", () => {
    it("returns only listings with deal_score >= 70", async () => {
      const rows = [makeListingRow({ deal_score: 74 }), makeListingRow({ deal_score: 88 })];
      setupDbMock(rows);

      const res = await request(app).get("/listings?min_deal_score=70");

      expect(res.status).toBe(200);
      res.body.data.forEach((l: { deal_score: number }) => {
        expect(l.deal_score).toBeGreaterThanOrEqual(70);
      });
    });

    it("passes min_deal_score as a parameter to the DB query", async () => {
      setupDbMock([makeListingRow({ deal_score: 74 })]);

      await request(app).get("/listings?min_deal_score=70");

      const countCall = mockPoolQuery.mock.calls[0][0];
      expect(countCall.values).toContain(70);
    });
  });

  // ── Pagination cap ──────────────────────────────────────────────────────────

  describe("per_page validation", () => {
    it("per_page=50 is allowed (maximum)", async () => {
      setupDbMock([makeListingRow()]);

      const res = await request(app).get("/listings?per_page=50");
      expect(res.status).toBe(200);
    });

    it("per_page=51 returns 400 Bad Request", async () => {
      const res = await request(app).get("/listings?per_page=51");

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "Invalid query parameters",
        details: expect.arrayContaining([
          expect.objectContaining({ field: "per_page" }),
        ]),
      });
      // Must NEVER reach the database
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });
  });

  // ── SQL injection prevention ────────────────────────────────────────────────

  describe("SQL injection prevention", () => {
    it("returns 400 for injection string in make — never reaches DB", async () => {
      const res = await request(app).get(
        "/listings?make=%27%3B%20DROP%20TABLE%20listings%3B%20--",
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "Invalid query parameters" });
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });
  });

  // ── Redis cache ──────────────────────────────────────────────────────────────

  describe("Redis cache", () => {
    it("returns cached response without hitting DB on cache hit", async () => {
      const cachedResponse = {
        data: [makeListingRow()],
        pagination: { page: 1, per_page: 20, total: 1 },
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(cachedResponse));

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it("writes result to Redis with EX 3600 after cache miss", async () => {
      setupDbMock([makeListingRow()]);

      await request(app).get("/listings");

      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^listings:/),
        expect.any(String),
        "EX",
        3600,
      );
    });
  });

  // ── Input validation — other params ─────────────────────────────────────────

  describe("query parameter validation", () => {
    it("returns 400 for invalid transaction_type", async () => {
      const res = await request(app).get("/listings?transaction_type=cash");
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid dealer_id (not a UUID)", async () => {
      const res = await request(app).get("/listings?dealer_id=not-a-uuid");
      expect(res.status).toBe(400);
    });

    it("returns 400 for negative max_effective_monthly", async () => {
      const res = await request(app).get("/listings?max_effective_monthly=-1");
      expect(res.status).toBe(400);
    });

    it("returns 400 for page=0", async () => {
      const res = await request(app).get("/listings?page=0");
      expect(res.status).toBe(400);
    });
  });
});

// ── F05.4 Integration Tests ───────────────────────────────────────────────────

function makeDisclosureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    vin: "1N4BL4BV5NN123456",
    year: 2026,
    make: "Nissan",
    model: "Rogue",
    trim: "SV AWD",
    transaction_type: "lease",
    raw_fine_print_text: "Offer valid through 04/30/2026. Tax, title, and license extra.",
    tax_credit_flag: false,
    gap_insurance_detected: false,
    deal_score: 74,
    obbba_eligible: true,
    dealer_listing_url: "https://samesnissan.com",
    addons: [],
    ...overrides,
  };
}

/** Set up pool mock for a single-row disclosure query result. */
function setupDisclosureDbMock(row: ReturnType<typeof makeDisclosureRow> | null) {
  mockPoolQuery.mockResolvedValueOnce({
    rows: row ? [row] : [],
  });
}

describe("F05.4 — GET /listings/:id/disclosure", () => {
  const VALID_ID = "aaaaaaaa-0000-4000-8000-000000000001";
  const NONEXISTENT_ID = "cccccccc-0000-4000-8000-000000000099";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── UUID validation ──────────────────────────────────────────────────────────

  describe("UUID validation", () => {
    it("returns 400 for a non-UUID :id — never reaches DB", async () => {
      const res = await request(app).get("/listings/not-a-uuid/disclosure");

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining("UUID") });
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it("returns 400 for a numeric :id — never reaches DB", async () => {
      const res = await request(app).get("/listings/12345/disclosure");

      expect(res.status).toBe(400);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });
  });

  // ── 404 for nonexistent listing ──────────────────────────────────────────────

  describe("not found", () => {
    it("returns 404 when listing does not exist", async () => {
      setupDisclosureDbMock(null);

      const res = await request(app).get(`/listings/${NONEXISTENT_ID}/disclosure`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "Listing not found" });
    });
  });

  // ── Successful response ─────────────────────────────────────────────────────

  describe("successful disclosure response", () => {
    it("returns 200 with correct shape for a basic listing", async () => {
      setupDisclosureDbMock(makeDisclosureRow());

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: VALID_ID,
        vin: "1N4BL4BV5NN123456",
        year: 2026,
        make: "Nissan",
        model: "Rogue",
        transaction_type: "lease",
        raw_fine_print_text: expect.any(String),
        tax_credit_flag: false,
        dealer_listing_url: "https://samesnissan.com",
        addons: [],
      });
    });

    it("uses the listing ID as a parameterized query value", async () => {
      setupDisclosureDbMock(makeDisclosureRow());

      await request(app).get(`/listings/${VALID_ID}/disclosure`);

      const queryCall = mockPoolQuery.mock.calls[0][0];
      expect(queryCall.values).toEqual([VALID_ID]);
    });

    it("returns addons array with name, estimated_cost, is_mandatory", async () => {
      const row = makeDisclosureRow({
        addons: [
          { name: "Window Tint", estimated_cost: "599.00", is_mandatory: true },
          { name: "Nitrogen Fill", estimated_cost: "249.00", is_mandatory: true },
        ],
      });
      setupDisclosureDbMock(row);

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.status).toBe(200);
      expect(res.body.addons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Window Tint", estimated_cost: "599.00", is_mandatory: true }),
          expect.objectContaining({ name: "Nitrogen Fill", estimated_cost: "249.00", is_mandatory: true }),
        ]),
      );
    });
  });

  // ── Tax credit flag ──────────────────────────────────────────────────────────

  describe("tax credit flag", () => {
    it("includes tax_credit_message when tax_credit_flag = true", async () => {
      setupDisclosureDbMock(makeDisclosureRow({ tax_credit_flag: true }));

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.status).toBe(200);
      expect(res.body.tax_credit_flag).toBe(true);
      expect(res.body.tax_credit_message).toMatch(/Lender Tax Credit Detected/);
    });

    it("omits tax_credit_message when tax_credit_flag = false", async () => {
      setupDisclosureDbMock(makeDisclosureRow({ tax_credit_flag: false }));

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("tax_credit_message");
    });
  });

  // ── dealer_listing_url ───────────────────────────────────────────────────────

  describe("dealer_listing_url", () => {
    it("includes dealer_listing_url from the dealers table", async () => {
      setupDisclosureDbMock(makeDisclosureRow({ dealer_listing_url: "https://samesnissan.com" }));

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.body.dealer_listing_url).toBe("https://samesnissan.com");
    });

    it("returns null dealer_listing_url when dealer has no base_url", async () => {
      setupDisclosureDbMock(makeDisclosureRow({ dealer_listing_url: null }));

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.body.dealer_listing_url).toBeNull();
    });
  });
});

// ── F05.5 Integration Tests ───────────────────────────────────────────────────

// Mock global fetch for Financial Engine calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

/** Build a mock Financial Engine ObbbaResponse for an eligible listing. */
function makeObbbaFeResponse(overrides: Record<string, unknown> = {}) {
  return {
    vehicle: "2026 Ford F-150 XLT",
    assembly_country: "US",
    assembly_plant: "Dearborn, MI",
    obbba_eligible: true,
    estimated_annual_interest: "3240.00",
    estimated_annual_deduction: "3240.00",
    tax_bracket_options: [
      { bracket: "22%", annual_savings: "712.80", monthly_savings: "59.40" },
      { bracket: "24%", annual_savings: "777.60", monthly_savings: "64.80" },
      { bracket: "32%", annual_savings: "1036.80", monthly_savings: "86.40" },
      { bracket: "35%", annual_savings: "1134.00", monthly_savings: "94.50" },
    ],
    ...overrides,
  };
}

/** Set up pool mock for a single-row OBBBA eligibility query. */
function setupObbbaDbMock(
  row: { transaction_type: string; obbba_eligible: boolean } | null,
) {
  mockPoolQuery.mockResolvedValueOnce({
    rows: row ? [row] : [],
  });
}

describe("F05.5 — GET /listings/:id/obbba", () => {
  const VALID_ID = "aaaaaaaa-0000-4000-8000-000000000001";
  const NONEXISTENT_ID = "cccccccc-0000-4000-8000-000000000099";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── UUID validation ──────────────────────────────────────────────────────────

  describe("UUID validation", () => {
    it("returns 400 for a non-UUID :id — never reaches DB", async () => {
      const res = await request(app).get("/listings/not-a-uuid/obbba");

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining("UUID") });
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it("returns 400 for a numeric :id — never reaches DB", async () => {
      const res = await request(app).get("/listings/12345/obbba");

      expect(res.status).toBe(400);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });
  });

  // ── 404 for nonexistent listing ──────────────────────────────────────────────

  describe("not found", () => {
    it("returns 404 when listing does not exist", async () => {
      setupObbbaDbMock(null);

      const res = await request(app).get(`/listings/${NONEXISTENT_ID}/obbba`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "Listing not found" });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Eligibility checks ───────────────────────────────────────────────────────

  describe("lease listing returns 400 with descriptor message", () => {
    it("returns 400 with OBBBA finance-only message for lease transaction", async () => {
      setupObbbaDbMock({ transaction_type: "lease", obbba_eligible: true });

      const res = await request(app).get(`/listings/${VALID_ID}/obbba`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "OBBBA deduction only applies to finance transactions",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns 400 with OBBBA finance-only message for balloon transaction", async () => {
      setupObbbaDbMock({ transaction_type: "balloon", obbba_eligible: true });

      const res = await request(app).get(`/listings/${VALID_ID}/obbba`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "OBBBA deduction only applies to finance transactions",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("foreign-assembled listing returns 400 with descriptor message", () => {
    it("returns 400 with foreign-assembly message when obbba_eligible = false", async () => {
      setupObbbaDbMock({ transaction_type: "finance", obbba_eligible: false });

      const res = await request(app).get(`/listings/${VALID_ID}/obbba`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "Vehicle is not OBBBA-eligible (foreign assembly)",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Eligible finance listing ─────────────────────────────────────────────────

  describe("eligible finance listing returns all 4 bracket rows with non-zero savings", () => {
    it("returns 200 with all 4 tax bracket options", async () => {
      setupObbbaDbMock({ transaction_type: "finance", obbba_eligible: true });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(makeObbbaFeResponse()),
      });

      const res = await request(app).get(`/listings/${VALID_ID}/obbba`);

      expect(res.status).toBe(200);
      expect(res.body.obbba_eligible).toBe(true);
      expect(res.body.tax_bracket_options).toHaveLength(4);
      // All brackets must have non-zero savings
      res.body.tax_bracket_options.forEach(
        (opt: { bracket: string; annual_savings: string; monthly_savings: string }) => {
          expect(parseFloat(opt.annual_savings)).toBeGreaterThan(0);
          expect(parseFloat(opt.monthly_savings)).toBeGreaterThan(0);
        },
      );
    });

    it("calls Financial Engine /obbba/{id} with the correct listing ID", async () => {
      setupObbbaDbMock({ transaction_type: "finance", obbba_eligible: true });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(makeObbbaFeResponse()),
      });

      await request(app).get(`/listings/${VALID_ID}/obbba`);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/obbba/${VALID_ID}`),
      );
    });

    it("includes vehicle, assembly_country, and estimated_annual_deduction in response", async () => {
      setupObbbaDbMock({ transaction_type: "finance", obbba_eligible: true });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(makeObbbaFeResponse()),
      });

      const res = await request(app).get(`/listings/${VALID_ID}/obbba`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        vehicle: expect.any(String),
        assembly_country: "US",
        estimated_annual_deduction: expect.any(String),
      });
    });
  });

  // ── Financial Engine unavailability ─────────────────────────────────────────

  describe("Financial Engine unavailable", () => {
    it("returns 503 when Financial Engine is down (network error)", async () => {
      setupObbbaDbMock({ transaction_type: "finance", obbba_eligible: true });
      mockFetch.mockRejectedValueOnce(new Error("connection refused"));

      const res = await request(app).get(`/listings/${VALID_ID}/obbba`);

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: expect.stringContaining("Financial Engine unavailable") });
    });

    it("returns 503 when Financial Engine returns a non-OK response", async () => {
      setupObbbaDbMock({ transaction_type: "finance", obbba_eligible: true });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const res = await request(app).get(`/listings/${VALID_ID}/obbba`);

      expect(res.status).toBe(503);
    });
  });
});

// ── F05.8 Integration Tests ───────────────────────────────────────────────────

describe("F05.8 — Balloon Finance Warning Middleware", () => {
  const VALID_ID = "aaaaaaaa-0000-4000-8000-000000000001";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /listings — balloon warning ─────────────────────────────────────────

  describe("GET /listings — balloon warning", () => {
    it("adds warnings array for balloon listing with gap_insurance_detected = false", async () => {
      setupDbMock([
        makeListingRow({ transaction_type: "balloon", gap_insurance_detected: false }),
      ]);

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(res.body.data[0].warnings).toEqual([
        "GAP insurance not detected in this balloon finance contract. Consider adding before signing.",
      ]);
    });

    it("omits warnings for balloon listing with gap_insurance_detected = true", async () => {
      setupDbMock([
        makeListingRow({ transaction_type: "balloon", gap_insurance_detected: true }),
      ]);

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(res.body.data[0]).not.toHaveProperty("warnings");
    });

    it("omits warnings for a non-balloon (lease) listing", async () => {
      setupDbMock([
        makeListingRow({ transaction_type: "lease", gap_insurance_detected: false }),
      ]);

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(res.body.data[0]).not.toHaveProperty("warnings");
    });

    it("omits warnings for a non-balloon (finance) listing", async () => {
      setupDbMock([
        makeListingRow({ transaction_type: "finance", gap_insurance_detected: false }),
      ]);

      const res = await request(app).get("/listings");

      expect(res.status).toBe(200);
      expect(res.body.data[0]).not.toHaveProperty("warnings");
    });
  });

  // ── GET /listings/:id/disclosure — balloon warning ───────────────────────────

  describe("GET /listings/:id/disclosure — balloon warning", () => {
    it("adds warnings array for balloon listing with gap_insurance_detected = false", async () => {
      setupDisclosureDbMock(
        makeDisclosureRow({ transaction_type: "balloon", gap_insurance_detected: false }),
      );

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.status).toBe(200);
      expect(res.body.warnings).toEqual([
        "GAP insurance not detected in this balloon finance contract. Consider adding before signing.",
      ]);
    });

    it("omits warnings for balloon listing with gap_insurance_detected = true", async () => {
      setupDisclosureDbMock(
        makeDisclosureRow({ transaction_type: "balloon", gap_insurance_detected: true }),
      );

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("warnings");
    });

    it("omits warnings for a non-balloon (lease) listing", async () => {
      setupDisclosureDbMock(
        makeDisclosureRow({ transaction_type: "lease", gap_insurance_detected: false }),
      );

      const res = await request(app).get(`/listings/${VALID_ID}/disclosure`);

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("warnings");
    });
  });
});
