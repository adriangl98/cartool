import { Router } from "express";
import { z } from "zod";
import { validateQuery } from "../middleware/validate";
import { applyBalloonWarning } from "../middleware/balloonWarning";
import { pool } from "../db";
import { redis } from "../redis";

// ── Zod schema for all query parameters (spec §7.3) ──────────────────────────
//
// `make` is gated by a regex that allows only alphanumeric characters, spaces,
// commas, and hyphens. This means injection strings like `'; DROP TABLE …; --`
// are rejected at the validation layer (400) and never reach the database.
const listingsQuerySchema = z.object({
  make: z
    .string()
    .regex(
      /^[a-zA-Z0-9 ,-]+$/,
      "make must contain only letters, numbers, spaces, commas, or hyphens",
    )
    .optional(),
  model: z.string().optional(),
  transaction_type: z.enum(["lease", "finance", "balloon"]).optional(),
  max_effective_monthly: z.coerce.number().positive().optional(),
  min_deal_score: z.coerce.number().int().min(0).max(100).optional(),
  dealer_id: z.string().uuid().optional(),
  obbba_eligible: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(20),
});

type ListingsQuery = z.infer<typeof listingsQuerySchema>;

// ── Deal quality label derived from composite deal score ──────────────────────
function getDealQuality(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score >= 85) return "Excellent Deal";
  if (score >= 70) return "Competitive Deal";
  if (score >= 50) return "Average Deal";
  return "Sub-Optimal Deal";
}

// ── Stable cache key: sort params so key is order-independent ─────────────────
function buildCacheKey(params: ListingsQuery): string {
  const sorted: Record<string, unknown> = {};
  for (const key of (Object.keys(params) as (keyof ListingsQuery)[]).sort()) {
    sorted[key as string] = params[key];
  }
  return `listings:${JSON.stringify(sorted)}`;
}

// ── Dynamic parameterized WHERE clause ────────────────────────────────────────
function buildWhereClause(
  params: ListingsQuery,
  startIdx: number = 1,
): { conditions: string[]; values: unknown[]; nextIdx: number } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;

  if (params.make !== undefined) {
    const makes = params.make
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    conditions.push(`l.make = ANY($${idx})`);
    values.push(makes);
    idx++;
  }

  if (params.model !== undefined) {
    conditions.push(`l.model ILIKE $${idx}`);
    values.push(params.model);
    idx++;
  }

  if (params.transaction_type !== undefined) {
    conditions.push(`l.transaction_type = $${idx}`);
    values.push(params.transaction_type);
    idx++;
  }

  if (params.max_effective_monthly !== undefined) {
    conditions.push(`l.effective_monthly <= $${idx}`);
    values.push(params.max_effective_monthly);
    idx++;
  }

  if (params.min_deal_score !== undefined) {
    conditions.push(`l.deal_score >= $${idx}`);
    values.push(params.min_deal_score);
    idx++;
  }

  if (params.dealer_id !== undefined) {
    conditions.push(`l.dealer_id = $${idx}`);
    values.push(params.dealer_id);
    idx++;
  }

  if (params.obbba_eligible !== undefined) {
    conditions.push(`l.obbba_eligible = $${idx}`);
    values.push(params.obbba_eligible);
    idx++;
  }

  return { conditions, values, nextIdx: idx };
}

