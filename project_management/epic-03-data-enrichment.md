# E03 — Data Enrichment & Normalization

**Phase:** Phase 1 (Weeks 3–4)  
**Goal:** Transform raw scraped listing data into clean, normalized records ready for financial scoring. Enrich VINs with assembly data and detect add-ons and fee-altering keywords.  
**Spec Reference:** §5.3 (Normalization), §5.4 (Add-on Detection), §5.5 (VIN Enrichment), §9.2 (Tax Credit Detection)  
**Depends On:** E02 (raw `RawListing` output from scrapers)

---

## Features

### F03.1 — Field Normalization Layer

**Description:** Map dealer-specific price field names to the canonical `adjusted_selling_price` before any financial calculation.

**Tasks:**
- [ ] Create `NormalizationService` in `services/scraper/` (or a shared `services/normalizer/`):
  - Accept a `RawListing` and return a `NormalizedListing` with `adjustedSellingPrice` populated
  - Apply the normalization map from spec §5.3:
    ```
    "Sames Price", "Internet Price", "Market Value",
    "Dealer Discount Price", "e-Price", "Online Price", "Discounted Price"
    ```
  - Precedence: use the lowest price found across all mapped fields
- [ ] Implement **rebate detection** on `adjustedSellingPrice`:
  - Scan `rawFinePrintText` for keywords: `"after rebates"`, `"includes $X rebate"`, `"with loyalty bonus"`
  - If found, extract the rebate dollar amount via regex `\$[\d,]+` and log it separately
  - Set `rebateDetected: true` and `rebateAmount` on the normalized listing
  - Do **not** subtract the rebate again in scoring (spec §5.3)

**Acceptance Criteria:**
- Given a `RawListing` with `sellingPrice` labeled "Sames Price", `NormalizationService` maps it to `adjustedSellingPrice` correctly.
- Given fine-print text containing `"includes $1,500 rebate"`, the service extracts `rebateAmount = 1500` and sets `rebateDetected = true`.
- Unit tests cover all 7 field name aliases and 3 rebate keyword patterns.

---

### F03.2 — Dealer Add-on Detection Engine

**Description:** Scan fine-print text for mandatory dealer add-ons and compute an `addonAdjustedPrice` used in deal scoring.

**Tasks:**
- [ ] Create `AddonDetector` class:
  - Accept `rawFinePrintText: string`
  - For each entry in the keyword table below, perform a case-insensitive scan
  - When a keyword matches:
    1. Attempt to extract an explicit cost via regex: `\$[\d,]+` in the surrounding 200 characters
    2. If no explicit cost found, use the **midpoint** of the cost range (spec §5.4)
    3. Create a `DetectedAddon` record with `{ addonName, detectedCost, isMandatory: true, keywordMatch }`
  - Return `DetectedAddon[]`

**Keyword Table (from spec §5.4):**

| Trigger Keywords | Canonical Name | Cost Midpoint |
|---|---|---|
| `window tint`, `tinted windows`, `window film` | Window Tint | $599 |
| `nitrogen`, `n2 fill`, `nitrogen tires` | Nitrogen Fill | $249 |
| `ceramic coat`, `paint protection`, `ceramic shield` | Ceramic Coating | $1,245 |
| `vin etch`, `vehicle identification`, `theft protection` | VIN Etching | $449 |
| `interior protection`, `fabric protection`, `scotchgard` | Interior Protection | $295 |
| `protection package`, `laredo package`, `dealer installed` | Generic Package | Parsed from text |

- [ ] Compute `addonAdjustedPrice = adjustedSellingPrice + SUM(detectedAddon.detectedCost)` where `isMandatory = true`
- [ ] Persist detected add-ons to the `dealer_addons` table, linked to the listing

**Acceptance Criteria:**
- Given fine-print text `"Includes nitrogen-filled tires and window tint ($699)"`, the detector returns 2 `DetectedAddon` records: nitrogen at midpoint ($249) and window tint with explicit cost ($699).
- `addonAdjustedPrice` is correctly computed as `adjustedSellingPrice + 948`.
- Unit tests cover: no add-ons, one add-on with explicit cost, multiple add-ons with no explicit cost, case-insensitive matching.

---

### F03.3 — Lender Tax Credit Detection

**Description:** Detect when a lender (e.g., NMAC) is absorbing the Texas sales tax, and flag the listing accordingly.

**Tasks:**
- [ ] Extend `AddonDetector` (or create a `TaxCreditDetector`) to scan `rawFinePrintText` for:
  - `"tax relief"`, `"lender tax credit"`, `"0% sales tax"`, `"nmac special program"`, `"tax credit applied"`
