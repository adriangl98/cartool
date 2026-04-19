import request from "supertest";
import { z } from "zod";
import { createApp } from "../src/app";
import { validateQuery } from "../src/middleware/validate";

// Prevent transitive import of db/redis from loading config.ts (which calls
// validateEnv) when the listings router is mounted inside createApp.
jest.mock("../src/db", () => ({ pool: { query: jest.fn() } }));
jest.mock("../src/redis", () => ({ redis: { get: jest.fn(), set: jest.fn() } }));

describe("F05.1 — API Bootstrap", () => {
  describe("GET /health", () => {
    const app = createApp({ nodeEnv: "test", corsAllowedOrigins: [], rateLimitMax: 100, financialEngineUrl: "http://localhost:9999" });

    it("returns 200 with status ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "ok", service: "api" });
    });
  });

  describe("Security headers (Helmet)", () => {
    const app = createApp({ nodeEnv: "test", corsAllowedOrigins: [], rateLimitMax: 100, financialEngineUrl: "http://localhost:9999" });

    it("includes X-Content-Type-Options: nosniff", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("includes X-Frame-Options: SAMEORIGIN or DENY", async () => {
      const res = await request(app).get("/health");
      // Helmet default is SAMEORIGIN; both values block cross-origin framing
      expect(res.headers["x-frame-options"]).toMatch(/SAMEORIGIN|DENY/i);
    });

    it("includes Strict-Transport-Security header", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["strict-transport-security"]).toBeDefined();
    });
  });

  describe("Rate limiting", () => {
    // Fresh app with rateLimitMax=3 so only 3 requests are allowed before 429
    const app = createApp({ nodeEnv: "test", corsAllowedOrigins: [], rateLimitMax: 3, financialEngineUrl: "http://localhost:9999" });

    it("returns 429 after exceeding the rate limit", async () => {
      // Make 3 allowed requests
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
      }
      // 4th request must be rate-limited
      const blocked = await request(app).get("/health");
      expect(blocked.status).toBe(429);
    });
  });

  describe("validateQuery middleware", () => {
    const app = createApp({ nodeEnv: "test", corsAllowedOrigins: [], rateLimitMax: 100, financialEngineUrl: "http://localhost:9999" });

    // Mount a test route that uses validateQuery to prove validation fires before handlers
    const pageSchema = z.object({ page: z.coerce.number().int().min(1) });
    app.get("/test-validate", validateQuery(pageSchema), (_req, res) => {
      res.json({ ok: true });
    });

    it("passes through with a valid query parameter", async () => {
      const res = await request(app).get("/test-validate?page=2");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("returns 400 with structured error body for invalid query parameter", async () => {
      const res = await request(app).get("/test-validate?page=abc");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "Invalid query parameters",
        details: expect.arrayContaining([
          expect.objectContaining({ field: "page" }),
        ]),
      });
    });

    it("returns 400 for missing required query parameter", async () => {
      const res = await request(app).get("/test-validate");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid query parameters");
    });
  });
});