// ── Router factory (financialEngineUrl injected for DI / testability) ─────────
export function createListingsRouter(financialEngineUrl: string): Router {
  const router = Router();

router.get(
  "/",
  validateQuery(listingsQuerySchema),
  async (req, res): Promise<void> => {
    const params = req.query as unknown as ListingsQuery;
    const cacheKey = buildCacheKey(params);

    // Try Redis cache first (1-hour TTL, spec §F05.2)
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        res.json(JSON.parse(cached));
        return;
      }
    } catch {
      // Non-fatal: proceed to DB on cache read error
    }

    const { conditions, values, nextIdx } = buildWhereClause(params);
    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (params.page - 1) * params.per_page;

    const countQuery = {
      text: `SELECT COUNT(*) AS total FROM listings l ${whereClause}`,
      values,
    };

    const dataQuery = {
      text: `
        SELECT
          l.id,
          l.vin,
          l.year,
          l.make,
          l.model,
          l.trim,
          l.msrp,
          l.selling_price,
          l.addon_adjusted_price,
          l.transaction_type,
          l.advertised_monthly,
          l.effective_monthly,
          l.tcol,
          l.money_factor,
          l.mf_markup_flag,
          l.deal_score,
          l.obbba_eligible,
          l.assembly_plant,
          l.gap_insurance_detected,
          l.scraped_at,
          d.id           AS dealer_id,
          d.name         AS dealer_name,
          d.group_name   AS dealer_group,
          COALESCE(
            json_agg(
              json_build_object(
                'name',           da.addon_name,
                'estimated_cost', da.detected_cost,
                'is_mandatory',   da.is_mandatory
              )
            ) FILTER (WHERE da.id IS NOT NULL),
            '[]'::json
          ) AS addons
        FROM listings l
        LEFT JOIN dealers       d  ON d.id         = l.dealer_id
        LEFT JOIN dealer_addons da ON da.listing_id = l.id
        ${whereClause}
        GROUP BY l.id, d.id
        ORDER BY l.deal_score DESC NULLS LAST
        LIMIT $${nextIdx} OFFSET $${nextIdx + 1}
      `,
      values: [...values, params.per_page, offset],
    };

    try {
      const [countResult, dataResult] = await Promise.all([
        pool.query(countQuery),
        pool.query(dataQuery),
      ]);

      const total = parseInt(countResult.rows[0].total, 10);

      const data = dataResult.rows.map((row) => {
        const moneyFactor =
          row.money_factor != null ? parseFloat(row.money_factor) : null;

        const mapped = {
          id: row.id,
          vin: row.vin,
          year: row.year,
          make: row.make,
          model: row.model,
          trim: row.trim ?? null,
          msrp: row.msrp != null ? parseFloat(row.msrp) : null,
          selling_price:
            row.selling_price != null ? parseFloat(row.selling_price) : null,
          addon_adjusted_price:
            row.addon_adjusted_price != null
              ? parseFloat(row.addon_adjusted_price)
              : null,
          transaction_type: row.transaction_type,
          advertised_monthly:
            row.advertised_monthly != null
              ? parseFloat(row.advertised_monthly)
              : null,
          effective_monthly:
            row.effective_monthly != null
              ? parseFloat(row.effective_monthly)
              : null,
          tcol: row.tcol != null ? parseFloat(row.tcol) : null,
          money_factor: moneyFactor,
          // equivalent_apr derived per spec §7.3: money_factor * 2400
          equivalent_apr:
            moneyFactor != null
              ? parseFloat((moneyFactor * 2400).toFixed(2))
              : null,
          mf_markup_flag: row.mf_markup_flag,
          deal_score: row.deal_score,
          deal_quality: getDealQuality(row.deal_score),
          obbba_eligible: row.obbba_eligible,
          assembly_plant: row.assembly_plant ?? null,
          gap_insurance_detected: row.gap_insurance_detected ?? false,
          dealer: {
            id: row.dealer_id,
            name: row.dealer_name,
            group: row.dealer_group,
          },
          addons: row.addons ?? [],
          scraped_at: row.scraped_at,
        };

        return applyBalloonWarning(mapped);
      });

      const response = {
        data,
        pagination: {
          page: params.page,
          per_page: params.per_page,
          total,
        },
      };

      // Cache result for 1 hour
      try {
        await redis.set(cacheKey, JSON.stringify(response), "EX", 3600);
      } catch {
        // Non-fatal: proceed without caching on write error
      }

      res.json(response);
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── TAX CREDIT BANNER TEXT (spec §9.2) ────────────────────────────────────────
const TAX_CREDIT_MESSAGE =
  "Lender Tax Credit Detected — This lease may have $0 upfront Texas sales tax. Verify with dealer.";

// ── UUID param schema ─────────────────────────────────────────────────────────
const uuidSchema = z.string().uuid();

// ── F05.4: GET /listings/:id/disclosure ───────────────────────────────────────
router.get("/:id/disclosure", async (req, res): Promise<void> => {
  // Validate :id is a UUID
  const parseResult = uuidSchema.safeParse(req.params.id);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid listing ID — must be a valid UUID" });
    return;
  }

  const id = parseResult.data;

  try {
    const result = await pool.query({
      text: `
        SELECT
          l.id,
          l.vin,
          l.year,
          l.make,
          l.model,
          l.trim,
          l.transaction_type,
          l.raw_fine_print_text,
          l.tax_credit_flag,
          l.gap_insurance_detected,
          l.deal_score,
          l.obbba_eligible,
          d.base_url AS dealer_listing_url,
          COALESCE(
            json_agg(
              json_build_object(
                'name',           da.addon_name,
                'estimated_cost', da.detected_cost,
                'is_mandatory',   da.is_mandatory
              )
            ) FILTER (WHERE da.id IS NOT NULL),
            '[]'::json
          ) AS addons
        FROM listings l
        LEFT JOIN dealers       d  ON d.id         = l.dealer_id
        LEFT JOIN dealer_addons da ON da.listing_id = l.id
        WHERE l.id = $1
        GROUP BY l.id, d.id
      `,
      values: [id],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }

    const row = result.rows[0];

    const response: Record<string, unknown> = {
      id: row.id,
      vin: row.vin,
      year: row.year,
      make: row.make,
      model: row.model,
      trim: row.trim ?? null,
      transaction_type: row.transaction_type,
      raw_fine_print_text: row.raw_fine_print_text ?? null,
      tax_credit_flag: row.tax_credit_flag,
      dealer_listing_url: row.dealer_listing_url ?? null,
      addons: row.addons ?? [],
    };

    // Include tax credit banner when flag is set (spec §8.5, §9.2)
    if (row.tax_credit_flag === true) {
      response.tax_credit_message = TAX_CREDIT_MESSAGE;
    }

    // Inject balloon GAP warning when applicable (spec §9.3, F05.8)
    const warningPayload = applyBalloonWarning({
      transaction_type: row.transaction_type as string,
      gap_insurance_detected: row.gap_insurance_detected as boolean,
    });
    if ("warnings" in warningPayload) {
      response.warnings = warningPayload.warnings;
    }

    res.json(response);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── F05.5: GET /listings/:id/obbba ────────────────────────────────────────────
router.get("/:id/obbba", async (req, res): Promise<void> => {
  // Validate :id is a UUID
  const parseResult = uuidSchema.safeParse(req.params.id);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid listing ID — must be a valid UUID" });
    return;
  }

  const id = parseResult.data;

  // Fetch listing eligibility fields from DB using a parameterized query
  let listing: { transaction_type: string; obbba_eligible: boolean } | null = null;
  try {
    const result = await pool.query({
      text: `SELECT transaction_type, obbba_eligible FROM listings WHERE id = $1`,
      values: [id],
    });
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }
    listing = result.rows[0] as { transaction_type: string; obbba_eligible: boolean };
  } catch {
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  // Eligibility checks (spec §10.1)
  if (listing.transaction_type !== "finance") {
    res
      .status(400)
      .json({ error: "OBBBA deduction only applies to finance transactions" });
    return;
  }

  if (!listing.obbba_eligible) {
    res
      .status(400)
      .json({ error: "Vehicle is not OBBBA-eligible (foreign assembly)" });
    return;
  }

  // Call Financial Engine for OBBBA computation
  try {
    const feRes = await fetch(`${financialEngineUrl}/obbba/${id}`);

    if (feRes.status === 404) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }

    if (!feRes.ok) {
      res
        .status(503)
        .json({ error: "Financial Engine unavailable. Please try again later." });
      return;
    }

    const data = await feRes.json();
    res.json(data);
  } catch {
    res
      .status(503)
      .json({ error: "Financial Engine unavailable. Please try again later." });
  }
});

  return router;
}
