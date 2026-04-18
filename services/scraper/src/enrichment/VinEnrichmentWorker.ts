import { Worker, type Job } from "bullmq";
import type { Pool, PoolClient } from "pg";
import type Redis from "ioredis";
import { QUEUE_NAMES } from "@cartool/shared";
import type { EnrichmentJobPayload } from "../types/EnrichmentJobPayload";
import type { DetectedAddon } from "../types/DetectedAddon";
import { NormalizationService } from "../normalizer/NormalizationService";
import { NHTSAClient, type AssemblyInfo } from "./NHTSAClient";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Concurrent enrichment jobs per worker instance. */
const ENRICHMENT_CONCURRENCY = 10;

/** NHTSA API call retry parameters (spec §5.5). */
const NHTSA_MAX_ATTEMPTS = 3;
const NHTSA_RETRY_DELAY_MS = 5_000;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ProcessJobDeps {
  pool: Pool;
  nhtsa: NHTSAClient;
  normalizationService: NormalizationService;
}

export interface VinEnrichmentWorkerOptions {
  /** Dedicated ioredis connection for the BullMQ Worker. */
  connection: Redis;
  /** PostgreSQL pool used to persist listings and add-ons. */
  pool: Pool;
  /** Optional NHTSAClient override — defaults to production endpoint. */
  nhtsa?: NHTSAClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Linear-delay retry for NHTSA calls (spec §5.5 — 3 attempts, 5 s each). */
async function callNHTSAWithRetry(
  nhtsa: NHTSAClient,
  vin: string,
): Promise<AssemblyInfo | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= NHTSA_MAX_ATTEMPTS; attempt++) {
    try {
      return await nhtsa.decodeVin(vin);
    } catch (err) {
      lastError = err;
      console.log(
        JSON.stringify({
          level: "warn",
          message: "NHTSA vPIC call failed — will retry",
          vin,
          attempt,
          maxAttempts: NHTSA_MAX_ATTEMPTS,
          error: String(err),
        }),
      );
      if (attempt < NHTSA_MAX_ATTEMPTS) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, NHTSA_RETRY_DELAY_MS),
        );
      }
    }
  }

  console.log(
    JSON.stringify({
      level: "warn",
      message:
        "NHTSA vPIC unavailable after all retries — listing will be saved with assemblyCountry = null",
      vin,
      error: String(lastError),
    }),
  );
  return null;
}

