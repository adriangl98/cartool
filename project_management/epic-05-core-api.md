# E05 — Core API Service

**Phase:** Phase 3 (Weeks 9–11)  
**Goal:** Expose all enriched listing data through a production-ready, rate-limited REST API with the endpoints defined in the spec.  
**Spec Reference:** §7 (API Specification), §11 (Security & Compliance), §12 (Non-Functional Requirements)  
**Depends On:** E04 (computed fields in `listings` table), E06 (Auth middleware for protected endpoints)

---

## Features

### F05.1 — Node.js API Service Bootstrap

**Description:** Initialize the Core API service with Express (or Fastify), middleware stack, and security headers.

**Tasks:**
- [ ] Initialize Node.js 22 project in `services/api/` with TypeScript
- [ ] Install: `express` (or `fastify`), `helmet`, `express-rate-limit`, `pg` (or `postgres`), `ioredis`, `zod` (input validation), `jsonwebtoken`
- [ ] Configure `Helmet.js` with all default headers enabled (spec §11.1 A05)
- [ ] Configure rate limiting: **60 requests/min per IP** on all public routes (spec §7.2)
- [ ] Add `GET /health` health check endpoint
- [ ] Implement a `validate` middleware using `zod` schemas — all query params and request bodies are validated before handler logic runs (spec §11.1 A03, A04)
- [ ] Configure CORS: allow only the known frontend origins (no wildcard `*` in production)

**Acceptance Criteria:**
- All HTTP responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`.
- A client making 61 requests in one minute receives a `429 Too Many Requests` response.
- A request with malformed query parameters returns `400 Bad Request` with a structured error body — it never reaches the database.

---

### F05.2 — `GET /listings` Endpoint

**Description:** Paginated, filterable endpoint returning enriched listings sorted by Deal Score descending by default.

**Tasks:**
- [ ] Define Zod schema for all query parameters (spec §7.3):
  - `make` (optional, comma-separated string), `model` (optional), `transaction_type` (enum), `max_effective_monthly` (positive number), `min_deal_score` (integer 0–100), `dealer_id` (UUID), `obbba_eligible` (boolean), `page` (integer ≥ 1, default 1), `per_page` (integer 1–50, default 20)
- [ ] Implement the database query using **parameterized statements** only — no string interpolation of user-provided values
- [ ] Build dynamic WHERE clause from provided filters
- [ ] Join `dealer_addons` and `dealers` tables for the full response shape (spec §7.3 response)
- [ ] Compute derived field `equivalent_apr` in the response: `money_factor * 2400`
- [ ] Include Redis cache: cache query results for 1 hour keyed by the full normalized query string
- [ ] Response: matches the shape defined in spec §7.3 exactly, including `pagination` object
- [ ] Write integration tests:
  - Filter by `make=Nissan` returns only Nissan listings
  - Filter by `min_deal_score=70` returns only listings with `deal_score >= 70`
  - `per_page=50` is the max — `per_page=51` returns a 400
  - Empty filter set returns all listings (paginated)

**Acceptance Criteria:**
- p95 latency < 300ms under 50 concurrent users (spec §12)
- All query parameters are validated before any DB query executes
- No SQL injection possible (verified by passing `'; DROP TABLE listings; --` as a `make` filter — must return 400 from validation, never reach DB)

---

### F05.3 — `POST /reverse-search` Endpoint

**Description:** Accept budget constraints, call the Financial Engine solver, and return payment-qualified listings.

**Tasks:**
- [ ] Define Zod schema for the request body (spec §7.3):
  - `desired_monthly` (positive number), `down_payment` (number ≥ 0), `term_months` (enum: 24, 36, 48, 60), `transaction_type` (enum), `preferred_makes` (optional string array), `obbba_only` (optional boolean)
- [ ] Call the Python Financial Engine's `POST /solve` endpoint with the budget parameters
- [ ] Use the returned `max_selling_price` to filter listings via the same query logic as F05.2
- [ ] Include `reverse_search_summary` in the response (spec §7.3)
- [ ] Integration tests:
  - Valid input returns listings with `effective_monthly ≤ desired_monthly`
  - `desired_monthly = 0` returns 400
  - `term_months = 37` returns 400

**Acceptance Criteria:**
- p95 latency < 500ms under 50 concurrent users (spec §12)
- All returned listings have `effective_monthly` ≤ the requested `desired_monthly`
- The Financial Engine call failure (service down) returns a graceful `503 Service Unavailable` — not a 500

---

### F05.4 — `GET /listings/:id/disclosure` Endpoint

**Description:** Return the full scraped fine-print text of a listing with detected add-ons highlighted.

