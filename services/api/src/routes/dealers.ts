import { Router } from "express";
import { pool } from "../db";

// ── Router factory ────────────────────────────────────────────────────────────
export function createDealersRouter(): Router {
  const router = Router();

  // GET /dealers — all active dealers with their most recent scraped_at
  router.get("/", async (_req, res): Promise<void> => {
    const result = await pool.query({
      text: `
        SELECT
          d.id,
          d.name,
          d.group_name,
          d.base_url,
          d.zip_code,
          MAX(l.scraped_at) AS last_scraped_at
        FROM dealers d
        LEFT JOIN listings l ON l.dealer_id = d.id
        WHERE d.is_active = true
        GROUP BY d.id, d.name, d.group_name, d.base_url, d.zip_code
        ORDER BY d.name ASC
      `,
      values: [],
    });

    res.json({ data: result.rows });
  });

  return router;
}
