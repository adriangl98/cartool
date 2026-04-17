import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export default async function globalTeardown() {
  // Drop all created tables to leave the test DB clean for re-runs
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      DROP TABLE IF EXISTS saved_searches CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS buy_rates CASCADE;
      DROP TABLE IF EXISTS dealer_addons CASCADE;
      DROP TABLE IF EXISTS listings CASCADE;
      DROP TABLE IF EXISTS dealers CASCADE;
      DROP TABLE IF EXISTS pgmigrations CASCADE;
    `);
  } finally {
    await client.end();
  }
}
