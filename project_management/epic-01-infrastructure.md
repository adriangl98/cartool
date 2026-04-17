# E01 — Infrastructure & DevOps

**Phase:** Pre-work (before Phase 1)  
**Goal:** Provision all shared infrastructure so every subsequent epic has a stable foundation to build on.  
**Spec Reference:** §3 (Tech Stack), §11 (Security & Compliance), §12 (Non-Functional Requirements)  
**Depends On:** Nothing — this is the starting point.

---

## Features

### F01.1 — PostgreSQL Database Setup

**Description:** Initialize the PostgreSQL 16 database with the full normalized schema.

**Tasks:**
- [x] Create a migration tool setup (`node-pg-migrate` or `Flyway`)
- [x] Write migration `001_create_dealers.sql` — `dealers` table (spec §4.1)
- [x] Write migration `002_create_listings.sql` — `listings` table with all indexes (spec §4.1)
- [x] Write migration `003_create_dealer_addons.sql` — `dealer_addons` table (spec §4.1)
- [x] Write migration `004_create_buy_rates.sql` — `buy_rates` table (spec §4.1)
- [x] Write migration `005_create_users.sql` — `users` and `saved_searches` tables (spec §4.1)
- [x] Verify all foreign keys, indexes, and constraints match the spec exactly
- [x] Seed script: insert the 2 dealer groups and their known dealer entries from spec §1.4

**Acceptance Criteria:**
- `npm run migrate:up` (or equivalent) runs all migrations cleanly on a fresh database.
- All tables exist with correct column types, nullability, and defaults.
- All indexes from the spec (`idx_listings_vin`, `idx_listings_dealer`, `idx_listings_deal_score`, `idx_listings_effective_monthly`) are present.
- Seed script inserts at least Sames Auto Group and Powell Watson Auto Group dealers without error.

---

### F01.2 — Redis Instance Setup

**Description:** Configure Redis for use as a job queue backend (BullMQ) and a listing cache layer.

**Tasks:**
- [x] Add Redis connection config via environment variable (`REDIS_URL`)
- [x] Create a shared Redis client module usable by all Node.js services
- [x] Define BullMQ queue names as constants: `scrape-jobs`, `enrichment-jobs`, `notification-jobs`
- [x] Set default cache TTL constant: 3600 (1 hour) for Deal Score cache entries (spec §3)

**Acceptance Criteria:**
- **A shared Redis client imported by the API service and the Scrape Orchestrator establishes a connection successfully (blocked: `api/` and `scraper/` services not yet built — deferred to E02/E05).**
- All Node.js services reference queue names exclusively via the `QUEUE_NAMES` constant exported from `@cartool/shared` — no inline string literals.
- A unit test verifies that a `QUEUE_NAMES.SCRAPE` job can be enqueued and processed by a BullMQ worker.

---

### F01.3 — AWS S3 / Cloudflare R2 Bucket Setup

**Description:** Provision blob storage for raw HTML archival.

**Tasks:**
- [x] Create an S3 bucket (or R2 bucket) named `cartool-raw-html`
- [x] Configure a 90-day lifecycle policy to automatically delete raw HTML objects (spec §11.2)
- [x] Create an IAM user/role with write-only permissions scoped to this bucket
- [x] Store credentials in AWS Secrets Manager (never in source code)
- [x] Write a shared `StorageClient` module that exposes `upload(key, body)` and `getSignedUrl(key)`

**Acceptance Criteria:**
- A test upload via `StorageClient.upload()` succeeds and the object appears in the bucket.
- Objects older than 90 days are subject to automatic deletion (lifecycle rule is active).
- IAM credentials have no permissions beyond `s3:PutObject` and `s3:GetObject` on `cartool-raw-html/*`.

---

### F01.4 — Docker & Container Configuration

**Description:** Containerize every service so the fleet can be deployed and scaled independently.

**Tasks:**
- [x] Write `Dockerfile` for the Node.js Core API service
- [x] Write `Dockerfile` for the Python Financial Engine (FastAPI)
- [x] Write `Dockerfile` for the Scraper service (Node.js + Playwright + Chromium)
- [x] Write `Dockerfile` for the Auth service
- [x] Write `Dockerfile` for the Notification service
- [x] Write `docker-compose.yml` for local development (all services + PostgreSQL + Redis)
- [x] Add `.dockerignore` files to exclude `node_modules`, `__pycache__`, `.env`, etc.

**Acceptance Criteria:**
- `docker-compose up` starts all services and they pass their respective health checks.
- The scraper container successfully launches a Chromium instance via Playwright.
- No secrets or credentials appear in any `Dockerfile` or `docker-compose.yml`.

---

### F01.5 — CI/CD Pipeline (GitHub Actions)

**Description:** Automated pipeline that runs tests, builds images, and deploys on merge to `main`.

**Tasks:**
- [x] Create `.github/workflows/ci.yml`: lint → test → build on every PR
- [x] Create `.github/workflows/deploy.yml`: push Docker images to ECR and deploy to ECS Fargate on merge to `main`
- [x] Add `npm audit` (Node.js) and `pip audit` (Python) steps — fail pipeline on critical severity
- [x] Add Dependabot configuration for `npm` and `pip` (spec §11.1 A06)
- [ ] Configure GitHub Secrets for all environment variables used in CI

**Acceptance Criteria:**
- A PR with a failing test causes the CI pipeline to fail and block merge.
- A PR with a `npm audit` critical vulnerability causes the pipeline to fail.
- On merge to `main`, images are built and pushed to ECR without manual intervention.

---

### F01.6 — Environment Configuration & Secrets Management

**Description:** Establish a consistent pattern for configuration across all environments.

**Tasks:**
- [ ] Define `.env.example` files for each service listing all required environment variables
- [ ] Integrate AWS Secrets Manager (or Doppler for local dev) for runtime secret injection
- [ ] Define environment tiers: `development`, `staging`, `production`
- [ ] Add `Helmet.js` as a dependency on all Express/Fastify services and enable all default headers (spec §11.1 A05)

**Acceptance Criteria:**
- No `.env` files are committed to the repository (`.gitignore` enforced).
- All services start successfully when environment variables are provided via AWS Secrets Manager in staging.
- All HTTP responses include `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` headers.

---

## Dependencies for Downstream Epics

| Downstream Epic | Requires from E01 |
|---|---|
| E02 (Scraper) | F01.2 (Redis), F01.3 (S3), F01.4 (Docker), F01.1 (DB) |
| E04 (Financial Engine) | F01.1 (DB schema — `listings`, `buy_rates`) |
| E05 (Core API) | F01.1 (DB), F01.2 (Redis cache) |
| E06 (Auth) | F01.1 (DB — `users` table) |
