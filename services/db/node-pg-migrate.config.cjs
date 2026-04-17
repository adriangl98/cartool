// node-pg-migrate configuration
// DATABASE_URL must be set in the environment (never hardcoded here)
"use strict";

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  migrationsTable: "pgmigrations",
  dir: "migrations",
  direction: "up",
  verbose: true,
};
