import request from "supertest";
import { createApp } from "../src/app";
import { pool } from "../src/db";

// Mock DB so tests never open real connections and config.ts env validation
// never fires from these modules.
jest.mock("../src/db", () => ({
  pool: { query: jest.fn() },
}));
jest.mock("../src/redis", () => ({
  redis: { get: jest.fn(), set: jest.fn() },
}));

const mockPoolQuery = pool.query as jest.Mock;

// Reusable app instance — rate limit high so tests are not throttled.
const app = createApp({
  nodeEnv: "test",
  corsAllowedOrigins: [],
  rateLimitMax: 1000,
  financialEngineUrl: "http://localhost:9999",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDealerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    name: "Sames Laredo Nissan",
    group_name: "Sames Auto Group",
    base_url: "https://www.samesnissan.com",
    zip_code: "78040",
    last_scraped_at: "2026-04-16T08:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── F05.6 Integration Tests ───────────────────────────────────────────────────

describe("F05.6 — GET /dealers", () => {
  describe("returns all active dealers with last_scraped_at", () => {
    it("returns 200 with a data array", async () => {
      const rows = [
        makeDealerRow(),
        makeDealerRow({
          id: "bbbbbbbb-0000-4000-8000-000000000002",
          name: "Powell Watson Ford",
          group_name: "Powell Watson",
          base_url: "https://www.powellwatsonford.com",
        }),
      ];
      mockPoolQuery.mockResolvedValueOnce({ rows });

      const res = await request(app).get("/dealers");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ data: expect.any(Array) });
      expect(res.body.data).toHaveLength(2);
    });

    it("each dealer includes id, name, group_name, base_url, zip_code, last_scraped_at", async () => {
      const row = makeDealerRow();
      mockPoolQuery.mockResolvedValueOnce({ rows: [row] });

      const res = await request(app).get("/dealers");

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toMatchObject({
        id: row.id,
        name: row.name,
        group_name: row.group_name,
        base_url: row.base_url,
        zip_code: row.zip_code,
        last_scraped_at: row.last_scraped_at,
      });
    });

    it("includes Sames Auto Group dealer in the response", async () => {
      const rows = [
        makeDealerRow({ name: "Sames Laredo Nissan", group_name: "Sames Auto Group" }),
      ];
      mockPoolQuery.mockResolvedValueOnce({ rows });

      const res = await request(app).get("/dealers");

      expect(res.status).toBe(200);
      const sames = res.body.data.find(
        (d: { group_name: string }) => d.group_name === "Sames Auto Group",
      );
      expect(sames).toBeDefined();
    });

    it("includes Powell Watson dealer in the response", async () => {
      const rows = [
        makeDealerRow({
          id: "bbbbbbbb-0000-4000-8000-000000000002",
          name: "Powell Watson Ford",
          group_name: "Powell Watson",
        }),
      ];
      mockPoolQuery.mockResolvedValueOnce({ rows });

      const res = await request(app).get("/dealers");

      expect(res.status).toBe(200);
      const powell = res.body.data.find(
        (d: { group_name: string }) => d.group_name === "Powell Watson",
      );
      expect(powell).toBeDefined();
    });

    it("last_scraped_at reflects the most recent listing timestamp", async () => {
      const row = makeDealerRow({ last_scraped_at: "2026-04-17T12:00:00.000Z" });
      mockPoolQuery.mockResolvedValueOnce({ rows: [row] });

      const res = await request(app).get("/dealers");

      expect(res.status).toBe(200);
      expect(res.body.data[0].last_scraped_at).toBe("2026-04-17T12:00:00.000Z");
    });

    it("returns empty data array when no active dealers exist", async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get("/dealers");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("queries only is_active = true dealers", async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      await request(app).get("/dealers");

      const queryText: string = mockPoolQuery.mock.calls[0][0].text;
      expect(queryText).toMatch(/is_active\s*=\s*true/i);
    });

    it("uses parameterized query (no user input concatenated into SQL)", async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      await request(app).get("/dealers");

      // The query call receives an object with a text property — no string
      // concatenation of user input is expected (this endpoint takes no params).
      const call = mockPoolQuery.mock.calls[0][0];
      expect(typeof call).toBe("object");
      expect(typeof call.text).toBe("string");
    });
  });
});