**Tasks:**
- [ ] Validate that `:id` is a valid UUID (400 if not)
- [ ] Query the `listings` table for `raw_fine_print_text` and join `dealer_addons`
- [ ] If `tax_credit_flag = true`, include the banner text in the response (spec §8.5)
- [ ] Include a `dealer_listing_url` field: the live link to the dealer page (from the `dealers` table)
- [ ] Return 404 if listing ID does not exist

**Acceptance Criteria:**
- A listing with add-ons returns `addons` array with `name`, `estimated_cost`, `is_mandatory`.
- A listing with `tax_credit_flag = true` includes `"tax_credit_message"` in the response.
- A non-UUID `:id` returns 400; a valid but nonexistent UUID returns 404.

---

### F05.5 — `GET /listings/:id/obbba` Endpoint

**Description:** Return detailed OBBBA federal interest deduction simulation for a finance listing.

**Tasks:**
- [ ] Validate `:id` is a UUID; return 404 if listing not found
- [ ] Return 400 with message `"OBBBA deduction only applies to finance transactions"` if `transaction_type ≠ 'finance'`
- [ ] Return 400 with message `"Vehicle is not OBBBA-eligible (foreign assembly)"` if `obbba_eligible = false`
- [ ] Call the Python Financial Engine's `/obbba/{listing_id}` endpoint (or compute inline using shared logic)
- [ ] Response matches the shape defined in spec §7.3 with all 4 tax bracket options

**Acceptance Criteria:**
- Eligible finance listing returns all 4 bracket rows with non-zero savings.
- Lease or foreign-assembled listing returns the appropriate 400 with a descriptive message.

---

### F05.6 — `GET /dealers` Endpoint

**Description:** Return the list of all active scraped dealers with last-scraped timestamps.

**Tasks:**
- [ ] Query `dealers` table for all `is_active = true` records
- [ ] Join with the most recent `scraped_at` timestamp from the `listings` table per dealer
- [ ] Return: `id`, `name`, `group_name`, `base_url`, `zip_code`, `last_scraped_at`
- [ ] No authentication required; subject to standard rate limiting

**Acceptance Criteria:**
- Response includes at least Sames Auto Group and Powell Watson auto dealers after seeding.
- `last_scraped_at` is the timestamp of the most recent listing for that dealer.

---

### F05.7 — `GET /buy-rates` Endpoint (Internal/Admin)

**Description:** Return current month's buy rates. Restricted to admin JWT role.

**Tasks:**
- [ ] Apply `requireRole('admin')` middleware — return 403 if JWT does not contain `role: "admin"` claim
- [ ] Query `buy_rates` for the current month (`month_year = date_trunc('month', NOW())`)
- [ ] Return the full buy rate table for all tracked makes/models

**Acceptance Criteria:**
- Unauthenticated request returns 401.
- Request with a user-role JWT returns 403.
- Admin-role JWT returns the data correctly.

---

### F05.8 — Balloon Finance Warning Middleware

**Description:** Inject a `warnings` array into the response for balloon finance listings missing GAP insurance.

**Tasks:**
- [ ] Create a response post-processor (middleware or interceptor) that checks:
  - If `transaction_type = 'balloon'` AND `gap_insurance_detected = false`
  - Add `warnings: ["GAP insurance not detected in this balloon finance contract. Consider adding before signing."]` to the listing object (spec §9.3)
- [ ] Apply this to both `GET /listings` and `GET /listings/:id/disclosure` responses

**Acceptance Criteria:**
- A balloon listing with `gap_insurance_detected = false` has the warning in the API response.
- A balloon listing with `gap_insurance_detected = true` has no warning.
- A non-balloon listing has no `warnings` field.

---

## Integration Test Matrix

| Endpoint | Test Scenario | Expected Outcome |
|---|---|---|
| `GET /listings` | No filters | 200, paginated results |
| `GET /listings` | `make=Nissan&min_deal_score=80` | Only Nissan listings with score ≥ 80 |
| `GET /listings` | `per_page=51` | 400 |
| `GET /listings` | SQL injection in `make` | 400 (never reaches DB) |
| `POST /reverse-search` | Valid budget | Listings with EMP ≤ desired_monthly |
| `POST /reverse-search` | `term_months=37` | 400 |
| `GET /listings/:id/disclosure` | Valid OBBBA listing | 200 with OBBBA badge |
| `GET /listings/:id/disclosure` | Invalid UUID | 400 |
| `GET /listings/:id/obbba` | Lease listing | 400 with descriptor message |
| `GET /buy-rates` | No auth | 401 |

**Phase 3 Definition of Done:** All endpoints return correct data with < 300ms p95 latency under 50 concurrent users.

---

## Dependencies for Downstream Epics

| Downstream Epic | Requires from E05 |
|---|---|
| E08 (Frontend Web) | All public endpoints functional and documented |
| E07 (Notifications) | Core API must be running to check deal scores for alert evaluation |
