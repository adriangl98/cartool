"use strict";

/**
 * Buy-rates seed script — imports a CSV file into the buy_rates table via
 * parameterized upserts. Safe to re-run: ON CONFLICT DO UPDATE ensures
 * idempotency.
 *
 * Usage:
 *   DATABASE_URL=<url> node scripts/seed-buy-rates.cjs --file=seeds/002_seed_buy_rates.csv
 *
 * CSV columns (header row required):
 *   make, model, trim, year, month_year, base_mf, residual_24, residual_36, residual_48
 *
 * Leave trim blank for models with no distinct trim (stored as '').
 * month_year must be the first day of the month, e.g. 2026-04-01.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// ── CLI argument parsing ────────────────────────────────────────────────────

const fileArg = process.argv.find((a) => a.startsWith("--file="));
if (!fileArg) {
  console.error("ERROR: --file=<path> argument is required.");
  console.error(
    "Usage: node scripts/seed-buy-rates.cjs --file=seeds/002_seed_buy_rates.csv",
  );
  process.exit(1);
}

const csvPath = path.resolve(fileArg.replace("--file=", ""));
if (!fs.existsSync(csvPath)) {
  console.error(`ERROR: CSV file not found: ${csvPath}`);
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

// ── Constants ───────────────────────────────────────────────────────────────

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
];

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

// ── CSV parser ──────────────────────────────────────────────────────────────

/**
 * Parses CSV content into an array of row objects keyed by header name.
 * Skips blank lines and logs a warning for rows with wrong column count.
 */
function parseCsv(content) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length !== headers.length) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "buy-rates-skipped-row",
          reason: "column count mismatch",
          lineNumber: i + 1,
          raw: lines[i],
        }),
      );
      continue;
    }

    const record = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = cols[j].trim();
    }
    rows.push(record);
  }

  return { headers, rows };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const csvContent = fs.readFileSync(csvPath, "utf8");
  const { headers, rows } = parseCsv(csvContent);

  // Validate all required headers are present
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    console.error(
      `ERROR: CSV is missing required columns: ${missingHeaders.join(", ")}`,
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  let rowsProcessed = 0;
  let rowsUpserted = 0;

  try {
    await client.query("BEGIN");

    for (const [idx, record] of rows.entries()) {
      const make = record.make;
      const model = record.model;
      const trim = record.trim ?? "";
      const year = parseInt(record.year, 10);
      const month_year = record.month_year;
      const base_mf = record.base_mf;
      const residual_24 = record.residual_24 !== "" ? record.residual_24 : null;
      const residual_36 = record.residual_36 !== "" ? record.residual_36 : null;
      const residual_48 = record.residual_48 !== "" ? record.residual_48 : null;

      if (!make || !model) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "buy-rates-skipped-row",
            reason: "make or model is empty",
            lineNumber: idx + 2,
          }),
        );
        continue;
      }
      if (isNaN(year) || !month_year || !base_mf) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "buy-rates-skipped-row",
            reason: "invalid year, month_year, or base_mf",
            lineNumber: idx + 2,
          }),
        );
        continue;
      }

      rowsProcessed++;

      await client.query(UPSERT_SQL, [
        make,
        model,
        trim,
        year,
        month_year,
        base_mf,
        residual_24,
        residual_36,
        residual_48,
      ]);

      rowsUpserted++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed, transaction rolled back:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(
    JSON.stringify({
      event: "buy-rates-seeded",
      rowsProcessed,
      rowsUpserted,
      file: csvPath,
    }),
  );
}

run();
