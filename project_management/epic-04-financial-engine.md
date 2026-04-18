# E04 — Financial Intelligence Engine

**Phase:** Phase 2 (Weeks 5–8)  
**Goal:** A Python FastAPI microservice that consumes normalized listings and produces all computed financial fields: EMP, TCOL, MPMR, Deal Score, MF markup flag, OBBBA savings, and the Reverse Search solver.  
**Spec Reference:** §6 (Financial Intelligence Engine), §9.3 (Balloon Finance), §10 (OBBBA Module)  
**Depends On:** E03 (normalized listings with `adjustedSellingPrice`, `addonAdjustedPrice`, `taxCreditFlag`, `assemblyCountry`, `buy_rates` table populated)

---

## Critical Implementation Rule

> **All monetary arithmetic uses `decimal.Decimal`.** Never use Python `float` for any calculation that produces a value stored in the database or shown to the user. Violating this rule is a blocker.

---

## Features

### F04.1 — FastAPI Service Bootstrap

**Description:** Set up the Python Financial Engine as a standalone FastAPI service.

**Tasks:**
- [ ] Initialize Python project in `services/financial-engine/` with `pyproject.toml` (Poetry or uv)
- [ ] Install: `fastapi`, `uvicorn`, `psycopg2-binary` (or `asyncpg`), `pydantic`, `python-dotenv`
- [ ] Create `main.py` with FastAPI app instance and health check: `GET /health → { "status": "ok" }`
- [ ] Create database connection module using connection string from `DATABASE_URL` env var
- [ ] Add `Dockerfile` for this service (already tracked in E01, but finalize Python-specific config here)
- [ ] Configure `pip audit` in CI for this service's dependencies

**Acceptance Criteria:**
- `GET /health` returns `200 { "status": "ok" }` when the service starts.
- Service refuses to start if `DATABASE_URL` is not set.
- All arithmetic modules import `from decimal import Decimal` — no `float` usage for money.

---

### F04.2 — Texas Sales Tax Calculator

**Description:** Implement the Texas 6.25% sales tax calculation with tax credit override.

**Tasks:**
- [x] Implement `calculate_texas_tax(adjusted_selling_price: Decimal) -> Decimal`:
  ```python
  TX_SALES_TAX_RATE = Decimal("0.0625")
  return (adjusted_selling_price * TX_SALES_TAX_RATE).quantize(Decimal("0.01"))
  ```
- [x] Add override: if `tax_credit_flag = True`, return `Decimal("0.00")` immediately
- [x] Write unit tests:
  - Standard calculation: `$30,000 × 6.25% = $1,875.00`
  - Tax credit override: returns `$0.00` regardless of price
  - Edge: `$0` selling price returns `$0.00`
  - Precision: result is always rounded to the cent (2 decimal places)

**Acceptance Criteria:**
- All 4 unit test cases pass.
- No `float` type used in implementation or tests.

---

### F04.3 — EMP & TCOL Calculator

**Description:** Compute Total Cost of Lease (TCOL) and Effective Monthly Payment (EMP) using default fee assumptions when fees are not found in the scrape.

**Tasks:**
- [ ] Define fee defaults as named constants (spec §6.3):
  ```python
  DEFAULT_ACQUISITION_FEE = Decimal("895.00")
  DEFAULT_DOC_FEE = Decimal("150.00")
  ```
- [ ] Implement `calculate_emp(monthly_payment, term_months, due_at_signing, acquisition_fee, doc_fee, texas_tax) -> Decimal` per spec §6.3 formula
- [ ] Implement `calculate_tcol(monthly_payment, term_months, due_at_signing, acquisition_fee, doc_fee, texas_tax) -> Decimal`
- [ ] When `acquisition_fee` is `None` from the scrape, substitute `DEFAULT_ACQUISITION_FEE`; same for `doc_fee`
- [ ] Write unit tests with at least 5 cases including:
  - Standard lease (spec example: $349/mo × 36 + fees + $1,881.25 TX tax)
  - Zero down payment
  - Tax credit applied (texas_tax = 0)
  - Default fee substitution
  - Balloon finance (same formula, different transaction type label)

**Acceptance Criteria:**
- EMP calculations match manual spreadsheet verification within ±$1.00 (spec §12 accuracy requirement).
- All 5+ unit tests pass.
- `calculate_emp` and `calculate_tcol` are pure functions with no side effects.

---

### F04.4 — Money Factor Markup Detection

**Description:** Compare the scraped implied Money Factor against the `buy_rates` table to detect dealer markup.

**Tasks:**
- [x] Implement `detect_mf_markup(implied_mf: Decimal, buy_rate_mf: Decimal) -> bool`:
  ```python
  MARKUP_THRESHOLD = Decimal("0.0004")
  return (implied_mf - buy_rate_mf) > MARKUP_THRESHOLD
  ```
