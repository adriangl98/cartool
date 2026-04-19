import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate";
import { pool } from "../db";

// -- Zod schema for request body (spec 7.3 / F05.3) --------------------------
const reverseSearchBodySchema = z.object({
  desired_monthly: z.number().positive(),
  down_payment: z.number().min(0),
  term_months: z.union([
    z.literal(24),
    z.literal(36),
    z.literal(48),
    z.literal(60),
  ]),
  transaction_type: z.enum(["lease", "finance", "balloon"]),
  preferred_makes: z.array(z.string()).optional(),
  obbba_only: z.boolean().optional(),
});

type ReverseSearchBody = z.infer<typeof reverseSearchBodySchema>;

// -- Deal quality label (mirrors F05.2) ---------------------------------------
function getDealQuality(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score >= 85) return "Excellent Deal";
  if (score >= 70) return "Competitive Deal";
  if (score >= 50) return "Average Deal";
  return "Sub-Optimal Deal";
}

// -- Router factory (financialEngineUrl injected to keep config.ts out of tests)
export function createReverseSearchRouter(financialEngineUrl: string): Router {
  const router = Router();

  router.post(
    "/",
    validateBody(reverseSearchBodySchema),
    async (req, res): Promise<void> => {
      const body = req.body as ReverseSearchBody;

      // Step 1: Call Financial Engine POST /solve
      let maxSellingPrice: number;
      let assumedApr: number;

      try {
        const solveRes = await fetch(`${financialEngineUrl}/solve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            desired_monthly: body.desired_monthly,
            down_payment: body.down_payment,
            term_months: body.term_months,
          }),
        });

        if (!solveRes.ok) {
          res.status(503).json({
            error: "Financial Engine unavailable. Please try again later.",
          });
          return;
        }

        const solveData = (await solveRes.json()) as {
          max_selling_price: string;
          avg_apr: string;
        };
        maxSellingPrice = parseFloat(solveData.max_selling_price);
        assumedApr = parseFloat(solveData.avg_apr);
      } catch {
        // Network error or Financial Engine unreachable => 503
        res.status(503).json({
          error: "Financial Engine unavailable. Please try again later.",
        });
        return;
      }

      // Step 2: Build parameterized WHERE clause
      const conditions: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      // Always filter by transaction_type
      conditions.push(`l.transaction_type = $${idx}`);
      values.push(body.transaction_type);
      idx++;

      // Filter: effective_monthly <= desired_monthly (AC: EMP <= desired)
      conditions.push(`l.effective_monthly <= $${idx}`);
      values.push(body.desired_monthly);
      idx++;

      // Filter: addon_adjusted_price <= max_selling_price (from Financial Engine)
      conditions.push(`l.addon_adjusted_price <= $${idx}`);
      values.push(maxSellingPrice);
      idx++;

      if (body.preferred_makes && body.preferred_makes.length > 0) {
        conditions.push(`l.make = ANY($${idx})`);
        values.push(body.preferred_makes);
        idx++;
      }

      if (body.obbba_only === true) {
        conditions.push(`l.obbba_eligible = $${idx}`);
        values.push(true);
        idx++;
      }

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      // Step 3: Query listings (same SELECT shape as F05.2)
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
        `,
        values,
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

          return {
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
            equivalent_apr:
              moneyFactor != null
                ? parseFloat((moneyFactor * 2400).toFixed(2))
                : null,
            mf_markup_flag: row.mf_markup_flag,
            deal_score: row.deal_score,
            deal_quality: getDealQuality(row.deal_score),
            obbba_eligible: row.obbba_eligible,
            assembly_plant: row.assembly_plant ?? null,
            dealer: {
              id: row.dealer_id,
              name: row.dealer_name,
              group: row.dealer_group,
            },
            addons: row.addons ?? [],
            scraped_at: row.scraped_at,
          };
        });

        res.json({
          reverse_search_summary: {
            max_selling_price: parseFloat(maxSellingPrice.toFixed(2)),
            assumed_apr: assumedApr,
            texas_tax_included: true,
          },
          data,
          pagination: {
            total,
          },
        });
      } catch {
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  return router;
}
