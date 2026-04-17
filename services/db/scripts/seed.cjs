"use strict";

/**
 * Seed runner — executes seeds/001_seed_dealers.sql against the connected database.
 * Requires DATABASE_URL to be set in the environment. Never hardcode credentials here.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

async function runSeed() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const seedFile = path.join(__dirname, "..", "seeds", "001_seed_dealers.sql");
  const sql = fs.readFileSync(seedFile, "utf8");

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Seed completed successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed, transaction rolled back:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSeed();