- [x] Implement `classify_mf_risk(money_factor: Decimal) -> str` returning `"Low"`, `"Moderate"`, `"High"`, or `"Very High"` per the thresholds in spec §6.1
- [x] Implement `get_buy_rate(make, model, trim, year, month_year) -> Optional[Decimal]`: query the `buy_rates` table
- [x] If no buy rate found for the vehicle, set `mf_markup_flag = None` (indeterminate — spec §6.1)
- [x] Flag any `money_factor > Decimal("0.00220")` as the 2026 market average threshold (spec §6.1)
- [x] Implement APR conversion: `mf_to_apr(mf: Decimal) -> Decimal` = `mf * 2400`

**Unit Tests (minimum 5 per function):**
- `detect_mf_markup(0.00220, 0.00175)` → `True` (delta = 0.00045 > threshold)
- `detect_mf_markup(0.00210, 0.00175)` → `False` (delta = 0.00035 ≤ threshold)
- `classify_mf_risk(Decimal("0.00100"))` → `"Low"`
- `classify_mf_risk(Decimal("0.00250"))` → `"High"` (spec §6.1: 0.00176–0.00250 = "High"; `"Very High"` requires > 0.00250)
- `classify_mf_risk(Decimal("0.00251"))` → `"Very High"`
- No buy rate found → `mf_markup_flag` is `None`

**Acceptance Criteria:**
- All unit tests pass.
- APR conversion is bidirectional and lossless within the `Decimal` precision used.
- `classify_mf_risk` band boundaries follow spec §6.1: MF `0.00250` maps to `"High"`; only MF `> 0.00250` maps to `"Very High"`.

---

### F04.5 — MPMR Scoring

**Description:** Compute the Monthly Payment to MSRP Ratio and assign a score component.

**Implementation:** `services/financial-engine/app/mpmr.py` · Tests: `services/financial-engine/tests/test_mpmr.py` (33 tests, all passing)

**Tasks:**
- [x] Implement `calculate_mpmr(emp: Decimal, msrp: Decimal) -> Decimal`:
  - Returns `(emp / msrp).quantize(Decimal("0.000001"))` — 6 decimal places
- [x] Implement `mpmr_score(mpmr: Decimal) -> int` per spec §6.4.
  Bracket boundaries are named `Decimal` constants (no inline float literals):
  ```python
  _UNICORN_UPPER     = Decimal("0.0085")
  _EXCELLENT_UPPER   = Decimal("0.0090")
  _COMPETITIVE_UPPER = Decimal("0.0100")
  _AVERAGE_UPPER     = Decimal("0.0115")

  if mpmr <= _UNICORN_UPPER:     return 100
  if mpmr <= _EXCELLENT_UPPER:   return 85
  if mpmr <= _COMPETITIVE_UPPER: return 70
  if mpmr <= _AVERAGE_UPPER:     return 50
  return 25
  ```
- [x] Implement `get_mpmr_category(mpmr: Decimal) -> str` returning `"Unicorn Deal"`, `"Excellent Deal"`, `"Competitive Deal"`, `"Average Deal"`, `"Sub-Optimal Deal"` — reuses the same named boundary constants as `mpmr_score`
- [x] Unit tests: 33 tests across 4 classes — `TestThresholdConstants`, `TestCalculateMpmr`, `TestMpmrScore`, `TestGetMpmrCategory`; covers all 5 bracket interiors, all 4 exact boundary values, zero EMP, 6-decimal precision, and return type assertions

**Acceptance Criteria:**
- All 33 unit tests pass (`pytest tests/test_mpmr.py` — 33 passed in 0.07s).
- All bracket boundary values (0.0085, 0.0090, 0.0100, 0.0115) map to the correct score and category.
- `calculate_mpmr` signature accepts only `emp` and `msrp` — no `advertised_monthly` parameter exists.
- No `float` literals in `mpmr.py` or `test_mpmr.py`; all thresholds are `Decimal` constants.

---

### F04.6 — Market Price Score

**Description:** Compare a listing's `addonAdjustedPrice` against the rolling 30-day regional average for the same `(make, model, trim, year)`.

**Tasks:**
- [x] Implement `get_regional_avg(make, model, trim, year) -> Optional[Decimal]`:
  - Query `listings` table for the rolling 30-day average `addon_adjusted_price` for the matching vehicle spec
  - Return `None` if fewer than 3 comparable listings exist (insufficient data)
- [x] Implement `market_price_score(dealer_price: Decimal, regional_avg: Decimal) -> int` per spec §6.5:
  ```python
  ratio = dealer_price / regional_avg
  if ratio <= 0.95: return 100
  elif ratio <= 1.00: return 80
  elif ratio <= 1.05: return 60
  else: return 20
  ```
- [x] When `regional_avg` is `None`, return a neutral score of `60` (default)
- [x] Unit tests: all 4 score bands + `None` regional average case

**Acceptance Criteria:**
- All 5 unit test cases pass.
- Query uses a parameterized statement — no string interpolation of make/model/trim/year values.

---

### F04.7 — Finance Integrity Score

**Description:** Score the quality of financing based on MF markup flag and risk level.

