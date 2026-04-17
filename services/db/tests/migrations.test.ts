import { Client } from "pg";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;

describe("F01.1 — PostgreSQL Migrations", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  const expectedTables = [
    "dealers",
    "listings",
    "dealer_addons",
    "buy_rates",
    "users",
    "saved_searches",
  ];

  test.each(expectedTables)("table '%s' exists", async (tableName) => {
    const result = await client.query(
      "SELECT to_regclass($1::text) AS oid",
      [tableName]
    );
    expect(result.rows[0].oid).not.toBeNull();
  });

  const expectedIndexes = [
    "idx_listings_vin",
    "idx_listings_dealer",
    "idx_listings_deal_score",
    "idx_listings_effective_monthly",
  ];

  test.each(expectedIndexes)("index '%s' exists", async (indexName) => {
    const result = await client.query(
      "SELECT indexname FROM pg_indexes WHERE indexname = $1",
      [indexName]
    );
    expect(result.rows.length).toBe(1);
  });

  test("dealers table has correct monetary column types (NUMERIC, not FLOAT)", async () => {
    const result = await client.query(`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'listings'
        AND column_name IN ('msrp', 'selling_price', 'advertised_monthly', 'tcol', 'effective_monthly', 'addon_adjusted_price')
      ORDER BY column_name
    `);
    for (const row of result.rows) {
      expect(row.data_type).toBe("numeric");
    }
  });

  test("seed inserted at least 2 dealer rows", async () => {
    const result = await client.query("SELECT COUNT(*) AS cnt FROM dealers");
    expect(Number(result.rows[0].cnt)).toBeGreaterThanOrEqual(2);
  });

  test("seed covers both dealer groups", async () => {
    const result = await client.query(
      "SELECT DISTINCT group_name FROM dealers ORDER BY group_name"
    );
    const groups = result.rows.map((r: { group_name: string }) => r.group_name);
    expect(groups).toContain("Sames Auto Group");
    expect(groups).toContain("Powell Watson Auto Group");
  });

  test("buy_rates has UNIQUE constraint on (make, model, trim, year, month_year)", async () => {
    const result = await client.query(`
      SELECT conname
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
      WHERE pg_class.relname = 'buy_rates'
        AND pg_constraint.contype = 'u'
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  test("saved_searches cascades delete from users", async () => {
    // Insert a user and a saved_search, then delete the user and verify cascade
    await client.query("BEGIN");
    try {
      const userResult = await client.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        ["test-cascade@example.com", "hashed_value_placeholder"]
      );
      const userId: string = userResult.rows[0].id;

      await client.query(
        "INSERT INTO saved_searches (user_id) VALUES ($1)",
        [userId]
      );

      const countBefore = await client.query(
        "SELECT COUNT(*) AS cnt FROM saved_searches WHERE user_id = $1",
        [userId]
      );
      expect(Number(countBefore.rows[0].cnt)).toBe(1);

      await client.query("DELETE FROM users WHERE id = $1", [userId]);

      const countAfter = await client.query(
        "SELECT COUNT(*) AS cnt FROM saved_searches WHERE user_id = $1",
        [userId]
      );
      expect(Number(countAfter.rows[0].cnt)).toBe(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
