// ---------------------------------------------------------------------------
// Mocks — declared before any import that touches them
// ---------------------------------------------------------------------------

jest.mock("@cartool/shared", () => ({
  QUEUE_NAMES: {
    SCRAPE: "scrape-jobs",
    ENRICHMENT: "enrichment-jobs",
    NOTIFICATION: "notification-jobs",
  },
}));

const mockWorkerOn = jest.fn();
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: mockWorkerOn,
    close: mockWorkerClose,
  })),
}));

import { processEnrichmentJob, VinEnrichmentWorker } from "../../src/enrichment/VinEnrichmentWorker";
import type { ProcessJobDeps } from "../../src/enrichment/VinEnrichmentWorker";
import type { EnrichmentJobPayload } from "../../src/types/EnrichmentJobPayload";
import type { RawListing } from "../../src/types/RawListing";
import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@cartool/shared";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE_LISTING: RawListing = {
  vin: "5TFDW5F15HX640000",
  year: 2024,
  make: "Toyota",
  model: "Tundra",
  trim: "SR5",
  msrp: 55_000,
  sellingPrice: 52_000,
  transactionType: "finance",
  rawFinePrintText: "",
  scrapedAt: new Date("2026-04-17T00:00:00Z"),
};

function makeJob(listing: RawListing = BASE_LISTING, dealerId = "dealer-1") {
  return {
    data: { dealerId, listing } as EnrichmentJobPayload,
    attemptsMade: 1,
  } as any;
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makePool(queryResults: Array<{ rows: unknown[] }> = [{ rows: [] }]) {
  const queryMock = jest.fn();
  queryResults.forEach((r) => queryMock.mockResolvedValueOnce(r));
  queryMock.mockResolvedValue({ rows: [] }); // safe default for extra calls

  const clientQueryMock = jest.fn().mockResolvedValue({ rows: [] });
  const releaseMock = jest.fn();

  const client = {
    query: clientQueryMock,
    release: releaseMock,
  };

  const connectMock = jest.fn().mockResolvedValue(client);

  return {
    pool: { query: queryMock, connect: connectMock } as any,
    clientQuery: clientQueryMock,
    release: releaseMock,
    poolQuery: queryMock,
  };
}

function makeNhtsa(result = {
  assemblyCountry: "US",
  assemblyPlant: "San Antonio, TX",
  obbbaEligible: true,
}) {
  return {
    decodeVin: jest.fn().mockResolvedValue(result),
  } as any;
}

function makeNormalizationService(listing: RawListing = BASE_LISTING) {
  return {
    normalize: jest.fn().mockReturnValue({
      ...listing,
      adjustedSellingPrice: listing.sellingPrice ?? listing.msrp,
      rebateDetected: false,
      detectedAddons: [],
      addonAdjustedPrice: listing.sellingPrice ?? listing.msrp,
      taxCreditFlag: false,
      texasTax: null,
      gapInsuranceDetected: null,
    }),
  } as any;
}

function makeDeps(overrides: Partial<ProcessJobDeps> = {}): ProcessJobDeps {
  const { pool } = makePool();
  return {
    pool,
    nhtsa: makeNhtsa(),
    normalizationService: makeNormalizationService(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — processEnrichmentJob
// ---------------------------------------------------------------------------

describe("processEnrichmentJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("normalizes the listing, calls NHTSA, inserts listing row, and emits success log", async () => {
    const normSvc = makeNormalizationService();
    const nhtsa = makeNhtsa();
    const { pool, clientQuery } = makePool([{ rows: [] }]); // dedup: no cached row

    // INSERT INTO listings RETURNING id
    clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [{ id: "listing-uuid-1" }] }); // INSERT listings
    clientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    await processEnrichmentJob(makeJob(), {
      pool,
      nhtsa,
      normalizationService: normSvc,
    });

    expect(normSvc.normalize).toHaveBeenCalledWith(BASE_LISTING);
    expect(nhtsa.decodeVin).toHaveBeenCalledWith(BASE_LISTING.vin);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO listings"),
      expect.any(Array),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("vin-enriched"),
    );
  });

  // ── VIN deduplication ─────────────────────────────────────────────────────

  it("skips the NHTSA API call when a cached assembly row exists for the VIN", async () => {
    const nhtsa = makeNhtsa();
    const { pool, clientQuery } = makePool([
      {
        rows: [
          {
            assembly_country: "US",
            assembly_plant: "San Antonio, TX",
            obbba_eligible: true,
          },
        ],
      },
    ]);
    clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [{ id: "listing-uuid-2" }] }); // INSERT
    clientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    await processEnrichmentJob(makeJob(), {
      pool,
      nhtsa,
      normalizationService: makeNormalizationService(),
    });

    expect(nhtsa.decodeVin).not.toHaveBeenCalled();
  });

  it("uses the cached assembly data when a matching dedup row is found", async () => {
    const nhtsa = makeNhtsa();
    const { pool, clientQuery } = makePool([
      {
        rows: [
          {
            assembly_country: "JP",
            assembly_plant: "Tahara",
            obbba_eligible: false,
          },
        ],
      },
    ]);

    let capturedInsertArgs: unknown[] = [];
    clientQuery.mockImplementation((sql: string, args?: unknown[]) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO listings")) {
        capturedInsertArgs = args ?? [];
        return Promise.resolve({ rows: [{ id: "listing-uuid-3" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await processEnrichmentJob(makeJob(), {
      pool,
      nhtsa,
      normalizationService: makeNormalizationService(),
    });

    // assembly_country ($18), assembly_plant ($19), obbba_eligible ($20)
    expect(capturedInsertArgs[17]).toBe("JP");
    expect(capturedInsertArgs[18]).toBe("Tahara");
    expect(capturedInsertArgs[19]).toBe(false);
  });

  // ── NHTSA retry + graceful failure ────────────────────────────────────────

  it("still inserts the listing with assemblyCountry=null when NHTSA fails 3 times", async () => {
    jest.useFakeTimers();

    const failingNhtsa = {
      decodeVin: jest.fn().mockRejectedValue(new Error("vPIC timeout")),
    } as any;

    const { pool, clientQuery } = makePool([{ rows: [] }]); // dedup miss
    let capturedInsertArgs: unknown[] = [];
    clientQuery.mockImplementation((sql: string, args?: unknown[]) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO listings")) {
        capturedInsertArgs = args ?? [];
        return Promise.resolve({ rows: [{ id: "listing-uuid-null" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const jobPromise = processEnrichmentJob(makeJob(), {
      pool,
      nhtsa: failingNhtsa,
      normalizationService: makeNormalizationService(),
    });

    // Advance past the two 5s retry delays
    await jest.runAllTimersAsync();
    await jobPromise;

    expect(failingNhtsa.decodeVin).toHaveBeenCalledTimes(3);
    // assembly_country is parameter $18 (index 17)
    expect(capturedInsertArgs[17]).toBeNull();
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO listings"),
      expect.any(Array),
    );

    jest.useRealTimers();
  });

  // ── Detected add-ons persistence ─────────────────────────────────────────

  it("inserts dealer_addons rows when detectedAddons is non-empty", async () => {
    const normSvc = {
      normalize: jest.fn().mockReturnValue({
        ...BASE_LISTING,
        adjustedSellingPrice: 52_000,
        rebateDetected: false,
        detectedAddons: [
          { addonName: "Nitrogen Fill", detectedCost: 249, isMandatory: true, keywordMatch: "nitrogen" },
          { addonName: "Window Tint", detectedCost: 699, isMandatory: true, keywordMatch: "window tint" },
        ],
        addonAdjustedPrice: 52_948,
        taxCreditFlag: false,
        texasTax: null,
        gapInsuranceDetected: null,
      }),
    } as any;

    const { pool, clientQuery } = makePool([{ rows: [] }]);
    clientQuery.mockResolvedValue({ rows: [{ id: "listing-with-addons" }] });

    await processEnrichmentJob(makeJob(), {
      pool,
      nhtsa: makeNhtsa(),
      normalizationService: normSvc,
    });

    const addonInsertCalls = (clientQuery.mock.calls as [string, unknown[]][]).filter(
      ([sql]) => sql.includes("INSERT INTO dealer_addons"),
    );
    expect(addonInsertCalls).toHaveLength(2);
    expect(addonInsertCalls[0][1]).toEqual(
      expect.arrayContaining(["Nitrogen Fill", 249, true, "nitrogen"]),
    );
    expect(addonInsertCalls[1][1]).toEqual(
      expect.arrayContaining(["Window Tint", 699, true, "window tint"]),
    );
  });

  it("does not call INSERT INTO dealer_addons when detectedAddons is empty", async () => {
    const { pool, clientQuery } = makePool([{ rows: [] }]);
    clientQuery.mockResolvedValue({ rows: [{ id: "listing-no-addons" }] });

    await processEnrichmentJob(makeJob(), makeDeps({ pool }));

    const addonInsertCalls = (clientQuery.mock.calls as [string, unknown[]][]).filter(
      ([sql]) => sql.includes("INSERT INTO dealer_addons"),
    );
    expect(addonInsertCalls).toHaveLength(0);
  });

  // ── Structured success log ────────────────────────────────────────────────

  it("emits a structured JSON log containing event='vin-enriched' on success", async () => {
    const { pool, clientQuery } = makePool([{ rows: [] }]);
    clientQuery.mockResolvedValue({ rows: [{ id: "listing-log-test" }] });

    await processEnrichmentJob(makeJob(), makeDeps({ pool }));

    const logCall = (console.log as jest.Mock).mock.calls.find(
      ([msg]: [string]) =>
        typeof msg === "string" && msg.includes("vin-enriched"),
    );
    expect(logCall).toBeDefined();
    const parsed = JSON.parse(logCall![0]);
    expect(parsed).toMatchObject({
      event: "vin-enriched",
      vin: BASE_LISTING.vin,
      dealerId: "dealer-1",
      assemblyCountry: "US",
      obbbaEligible: true,
    });
  });

  // ── Transaction rollback on error ─────────────────────────────────────────

  it("rolls back the transaction and rethrows on INSERT failure", async () => {
    const { pool, clientQuery } = makePool([{ rows: [] }]);
    clientQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO listings")) {
        return Promise.reject(new Error("DB constraint violation"));
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      processEnrichmentJob(makeJob(), makeDeps({ pool })),
    ).rejects.toThrow("DB constraint violation");

    const rollbackCall = (clientQuery.mock.calls as [string][]).find(
      ([sql]) => sql === "ROLLBACK",
    );
    expect(rollbackCall).toBeDefined();
  });

  // ── Parameterized SQL (security — no concatenation) ───────────────────────

  it("uses parameterized queries for all DB operations", async () => {
    const { pool, clientQuery } = makePool([{ rows: [] }]);
    clientQuery.mockResolvedValue({ rows: [{ id: "listing-param-test" }] });

    await processEnrichmentJob(makeJob(), makeDeps({ pool }));

    // Every call to clientQuery must have a params array or no params (BEGIN/COMMIT/ROLLBACK)
    for (const [sql, params] of clientQuery.mock.calls as [string, unknown[] | undefined][]) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") continue;
      // Should have a params array (no inline values)
      expect(params).toBeDefined();
      expect(Array.isArray(params)).toBe(true);
      // The SQL itself should not contain literal VIN or price values
      expect(sql).not.toContain(BASE_LISTING.vin);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — VinEnrichmentWorker constructor
// ---------------------------------------------------------------------------

describe("VinEnrichmentWorker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it("creates a BullMQ Worker on the ENRICHMENT queue", () => {
    const connection = {} as any;
    const pool = { query: jest.fn(), connect: jest.fn() } as any;

    new VinEnrichmentWorker({ connection, pool });

    expect(Worker).toHaveBeenCalledWith(
      QUEUE_NAMES.ENRICHMENT,
      expect.any(Function),
      expect.objectContaining({ connection, concurrency: 10 }),
    );
  });

  it("registers a 'failed' event handler on the worker", () => {
    const connection = {} as any;
    const pool = { query: jest.fn(), connect: jest.fn() } as any;

    new VinEnrichmentWorker({ connection, pool });

    expect(mockWorkerOn).toHaveBeenCalledWith("failed", expect.any(Function));
  });

  it("logs a structured error when a job fails", () => {
    const connection = {} as any;
    const pool = { query: jest.fn(), connect: jest.fn() } as any;

    new VinEnrichmentWorker({ connection, pool });

    const failedHandler = mockWorkerOn.mock.calls.find(
      ([event]: [string]) => event === "failed",
    )?.[1];

    const mockJob = {
      data: { dealerId: "dealer-x", listing: BASE_LISTING } as EnrichmentJobPayload,
      attemptsMade: 2,
    };
    failedHandler(mockJob, new Error("Unexpected failure"));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Enrichment job failed"),
    );
  });

  it("accepts an injected NHTSAClient override", () => {
    const connection = {} as any;
    const pool = { query: jest.fn(), connect: jest.fn() } as any;
    const customNhtsa = { decodeVin: jest.fn() } as any;

    // Should not throw
    expect(() =>
      new VinEnrichmentWorker({ connection, pool, nhtsa: customNhtsa }),
    ).not.toThrow();
  });
});