**Tasks:**
- [x] Implement `finance_integrity_score(mf_markup_flag: Optional[bool], mf_risk_level: str) -> int` per spec §6.5:
  ```python
  if mf_markup_flag is None: return 60  # indeterminate
  if not mf_markup_flag: return 100
  if mf_risk_level == "High": return 50
  return 20  # Very High markup
  ```
- [x] Unit tests: no markup, high markup, very high markup, indeterminate (no buy rate)

**Acceptance Criteria:**
- All 4 unit test cases pass.

---

### F04.8 — Deal Score Composite Algorithm

**Description:** Combine the three component scores into the final 0–100 Deal Score.

**Tasks:**
- [x] Implement `calculate_deal_score(mpmr_s: int, market_s: int, finance_s: int) -> int`:
  ```python
  raw = (mpmr_s * 0.50) + (market_s * 0.30) + (finance_s * 0.20)
  return round(raw)
  ```
- [x] Apply the `balloon_finance` bonus: if `transaction_type = 'balloon'`, add 5 points before clamping (spec §9.3)
- [x] Clamp final score to `[0, 100]`
- [x] Write an orchestrator function `score_listing(listing: NormalizedListing) -> ScoredListing` that calls F04.2–F04.8 in sequence and returns the fully computed listing
- [x] Unit tests: at least 5 cases including a known "Unicorn Deal" (score ~95+), a known "Sub-Optimal" deal (score ~30), and a balloon finance listing with the +5 bonus

**Acceptance Criteria:**
- Deal Score variance vs. manual spreadsheet calculation is **≤ ±2 points** on 20 test listings (spec §13 Phase 2 DoD).
- All 5+ unit tests pass.
- The `score_listing` function is the single entry point — no scattered calls to sub-functions from outside this module.

---

### F04.9 — Reverse Search Solver

**Description:** Given budget constraints, solve for the maximum vehicle selling price that keeps EMP within budget.

**Tasks:**
- [x] Implement `solve_max_selling_price(desired_monthly, down_payment, term_months, avg_apr) -> Decimal` per spec §6.6 using the standard PV of annuity formula
- [x] Use `avg_apr` as the current Laredo market average (5.3% unless overridden by a query parameter)
- [x] For lease Reverse Search, apply the same Texas tax and fee back-calculation as in spec §6.6
- [x] Expose as a FastAPI endpoint: `POST /solve` accepting the request body from spec §7 (`/reverse-search`)
- [x] Validate inputs: `desired_monthly` must be > 0; `term_months` must be in `{24, 36, 48, 60}`; `down_payment` must be ≥ 0
- [x] Unit tests:
  - Known input/output: `$550/mo, $2,500 down, 36 months, 5.3% APR` → verify result is in a reasonable range
  - Edge: `down_payment = 0`
  - Edge: maximally short term (24 months)
  - Invalid `term_months` → raises `ValidationError`

**Acceptance Criteria:**
- All 4 unit tests pass.
- The solver never returns a negative `max_selling_price`.
- Input validation rejects out-of-range values before any calculation runs.

---

### F04.10 — OBBBA Interest Deduction Module

**Description:** Calculate estimated federal interest deduction savings for US-assembled financed vehicles under OBBBA 2026.

**Tasks:**
- [x] Implement `calculate_obbba_monthly_savings(loan_amount, apr, tax_bracket_pct, term_months) -> Decimal` per spec §10.2
- [x] Cap `annual_deductible` at `Decimal("10000.00")` (spec §10.1)
- [x] Implement eligibility check: `is_obbba_eligible(assembly_country, transaction_type) -> bool`
  - Returns `True` only if `assembly_country = 'US'` AND `transaction_type = 'finance'`
- [x] Expose as FastAPI endpoint: `GET /obbba/{listing_id}` returning the structure from spec §7 (`/listings/:id/obbba`)
- [x] Unit tests:
  - US-assembled financed vehicle: returns non-zero savings for each bracket
  - Lease vehicle: `is_obbba_eligible` returns `False`
  - Foreign-assembled vehicle: `is_obbba_eligible` returns `False`
  - High-value loan hitting the $10,000 cap: `annual_deductible` is clamped correctly

**Acceptance Criteria:**
- All 4 unit tests pass.
- Monthly savings figures match for all 4 bracket options (22%, 24%, 32%, 35%) as shown in spec §7 example response.

---

## Testing Summary

Each feature in this epic must have **≥ 5 unit tests**. Use `pytest`. All tests must be pure — no database or network calls. Use fixtures or `unittest.mock` for the database query in F04.6 and F04.10.

**Phase 2 Definition of Done:** Deal Score variance vs. manual spreadsheet ≤ ±2 points on 20 test listings.

---

## Dependencies for Downstream Epics

| Downstream Epic | Requires from E04 |
|---|---|
| E05 (Core API) | All computed fields written to `listings` table; `POST /solve` endpoint; `GET /obbba/{id}` endpoint |
