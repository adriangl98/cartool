import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { pool } from "../src/db";

// Mock DB and Redis so tests never open real connections and config.ts env
// validation never fires from these modules.
jest.mock("../src/db", () => ({
  pool: { query: jest.fn() },
}));
jest.mock("../src/redis", () => ({
  redis: { get: jest.fn(), set: jest.fn() },
}));

const mockPoolQuery = pool.query as jest.Mock;

const TEST_JWT_SECRET = "test-jwt-secret-f05-7";

// Reusable app instance with a known JWT secret and high rate limit.
const app = createApp({
  nodeEnv: "test",
  corsAllowedOrigins: [],
  rateLimitMax: 1000,
  financialEngineUrl: "http://localhost:9999",
  jwtSecret: TEST_JWT_SECRET,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToken(role: string): string {
  return jwt.sign({ sub: "user-1", role }, TEST_JWT_SECRET, { expiresIn: "1h" });
}

function makeBuyRateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cccccccc-0000-4000-8000-000000000001",
    make: "Nissan",
    model: "Sentra",
    trim: "S",
    year: 2026,
    month_year: "2026-04-01",
    base_mf: "0.00125",
    residual_24: "55.00",
    residual_36: "50.00",
    residual_48: "44.00",
    source: "leasehackr",
    created_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── F05.7 Integration Tests ───────────────────────────────────────────────────

describe("F05.7 — GET /buy-rates", () => {
  describe("Authentication — 401", () => {
    it("returns 401 with no Authorization header", async () => {
      const res = await request(app).get("/buy-rates");

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it("returns 401 with a malformed Authorization header (no Bearer prefix)", async () => {
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", "Token some-random-value");

      expect(res.status).toBe(401);
    });

    it("returns 401 with an invalid/tampered JWT", async () => {
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", "Bearer invalid.token.here");

      expect(res.status).toBe(401);
    });

    it("returns 401 with a JWT signed with the wrong secret", async () => {
      const badToken = jwt.sign({ sub: "user-1", role: "admin" }, "wrong-secret");
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", `Bearer ${badToken}`);

      expect(res.status).toBe(401);
    });
  });

  describe("Authorization — 403", () => {
    it("returns 403 when JWT has role: user", async () => {
      const token = makeToken("user");
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it("returns 403 when JWT has no role claim", async () => {
      const token = jwt.sign({ sub: "user-1" }, TEST_JWT_SECRET, { expiresIn: "1h" });
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it("returns 403 when JWT has role: moderator", async () => {
      const token = makeToken("moderator");
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe("Success — 200 (admin role)", () => {
    it("returns 200 with a data array for admin JWT", async () => {
      const rows = [makeBuyRateRow()];
      mockPoolQuery.mockResolvedValueOnce({ rows });

      const token = makeToken("admin");
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ data: expect.any(Array) });
      expect(res.body.data).toHaveLength(1);
    });

    it("each row includes expected fields from buy_rates table", async () => {
      const row = makeBuyRateRow();
      mockPoolQuery.mockResolvedValueOnce({ rows: [row] });

      const token = makeToken("admin");
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toMatchObject({
        id: row.id,
        make: row.make,
        model: row.model,
        trim: row.trim,
        year: row.year,
        month_year: row.month_year,
        base_mf: row.base_mf,
        residual_24: row.residual_24,
        residual_36: row.residual_36,
        residual_48: row.residual_48,
        source: row.source,
      });
    });

    it("queries buy_rates for current month using date_trunc", async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const token = makeToken("admin");
      await request(app)
        .get("/buy-rates")
        .set("Authorization", `Bearer ${token}`);

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      const queryArg = mockPoolQuery.mock.calls[0][0];
      expect(queryArg.text).toMatch(/date_trunc\('month',\s*NOW\(\)\)/i);
    });

    it("returns empty data array when no buy rates exist for current month", async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const token = makeToken("admin");
      const res = await request(app)
        .get("/buy-rates")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });
});
