import { importBuyRates } from "../../src/orchestrator/BuyRatesImporter";
import type { Pool } from "pg";

// ── CSV fixtures ──────────────────────────────────────────────────────────

const HEADER =
  "make,model,trim,year,month_year,base_mf,residual_24,residual_36,residual_48";
const ROW_NISSAN = "Nissan,Altima,SV,2026,2026-04-01,0.000940,64.00,58.00,52.00";
const ROW_TOYOTA = "Toyota,Camry,LE,2026,2026-04-01,0.000010,58.00,52.00,47.00";
const ROW_BLANK_TRIM = "RAM,ProMaster,,2026,2026-04-01,0.002500,50.00,45.00,40.00";
const ROW_MISSING_MF = "Ford,Escape,SE,2026,2026-04-01,,60.00,55.00,50.00";
const ROW_WRONG_COLS = "Nissan,Altima,SV,2026,2026-04-01,0.000940,64.00";

// ── Mock pool factory ─────────────────────────────────────────────────────

function makeMockPool() {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockRelease = jest.fn();
  const mockClient = { query: mockQuery, release: mockRelease };
  const mockConnect = jest.fn().mockResolvedValue(mockClient);
  const pool = { connect: mockConnect } as unknown as Pool;
  return { pool, mockConnect, mockClient, mockQuery, mockRelease };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("importBuyRates", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it("upserts all valid rows and returns the count", async () => {
    const csv = [HEADER, ROW_NISSAN, ROW_TOYOTA].join("\n");
    const { pool, mockConnect, mockQuery, mockRelease } = makeMockPool();

    const result = await importBuyRates(csv, pool);

    expect(result).toBe(2);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    // BEGIN + 2 data upserts + COMMIT
    expect(mockQuery).toHaveBeenCalledTimes(4);
    expect(mockQuery.mock.calls[0]![0]).toBe("BEGIN");
    expect(mockQuery.mock.calls[3]![0]).toBe("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("passes the correct parameterized values to the upsert", async () => {
    const csv = [HEADER, ROW_NISSAN].join("\n");
    const { pool, mockQuery } = makeMockPool();

    await importBuyRates(csv, pool);

    // call[0] = BEGIN, call[1] = upsert, call[2] = COMMIT
    const upsertParams = mockQuery.mock.calls[1]![1] as string[];
    expect(upsertParams).toEqual([
      "Nissan",    // $1 make
      "Altima",    // $2 model
      "SV",        // $3 trim
      "2026",      // $4 year
      "2026-04-01", // $5 month_year
      "0.000940",  // $6 base_mf
      "64.00",     // $7 residual_24
      "58.00",     // $8 residual_36
      "52.00",     // $9 residual_48
    ]);
  });

  // ── Trim handling ───────────────────────────────────────────────────────

  it("stores blank trim as '' (empty string, not null)", async () => {
    const csv = [HEADER, ROW_BLANK_TRIM].join("\n");
    const { pool, mockQuery } = makeMockPool();

    await importBuyRates(csv, pool);

    const trim = (mockQuery.mock.calls[1]![1] as unknown[])[2];
    expect(trim).toBe("");
    expect(trim).not.toBeNull();
  });

  // ── Null residuals ──────────────────────────────────────────────────────

  it("converts empty residual fields to null", async () => {
    const ROW_NULL_RESIDUALS = "Nissan,Altima,SV,2026,2026-04-01,0.000940,,,";
    const csv = [HEADER, ROW_NULL_RESIDUALS].join("\n");
    const { pool, mockQuery } = makeMockPool();

    await importBuyRates(csv, pool);

    const params = mockQuery.mock.calls[1]![1] as unknown[];
    expect(params[6]).toBeNull(); // residual_24 ($7)
    expect(params[7]).toBeNull(); // residual_36 ($8)
    expect(params[8]).toBeNull(); // residual_48 ($9)
  });

  // ── Empty / header-only CSV ─────────────────────────────────────────────

  it("returns 0 without connecting to the pool for a header-only CSV", async () => {
    const { pool, mockConnect } = makeMockPool();

    const result = await importBuyRates(HEADER, pool);

    expect(result).toBe(0);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns 0 without connecting to the pool for an empty string", async () => {
    const { pool, mockConnect } = makeMockPool();

    const result = await importBuyRates("", pool);

    expect(result).toBe(0);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── Malformed rows ──────────────────────────────────────────────────────

  it("skips a row with a missing base_mf and logs a warn-level message", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const csv = [HEADER, ROW_MISSING_MF].join("\n");
    const { pool, mockConnect } = makeMockPool();

    const result = await importBuyRates(csv, pool);

    expect(result).toBe(0);
    expect(mockConnect).not.toHaveBeenCalled();
    const warnCall = logSpy.mock.calls.find((c) => {
      try {
        return JSON.parse(c[0] as string).level === "warn";
      } catch {
        return false;
      }
    });
    expect(warnCall).toBeDefined();
  });

  it("skips a row with wrong column count and logs a warn-level message", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const csv = [HEADER, ROW_WRONG_COLS].join("\n");
    const { pool, mockConnect } = makeMockPool();

    const result = await importBuyRates(csv, pool);

    expect(result).toBe(0);
    expect(mockConnect).not.toHaveBeenCalled();
    const warnCall = logSpy.mock.calls.find((c) => {
      try {
        return JSON.parse(c[0] as string).level === "warn";
      } catch {
        return false;
      }
    });
    expect(warnCall).toBeDefined();
  });

  it("processes valid rows even when a malformed row is present", async () => {
    const csv = [HEADER, ROW_NISSAN, ROW_MISSING_MF, ROW_TOYOTA].join("\n");
    const { pool } = makeMockPool();

    const result = await importBuyRates(csv, pool);

    expect(result).toBe(2); // 2 valid rows, 1 skipped
  });

  // ── Missing header columns ──────────────────────────────────────────────

  it("throws when a required CSV header column is missing", async () => {
    // no 'trim' column
    const badHeader =
      "make,model,year,month_year,base_mf,residual_24,residual_36,residual_48";
    const csv = [badHeader, "Nissan,Altima,2026,2026-04-01,0.000940,64.00,58.00,52.00"].join("\n");
    const { pool } = makeMockPool();

    await expect(importBuyRates(csv, pool)).rejects.toThrow("missing required columns");
  });

  // ── Error handling ──────────────────────────────────────────────────────

  it("rolls back the transaction and rethrows on a database error", async () => {
    const csv = [HEADER, ROW_NISSAN].join("\n");
    const mockQuery = jest
      .fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error("DB connection lost")); // upsert
    const mockRelease = jest.fn();
    const pool = {
      connect: jest.fn().mockResolvedValue({ query: mockQuery, release: mockRelease }),
    } as unknown as Pool;

    await expect(importBuyRates(csv, pool)).rejects.toThrow("DB connection lost");

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  // ── Success log ─────────────────────────────────────────────────────────

  it("emits a structured info log with rowsUpserted and source on success", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const csv = [HEADER, ROW_NISSAN].join("\n");
    const { pool } = makeMockPool();

    await importBuyRates(csv, pool);

    const infoCall = logSpy.mock.calls.find((c) => {
      try {
        const p = JSON.parse(c[0] as string);
        return p.level === "info" && p.event === "buy-rates-refreshed";
      } catch {
        return false;
      }
    });
    expect(infoCall).toBeDefined();
    const logArg = JSON.parse(infoCall![0] as string);
    expect(logArg.rowsUpserted).toBe(1);
    expect(logArg.source).toBe("csv");
  });

  // ── Idempotency ─────────────────────────────────────────────────────────

  it("is idempotent — a second call with the same data does not error", async () => {
    const csv = [HEADER, ROW_NISSAN].join("\n");
    const { pool } = makeMockPool();

    // Both calls use the same mock pool which always resolves — simulating upsert behavior
    const r1 = await importBuyRates(csv, pool);
    const r2 = await importBuyRates(csv, pool);

    expect(r1).toBe(1);
    expect(r2).toBe(1);
  });
});
