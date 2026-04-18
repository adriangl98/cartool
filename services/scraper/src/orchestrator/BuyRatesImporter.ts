import type { Pool } from "pg";

const REQUIRED_HEADERS = [
  "make",
  "model",
  "trim",
  "year",
  "month_year",
  "base_mf",
  "residual_24",
  "residual_36",
  "residual_48",
] as const;

/**
 * Parameterized upsert. Blank trim is stored as '' so the UNIQUE constraint
 * (make, model, trim, year, month_year) resolves deterministically — two NULL
 * values are never considered equal in PostgreSQL.
 */
const UPSERT_SQL = `
  INSERT INTO buy_rates
    (make, model, trim, year, month_year, base_mf, residual_24, residual_36, residual_48, source)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual')
  ON CONFLICT (make, model, trim, year, month_year)
  DO UPDATE SET
    base_mf     = EXCLUDED.base_mf,
    residual_24 = EXCLUDED.residual_24,
    residual_36 = EXCLUDED.residual_36,
    residual_48 = EXCLUDED.residual_48,
    source      = EXCLUDED.source,
    created_at  = NOW()
`;

interface BuyRateRecord {
  make: string;
  model: string;
  trim: string;
  year: string;
  month_year: string;
  base_mf: string;
  residual_24: string;
  residual_36: string;
  residual_48: string;
}

/**
 * Parses a CSV string into typed buy-rate records.
 * Throws if required header columns are missing.
 * Logs a warn-level structured message and skips any row with wrong column
 * count or missing required fields.
 */
function parseCsv(csvContent: string): BuyRateRecord[] {
  const lines = csvContent
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const rawHeaders = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_HEADERS.filter((h) => !rawHeaders.includes(h));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);
  }

  const records: BuyRateRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    if (cols.length !== rawHeaders.length) {
      console.log(
        JSON.stringify({
          level: "warn",
          event: "buy-rates-skipped-row",
          reason: "column count mismatch",
          lineNumber: i + 1,
        }),
      );
      continue;
    }

    const record: Record<string, string> = {};
    for (let j = 0; j < rawHeaders.length; j++) {
      record[rawHeaders[j]!] = (cols[j] ?? "").trim();
    }

    const make = record["make"] ?? "";
    const model = record["model"] ?? "";
    const base_mf = record["base_mf"] ?? "";

    if (!make || !model || !base_mf) {
      console.log(
        JSON.stringify({
          level: "warn",
          event: "buy-rates-skipped-row",
          reason: "missing required field (make, model, or base_mf)",
          lineNumber: i + 1,
        }),
      );
      continue;
    }

    records.push({
      make,
      model,
      trim: record["trim"] ?? "",
      year: record["year"] ?? "",
      month_year: record["month_year"] ?? "",
      base_mf,
      residual_24: record["residual_24"] ?? "",
      residual_36: record["residual_36"] ?? "",
      residual_48: record["residual_48"] ?? "",
    });
  }

  return records;
}

/**
 * Parses a buy-rates CSV string and upserts all valid rows into the
 * `buy_rates` table using the provided connection pool.
 *
 * No fs calls are made here — the caller is responsible for reading the file.
 * This keeps the function unit-testable without file-system mocks.
 *
 * @param csvContent - Raw CSV text (must include a header row)
 * @param pool       - pg Pool; a dedicated client is checked out for the
 *                     transaction and released when done
 * @returns Number of rows upserted
 */
export async function importBuyRates(
  csvContent: string,
  pool: Pool,
): Promise<number> {
  const records = parseCsv(csvContent);

  if (records.length === 0) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "buy-rates-refreshed",
        rowsUpserted: 0,
        source: "csv",
      }),
    );
    return 0;
  }

  const client = await pool.connect();
  let rowsUpserted = 0;

  try {
    await client.query("BEGIN");

    for (const rec of records) {
      const residual24 = rec.residual_24 !== "" ? rec.residual_24 : null;
      const residual36 = rec.residual_36 !== "" ? rec.residual_36 : null;
      const residual48 = rec.residual_48 !== "" ? rec.residual_48 : null;

      await client.query(UPSERT_SQL, [
        rec.make,
        rec.model,
        rec.trim,
        rec.year,
        rec.month_year,
        rec.base_mf,
        residual24,
        residual36,
        residual48,
      ]);

      rowsUpserted++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(
    JSON.stringify({
      level: "info",
      event: "buy-rates-refreshed",
      rowsUpserted,
      source: "csv",
    }),
  );

  return rowsUpserted;
}