/** Insert a single listing row and return its generated UUID. */
async function insertListing(
  client: PoolClient,
  dealerId: string,
  payload: {
    vin: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    msrp: number;
    sellingPrice?: number;
    transactionType: string;
    advertisedMonthly?: number;
    moneyFactor?: number;
    residualPercent?: number;
    leaseTermMonths?: number;
    dueAtSigning?: number;
    aprPercent?: number;
    loanTermMonths?: number;
    adjustedSellingPrice: number;
    addonAdjustedPrice: number;
    assemblyCountry: string | null;
    assemblyPlant: string | null;
    obbbaEligible: boolean;
    rawS3Key?: string;
    scrapedAt: Date;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO listings (
       dealer_id, vin, year, make, model, trim,
       msrp, selling_price, transaction_type,
       advertised_monthly, money_factor, residual_percent,
       lease_term_months, due_at_signing,
       apr_percent, loan_term_months,
       addon_adjusted_price,
       assembly_country, assembly_plant, obbba_eligible,
       raw_s3_key, scraped_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9,
       $10, $11, $12,
       $13, $14,
       $15, $16,
       $17,
       $18, $19, $20,
       $21, $22
     )
     RETURNING id`,
    [
      dealerId,
      payload.vin,
      payload.year,
      payload.make,
      payload.model,
      payload.trim ?? null,
      payload.msrp,
      payload.adjustedSellingPrice,
      payload.transactionType,
      payload.advertisedMonthly ?? null,
      payload.moneyFactor ?? null,
      payload.residualPercent ?? null,
      payload.leaseTermMonths ?? null,
      payload.dueAtSigning ?? null,
      payload.aprPercent ?? null,
      payload.loanTermMonths ?? null,
      payload.addonAdjustedPrice,
      payload.assemblyCountry,
      payload.assemblyPlant,
      payload.obbbaEligible,
      payload.rawS3Key ?? null,
      payload.scrapedAt,
    ],
  );

  return result.rows[0].id;
}

/** Insert detected add-on rows linked to a listing. */
async function insertAddons(
  client: PoolClient,
  listingId: string,
  addons: DetectedAddon[],
): Promise<void> {
  for (const addon of addons) {
    await client.query(
      `INSERT INTO dealer_addons
         (listing_id, addon_name, detected_cost, is_mandatory, keyword_match)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        listingId,
        addon.addonName,
        addon.detectedCost ?? null,
        addon.isMandatory,
        addon.keywordMatch,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// processEnrichmentJob — exported for unit testing (mirrors processScrapeJob)
// ---------------------------------------------------------------------------

/**
 * Core enrichment logic — extracted so tests can call it directly without
 * constructing a BullMQ Worker.
 *
 * Steps:
 * 1. Normalize the raw listing.
 * 2. Check DB for a cached assembly record for this VIN (deduplication).
 * 3. Call NHTSA vPIC if no cached record (with linear retry).
 * 4. Persist listing + add-ons in a single DB transaction.
 * 5. Emit a structured success log.
 */
export async function processEnrichmentJob(
  job: Job<EnrichmentJobPayload>,
  deps: ProcessJobDeps,
): Promise<void> {
  const { dealerId, listing: rawListing } = job.data;

  // ── 1. Normalize ─────────────────────────────────────────────────────────
  const normalized = deps.normalizationService.normalize(rawListing);

  // ── 2. VIN deduplication: reuse assembly data already stored in DB ────────
  const dedupResult = await deps.pool.query<{
    assembly_country: string | null;
    assembly_plant: string | null;
    obbba_eligible: boolean;
  }>(
    `SELECT assembly_country, assembly_plant, obbba_eligible
       FROM listings
      WHERE vin = $1
        AND assembly_country IS NOT NULL
      LIMIT 1`,
    [normalized.vin],
  );

  let assemblyInfo: AssemblyInfo;

  if (dedupResult.rows.length > 0) {
    const row = dedupResult.rows[0];
    assemblyInfo = {
      assemblyCountry: row.assembly_country,
      assemblyPlant: row.assembly_plant,
      obbbaEligible: row.obbba_eligible,
    };
  } else {
    // ── 3. NHTSA call (with retry) ──────────────────────────────────────────
    const nhtsaResult = await callNHTSAWithRetry(deps.nhtsa, normalized.vin);
    assemblyInfo = nhtsaResult ?? {
      assemblyCountry: null,
      assemblyPlant: null,
      obbbaEligible: false,
    };
  }

  // ── 4. Persist in a single transaction ───────────────────────────────────
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");

    const listingId = await insertListing(client, dealerId, {
      vin: normalized.vin,
      year: normalized.year,
      make: normalized.make,
      model: normalized.model,
      trim: normalized.trim,
      msrp: normalized.msrp,
      sellingPrice: normalized.sellingPrice,
      transactionType: normalized.transactionType,
      advertisedMonthly: normalized.advertisedMonthly,
      moneyFactor: normalized.moneyFactor,
      residualPercent: normalized.residualPercent,
      leaseTermMonths: normalized.leaseTermMonths,
      dueAtSigning: normalized.dueAtSigning,
      aprPercent: normalized.aprPercent,
      loanTermMonths: normalized.loanTermMonths,
      adjustedSellingPrice: normalized.adjustedSellingPrice,
      addonAdjustedPrice: normalized.addonAdjustedPrice,
      assemblyCountry: assemblyInfo.assemblyCountry,
      assemblyPlant: assemblyInfo.assemblyPlant,
      obbbaEligible: assemblyInfo.obbbaEligible,
      rawS3Key: normalized.rawS3Key,
      scrapedAt: normalized.scrapedAt,
    });

    if (normalized.detectedAddons.length > 0) {
      await insertAddons(client, listingId, normalized.detectedAddons);
    }

    await client.query("COMMIT");

    // ── 5. Structured success log ────────────────────────────────────────────
    console.log(
      JSON.stringify({
        level: "info",
        event: "vin-enriched",
        vin: normalized.vin,
        dealerId,
        assemblyCountry: assemblyInfo.assemblyCountry,
        obbbaEligible: assemblyInfo.obbbaEligible,
        listingId,
        addonCount: normalized.detectedAddons.length,
      }),
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// VinEnrichmentWorker
// ---------------------------------------------------------------------------

/**
 * BullMQ worker that consumes `enrichment-jobs`, normalizes each raw listing,
 * enriches its VIN via the NHTSA vPIC API, and persists the result to the
 * `listings` and `dealer_addons` tables (spec §5.5 / F03.5).
 */
export class VinEnrichmentWorker {
  readonly worker: Worker<EnrichmentJobPayload>;

  constructor(opts: VinEnrichmentWorkerOptions) {
    const normalizationService = new NormalizationService();
    const nhtsa = opts.nhtsa ?? new NHTSAClient();

    const deps: ProcessJobDeps = {
      pool: opts.pool,
      nhtsa,
      normalizationService,
    };

    this.worker = new Worker<EnrichmentJobPayload>(
      QUEUE_NAMES.ENRICHMENT,
      (job) => processEnrichmentJob(job, deps),
      { connection: opts.connection, concurrency: ENRICHMENT_CONCURRENCY },
    );

    this.worker.on(
      "failed",
      (job: Job<EnrichmentJobPayload> | undefined, err: Error) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "Enrichment job failed",
            vin: job?.data.listing.vin,
            dealerId: job?.data.dealerId,
            attemptsMade: job?.attemptsMade,
            error: String(err),
          }),
        );
      },
    );
  }
}
