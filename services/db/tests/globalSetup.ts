import { Client } from "pg";
import path from "path";
import { execSync } from "child_process";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL (or DATABASE_URL) environment variable must be set to run migration tests.");
}

export default async function globalSetup() {
  // Run all migrations up against the test database
  execSync("npm run migrate:up", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL! },
    stdio: "inherit",
  });

  // Run seed
  execSync("npm run seed", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL! },
    stdio: "inherit",
  });
}