- [ ] If a match is found:
  - Set `taxCreditFlag = true` on the listing
  - Set `texasTax = 0` for this listing in all financial calculations (overrides the standard §6.2 formula)
- [ ] Log the matched keyword and surrounding 100 characters for auditing

**Acceptance Criteria:**
- Given fine-print containing `"NMAC Special Program — tax credit applied"`, `taxCreditFlag` is `true` and `texasTax` is set to `0`.
- Unit tests cover all 5 keyword variants.
- No false positive: text containing `"no tax credit"` does not trigger the flag (negative test).

---

### F03.4 — GAP Insurance Detection for Balloon Finance

**Description:** On balloon finance listings, detect whether GAP insurance is mentioned in the fine print and flag accordingly.

**Tasks:**
- [ ] Scan `rawFinePrintText` for keywords: `"gap insurance"`, `"gap coverage"`, `"guaranteed asset protection"`
- [ ] If `transactionType = 'balloon'` and no GAP keyword is found:
  - Set `gapInsuranceDetected = false`
  - This triggers a warning in the API response (spec §9.3)
- [ ] If `transactionType = 'balloon'` and GAP keyword is found:
  - Set `gapInsuranceDetected = true`

**Acceptance Criteria:**
- A balloon listing with no GAP keywords returns `gapInsuranceDetected = false`.
- A balloon listing containing `"GAP coverage included"` returns `gapInsuranceDetected = true`.
- Non-balloon listings are not evaluated (field is `null` / not set).

---

### F03.5 — NHTSA VIN Enrichment Pipeline

**Description:** Asynchronously enrich each new listing's VIN with assembly country and plant data from the NHTSA vPIC public API.

**Tasks:**
- [ ] Create `VinEnrichmentWorker` consuming the `enrichment-jobs` BullMQ queue
- [ ] For each listing, call:
  ```
  GET https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/{vin}?format=json
  ```
- [ ] Parse the response for:
  - `Plant Country` → `assemblyCountry` (store as ISO 3166-1 alpha-2, e.g., `"US"`, `"JP"`)
  - `Plant City` + `Plant State` → `assemblyPlant` (e.g., `"Smyrna, TN"`)
- [ ] Set `obbbaEligible = true` if `assemblyCountry = 'US'`
- [ ] Handle API errors gracefully: if vPIC is unavailable, retry up to 3 times with 5s delay; set `assemblyCountry = null` and continue (do not block the listing from being saved)
- [ ] Do not re-enrich a VIN already present in the `listings` table with a non-null `assemblyCountry` (deduplication)

**Acceptance Criteria:**
- VIN `5TFDW5F15HX640000` (Toyota Tundra, San Antonio TX) returns `assemblyCountry = "US"` and `obbbaEligible = true`.
- VIN for a Toyota 4Runner (assembled in Japan) returns `assemblyCountry = "JP"` and `obbbaEligible = false`.
- A previously enriched VIN is not re-fetched from the API (idempotency check).
- Unit tests mock the NHTSA API; no live calls in CI.

---

### F03.6 — Buy Rate Database Seed & Monthly Refresh

**Description:** Populate the `buy_rates` table with manufacturer base Money Factors, enabling the MF markup detection in E04.

**Tasks:**
- [ ] Create a CSV import script: `scripts/seed-buy-rates.ts`
  - Accepts a CSV with columns: `make, model, trim, year, month_year, base_mf, residual_24, residual_36, residual_48`
  - Upserts records (using `ON CONFLICT DO UPDATE`) into the `buy_rates` table
- [ ] Create a BullMQ repeating job: runs on the 1st of each month to re-import updated buy rates (spec §5.2.2)
- [ ] Document the fallback process: if Leasehackr API access is not available, the manual CSV is the source of truth (spec §14, Q1)
- [ ] Seed with known 2026 base data for all in-scope makes (Nissan, Ford, Honda, Kia, Mazda, RAM, Chevrolet, Toyota, GMC, Buick, Mercedes-Benz)

**Acceptance Criteria:**
- `npm run seed:buy-rates -- --file=buy_rates_april_2026.csv` inserts all records without errors.
- Re-running the seed script does not create duplicate records (upsert behavior verified).
- The monthly refresh job is registered in BullMQ and scheduled for the 1st of each month.

---

## Dependencies for Downstream Epics

| Downstream Epic | Requires from E03 |
|---|---|
| E04 (Financial Engine) | F03.1 `adjustedSellingPrice`, F03.2 `addonAdjustedPrice`, F03.3 `taxCreditFlag`, F03.5 `assemblyCountry`, F03.6 `buy_rates` data |
