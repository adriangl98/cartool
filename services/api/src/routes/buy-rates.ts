import { Router } from "express";
import { pool } from "../db";
import { requireRole } from "../middleware/auth";

// ── Router factory ────────────────────────────────────────────────────────────
export function createBuyRatesRouter(jwtSecret: string): Router {
  const router = Router();

  // GET /buy-rates — current month's buy rates (admin only)
  router.get(
    "/",
    requireRole("admin", jwtSecret),
    async (_req, res): Promise<void> => {
      const result = await pool.query({
        text: `
          SELECT
            id,
            make,
            model,
            trim,
            year,
            month_year,
            base_mf,
            residual_24,
            residual_36,
            residual_48,
            source,
            created_at
          FROM buy_rates
          WHERE month_year = date_trunc('month', NOW())
          ORDER BY make ASC, model ASC
        `,
        values: [],
      });

      res.json({ data: result.rows });
    },
  );

  return router;
}
