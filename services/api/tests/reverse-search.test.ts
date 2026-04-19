import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/db";

// Mock DB so tests never open real connections (config.ts env validation is
// never triggered because the route uses DI for financialEngineUrl).
jest.mock("../src/db", () => ({
  pool: { query: jest.fn() },
}));
jest.mock("../src/redis", () => ({
  redis: { get: jest.fn(), set: jest.fn() },
}));

const mockPoolQuery = pool.query as jest.Mock;

// Global fetch is mocked per-test to simulate the Financial Engine.
const mockFetch = jest.fn();
global.fetch = mockFetch;

const FINANCIAL_ENGINE_URL = "http://financial-engine-mock:8000";

// Reusable app instance.
const app = createApp({
  nodeEnv: "test",
  corsAllowedOrigins: [],
  rateLimitMax: 1000,
  financialEngineUrl: FINANCIAL_ENGINE_URL,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSolveResponse(maxSellingPrice = "35000.00", avgApr = "5.3") {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      max_selling_price: maxSellingPrice,
      desired_monthly: "550.00",
      down_payment: "2500.00",
      term_months: 36,
      avg_apr: avgApr,
    }),
  };
}

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

function setupDbMock(
  rows: ReturnType<typeof makeListingRow>[],
  total = rows.length,
) {
  mockPoolQuery
    .mockResolvedValueOnce({ rows: [{ total: String(total) }] }) // COUNT
    .mockResolvedValueOnce({ rows }); // DATA
}

const VALID_BODY = {
  desired_monthly: 550,
  down_payment: 2500,
  term_months: 36,
  transaction_type: "lease",
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── F05.3 Integration Tests ───────────────────────────────────────────────────

describe("F05.3 — POST /reverse-search", () => {
  // ── Valid request — happy path ─────────────────────────────────────────────

  describe("valid input returns listings with effective_monthly ≤ desired_monthly", () => {
    it("returns 200 with data and reverse_search_summary", async () => {
      mockFetch.mockResolvedValue(makeSolveResponse());
      setupDbMock([makeListingRow()]);

      const res = await request(app).post("/reverse-search").send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        reverse_search_summary: {
          max_selling_price: 35000,
          assumed_apr: 5.3,
          texas_tax_included: true,
        },
        data: expect.any(Array),
        pagination: { total: 1 },
      });
    });

    it("calls Financial Engine POST /solve with correct payload", async () => {
      mockFetch.mockResolvedValue(makeSolveResponse());
      setupDbMock([makeListingRow()]);

      await request(app).post("/reverse-search").send(VALID_BODY);

      expect(mockFetch).toHaveBeenCalledWith(
        `${FINANCIAL_ENGINE_URL}/solve`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            desired_monthly: 550,
            down_payment: 2500,
            term_months: 36,
          }),
        }),
      );
    });

    it("filters DB with effective_monthly ≤ desired_monthly", async () => {
      mockFetch.mockResolvedValue(makeSolveResponse());
      setupDbMock([makeListingRow()]);

      await request(app).post("/reverse-search").send(VALID_BODY);

      const countCall = mockPoolQuery.mock.calls[0][0];
      const sql: string = countCall.text;
      // Must include the effective_monthly filter
      expect(sql).toContain("l.effective_monthly <=");
      // The desired_monthly value (550) must appear in parameterized values
      expect(countCall.values).toContain(550);
    });

    it("all returned listings have effective_monthly ≤ desired_monthly", async () => {
      mockFetch.mockResolvedValue(makeSolveResponse());
      const rows = [
        makeListingRow({ effective_monthly: "489.22" }),
        makeListingRow({
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          effective_monthly: "540.00",
        }),
      ];
      setupDbMock(rows, 2);

      const res = await request(app).post("/reverse-search").send(VALID_BODY);

      expect(res.status).toBe(200);
      res.body.data.forEach((l: { effective_monthly: number }) => {
        expect(l.effective_monthly).toBeLessThanOrEqual(VALID_BODY.desired_monthly);
      });
    });

    it("response listing shape includes all required fields", async () => {
      mockFetch.mockResolvedValue(makeSolveResponse());
      setupDbMock([makeListingRow()]);

      const res = await request(app).post("/reverse-search").send(VALID_BODY);

      expect(res.status).toBe(200);
      const listing = res.body.data[0];
      expect(listing).toMatchObject({
        id: expect.any(String),
        vin: "1N4BL4BV5NN123456",
        transaction_type: "lease",
        effective_monthly: 489.22,
        money_factor: 0.00175,
        equivalent_apr: 4.2,
        deal_score: 74,
        deal_quality: "Competitive Deal",
        dealer: expect.objectContaining({ name: "Sames Laredo Nissan" }),
        addons: [],
      });
    });
  });

  // ── Optional filters ───────────────────────────────────────────────────────

  describe("preferred_makes filter", () => {
    it("passes preferred_makes as an ANY() array in the WHERE clause", async () => {
      mockFetch.mockResolvedValue(makeSolveResponse());
      setupDbMock([makeListingRow()]);

      await request(app)
        .post("/reverse-search")
        .send({ ...VALID_BODY, preferred_makes: ["Nissan", "Toyota"] });

      const countCall = mockPoolQuery.mock.calls[0][0];
      expect(countCall.text).toContain("l.make = ANY(");
      expect(countCall.values).toContainEqual(["Nissan", "Toyota"]);
    });
  });

  describe("obbba_only filter", () => {
    it("adds obbba_eligible = true condition when obbba_only=true", async () => {
      mockFetch.mockResolvedValue(makeSolveResponse());
      setupDbMock([makeListingRow()]);

      await request(app)
        .post("/reverse-search")
        .send({ ...VALID_BODY, obbba_only: true });

      const countCall = mockPoolQuery.mock.calls[0][0];
      expect(countCall.text).toContain("l.obbba_eligible =");
      expect(countCall.values).toContain(true);
    });
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("desired_monthly = 0 returns 400", () => {
    it("rejects desired_monthly of 0", async () => {
      const res = await request(app)
        .post("/reverse-search")
        .send({ ...VALID_BODY, desired_monthly: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request body");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("term_months = 37 returns 400", () => {
    it("rejects term_months not in {24, 36, 48, 60}", async () => {
      const res = await request(app)
        .post("/reverse-search")
        .send({ ...VALID_BODY, term_months: 37 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request body");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it("rejects negative desired_monthly", async () => {
    const res = await request(app)
      .post("/reverse-search")
      .send({ ...VALID_BODY, desired_monthly: -100 });

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects negative down_payment", async () => {
    const res = await request(app)
      .post("/reverse-search")
      .send({ ...VALID_BODY, down_payment: -500 });

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects invalid transaction_type", async () => {
    const res = await request(app)
      .post("/reverse-search")
      .send({ ...VALID_BODY, transaction_type: "rent" });

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects missing required fields", async () => {
    const res = await request(app).post("/reverse-search").send({});

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Financial Engine failure → 503 ────────────────────────────────────────

  describe("Financial Engine service down returns 503", () => {
    it("returns 503 when fetch throws (network error)", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const res = await request(app).post("/reverse-search").send(VALID_BODY);

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/unavailable/i);
    });

    it("returns 503 when Financial Engine responds with non-2xx", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn(),
      });

      const res = await request(app).post("/reverse-search").send(VALID_BODY);

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/unavailable/i);
    });
  });
});
