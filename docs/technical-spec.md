# Laredo Automotive Market Intelligence Platform — Development Technical Specification

**Version:** 1.0  
**Date:** April 16, 2026  
**Status:** Draft

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Data Models & Database Schema](#4-data-models--database-schema)
5. [Scraping & Data Ingestion Layer](#5-scraping--data-ingestion-layer)
6. [Financial Intelligence Engine](#6-financial-intelligence-engine)
7. [API Specification](#7-api-specification)
8. [UX / UI Specification](#8-ux--ui-specification)
9. [Texas Tax & Regulatory Logic](#9-texas-tax--regulatory-logic)
10. [OBBBA Federal Deduction Module](#10-obbba-federal-deduction-module)
11. [Security & Compliance](#11-security--compliance)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Development Phases & Roadmap](#13-development-phases--roadmap)
14. [Open Questions & Assumptions](#14-open-questions--assumptions)

---

## 1. Project Overview

### 1.1 Purpose

The Laredo Automotive Market Intelligence Platform is a web and mobile application that transforms raw dealership listing data from the Laredo, Texas market into actionable, payment-first deal intelligence. It directly addresses the **"Texas Tax Problem"** (6.25% sales tax levied on full vehicle value at lease registration) and exposes hidden dealer markups, mandatory add-ons, and inflated Money Factors that erode advertised deals.

### 1.2 Core User Problem

> "I see a $399/month advertisement but walk out of the dealership owing $550/month because of Texas tax, dealer add-ons, and a marked-up interest rate I didn't understand."

### 1.3 Primary User Personas

| Persona | Description | Key Need |
|---|---|---|
| **Budget Shopper** | Laredo resident, mobile-first, Spanish/English bilingual | Know the true all-in monthly payment before visiting the dealer |
| **Cross-Border Shopper** | Mexican national purchasing for Texas-titled use | Understand one-time tax cost vs. monthly cost tradeoff |
| **Deal Optimizer** | Enthusiast or fleet buyer who reads fine print | Detect Money Factor markups and mandatory add-on inflation |

### 1.4 Scope

- **Dealerships in scope (Phase 1):** Sames Auto Group, Powell Watson Auto Group
- **Makes in scope:** Nissan, Ford, Honda, Kia, Mazda, RAM, Chevrolet, Toyota, GMC, Buick, Mercedes-Benz
- **Transaction types:** New vehicle lease, retail finance (purchase loan), balloon financing
- **Geography:** Laredo, TX (ZIP codes 78040–78046)

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│            Web App (React)  ←→  Mobile App (React Native)          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS / REST + WebSocket
┌───────────────────────────────▼─────────────────────────────────────┐
│                           API GATEWAY                               │
│               (Rate limiting, Auth, Request routing)                │
└──────┬───────────────────────┬──────────────────────────────────────┘
       │                       │
┌──────▼──────┐       ┌────────▼────────┐
│  Auth       │       │  Core API       │
│  Service    │       │  Service        │
│  (JWT/OAuth)│       │  (Node.js)      │
└─────────────┘       └────────┬────────┘
                               │
          ┌────────────────────┼──────────────────────┐
          │                    │                      │
┌─────────▼──────┐   ┌─────────▼──────┐   ┌──────────▼──────┐
│  Financial     │   │  Scrape         │   │  Notification   │
│  Engine        │   │  Orchestrator   │   │  Service        │
│  (Python)      │   │  (Node.js)      │   │  (Node.js)      │
└─────────┬──────┘   └─────────┬──────┘   └─────────────────┘
          │                    │
          │          ┌─────────▼──────┐
          │          │  Scraper Fleet  │
          │          │  (Playwright +  │
          │          │   Proxy Pool)   │
          │          └─────────┬──────┘
          │                    │
┌─────────▼────────────────────▼──────────────────────────────────────┐
│                         DATA LAYER                                  │
│   PostgreSQL (normalized)  │  Redis (cache/queues)  │  S3 (raw HTML)│
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

| Component | Responsibility |
|---|---|
| **Scrape Orchestrator** | Schedules and dispatches scrape jobs per dealer/platform; manages job queues via Redis |
| **Scraper Fleet** | Playwright browser instances that render JS-heavy dealer sites; rotates proxies; persists raw HTML to S3 |
| **Financial Engine** | Ingests normalized listings; computes EMP, TCOL, MPMR, Deal Score, OBBBA savings, Tax Amortization |
| **Core API Service** | Exposes REST endpoints; handles Reverse Search query solving; serves enriched listing data |
| **Auth Service** | Manages user accounts, JWT issuance, saved searches, and alert preferences |
| **Notification Service** | Sends push/email alerts when a watched vehicle hits a Deal Score threshold |

---

## 3. Tech Stack

| Layer | Technology | Justification |
|---|---|---|
| **Frontend Web** | React 19 + TypeScript | Component reuse with mobile; strong TS ecosystem |
| **Frontend Mobile** | React Native (Expo) | Code sharing with web; iOS + Android from one codebase |
| **Backend API** | Node.js 22 (Express or Fastify) | Non-blocking I/O suits real-time listing feeds |
| **Financial Engine** | Python 3.13 (FastAPI) | Numerical precision with `decimal` stdlib; easy formula unit testing |
| **Scraper Runtime** | Node.js + Playwright | First-class JS rendering; Chromium control for anti-bot evasion |
| **Job Queue** | Redis + BullMQ | Reliable retry logic and priority queues for scrape scheduling |
| **Primary Database** | PostgreSQL 16 | Relational integrity for normalized listings; JSONB for raw data |
| **Cache** | Redis | Computed Deal Scores cached per listing; TTL = 1 hour |
| **Blob Storage** | AWS S3 (or Cloudflare R2) | Archive raw HTML pages for auditing and re-processing |
| **Proxy Management** | Residential proxy pool (e.g., Oxylabs, BrightData) | Required to bypass Cloudflare/Akamai on dealer sites |
| **CI/CD** | GitHub Actions | Automated test → build → deploy pipeline |
| **Hosting** | AWS (ECS Fargate) or Railway | Containerized microservices; scale scraper fleet independently |
| **Monitoring** | Datadog or Grafana + Prometheus | Scrape success rates, API latency, engine error tracking |

---

## 4. Data Models & Database Schema

### 4.1 Core Entities (PostgreSQL)

#### `dealers`
```sql
CREATE TABLE dealers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,                   -- e.g. "Sames Laredo Nissan"
    group_name    TEXT,                            -- e.g. "Sames Auto Group"
    platform      TEXT NOT NULL,                  -- 'dealer.com' | 'sincro' | 'dealeron' | 'dealer_inspire'
    base_url      TEXT NOT NULL,
    inventory_url TEXT NOT NULL,
    specials_url  TEXT,
    zip_code      CHAR(5) NOT NULL DEFAULT '78040',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `listings`
```sql
CREATE TABLE listings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id             UUID NOT NULL REFERENCES dealers(id),
    vin                   CHAR(17) NOT NULL,
    year                  SMALLINT NOT NULL,
    make                  TEXT NOT NULL,
    model                 TEXT NOT NULL,
    trim                  TEXT,
    msrp                  NUMERIC(10,2) NOT NULL,
    selling_price         NUMERIC(10,2),           -- "Adjusted Selling Price" after normalization
    transaction_type      TEXT NOT NULL,           -- 'lease' | 'finance' | 'balloon'
    -- Lease fields
    advertised_monthly    NUMERIC(8,2),
    money_factor          NUMERIC(8,6),
    residual_percent      NUMERIC(5,2),
    lease_term_months     SMALLINT,
    due_at_signing        NUMERIC(10,2),
    -- Finance fields
    apr_percent           NUMERIC(5,3),
    loan_term_months      SMALLINT,
    -- Computed (by Financial Engine)
    effective_monthly     NUMERIC(8,2),
    tcol                  NUMERIC(12,2),
    mpmr                  NUMERIC(6,4),
    deal_score            SMALLINT,               -- 0-100
    mf_markup_flag        BOOLEAN DEFAULT FALSE,
    addon_adjusted_price  NUMERIC(10,2),
    -- Assembly/OBBBA
    assembly_country      CHAR(2),               -- ISO 3166-1 alpha-2
    assembly_plant        TEXT,
    obbba_eligible        BOOLEAN DEFAULT FALSE,
    -- Metadata
    raw_s3_key            TEXT,
    scraped_at            TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_listings_vin ON listings(vin);
CREATE INDEX idx_listings_dealer ON listings(dealer_id);
CREATE INDEX idx_listings_deal_score ON listings(deal_score DESC);
CREATE INDEX idx_listings_effective_monthly ON listings(effective_monthly);
```

#### `dealer_addons`
```sql
CREATE TABLE dealer_addons (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id    UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    addon_name    TEXT NOT NULL,                 -- e.g. "Window Tint", "Nitrogen Fill"
    detected_cost NUMERIC(8,2),
    is_mandatory  BOOLEAN DEFAULT TRUE,
    keyword_match TEXT NOT NULL,               -- raw keyword that triggered detection
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `buy_rate_database`
```sql
CREATE TABLE buy_rates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    make          TEXT NOT NULL,
    model         TEXT NOT NULL,
    trim          TEXT,
    year          SMALLINT NOT NULL,
    month_year    DATE NOT NULL,               -- first day of the applicable month
    base_mf       NUMERIC(8,6) NOT NULL,       -- manufacturer base money factor
    residual_24   NUMERIC(5,2),
    residual_36   NUMERIC(5,2),
    residual_48   NUMERIC(5,2),
    source        TEXT NOT NULL,               -- 'leasehackr' | 'manual' | 'api'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (make, model, trim, year, month_year)
);
```

#### `users` and `saved_searches`
```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    language_pref CHAR(2) DEFAULT 'en',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE saved_searches (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    max_monthly       NUMERIC(8,2),
    max_down          NUMERIC(8,2),
    term_months       SMALLINT,
    preferred_makes   TEXT[],
    score_threshold   SMALLINT DEFAULT 70,
    alert_enabled     BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 Computed Field Definitions

| Field | Formula | Notes |
|---|---|---|
| `effective_monthly` | `(TCOL) / term_months` | See §6.3 for TCOL definition |
| `mpmr` | `effective_monthly / msrp` | Used for deal quality category |
| `deal_score` | Weighted composite 0–100 | See §6.4 |
| `addon_adjusted_price` | `selling_price + SUM(mandatory addon detected costs)` | Used in all score calculations |

---

## 5. Scraping & Data Ingestion Layer

### 5.1 Supported Platforms & Strategies

| Platform | Laredo Dealers | Inventory URL Pattern | Extraction Method |
|---|---|---|---|
| **Dealer.com** | Sames Laredo Nissan | `/new-inventory/index.htm` | JSON-LD `@type: Car` extraction |
| **Sincro** | Toyota of Laredo | `/searchnew.aspx` | Internal JSON price stack (XHR intercept) |
| **DealerOn** | Regional generic | `/inventory/new/` | HTML data-attributes + wait-for-element |
| **Dealer Inspire** | Regional generic | `/new-vehicles/` | Async API feed intercept |

### 5.2 Playwright Scraper Architecture

```
ScraperJob
├── LaunchBrowser()          // Chromium with stealth plugin
├── SetProxy(residential)    // Rotate from proxy pool
├── NavigateTo(dealer.url)
├── WaitForSelector(target)  // Wait for final "Selling Price" to render
├── InterceptXHR()           // Capture async pricing API calls (DealerOn/Dealer Inspire)
├── ExtractJsonLd()          // Parse JSON-LD for Dealer.com
├── ExtractPriceStack()      // Parse internal JSON for Sincro
├── ExtractHtmlAttributes()  // Fallback HTML parser
├── ExtractSpecialsFineprint()// Regex loop over repeating "Special" cards
└── PersistRawHtml(S3)
```

#### 5.2.1 Anti-Bot Evasion Requirements
- Use `playwright-extra` with `stealth` plugin to mask headless browser fingerprints
- Randomize viewport size, user-agent string, and Accept-Language headers
- Implement variable scroll speed (100–400ms between scrolls) and random mouse movement paths
- Rotate residential proxies per request; do not reuse proxy IPs within a 15-minute window for the same dealer domain
- Implement exponential back-off on HTTP 429 / Cloudflare challenge responses (max 3 retries, base delay 8s)

#### 5.2.2 Scrape Schedule

| Dealer Group | Frequency | Rationale |
|---|---|---|
| Sames Auto Group | Every 6 hours | High inventory turnover |
| Powell Watson Group | Every 6 hours | High inventory turnover |
| Specials pages (all) | Every 12 hours | Monthly incentive programs updated less frequently |
| Buy Rate Database | Monthly (1st of month) | Aligns with manufacturer incentive calendar |

### 5.3 Data Normalization Layer

The normalization service maps dealer-specific price terminology to the canonical `adjusted_selling_price` field before any financial calculations are applied.

**Field Normalization Map:**

```json
{
  "adjusted_selling_price": [
    "Sames Price",
    "Internet Price",
    "Market Value",
    "Dealer Discount Price",
    "e-Price",
    "Online Price",
    "Discounted Price"
  ]
}
```

**Rebate Detection:** The normalization layer must detect whether `adjusted_selling_price` already includes manufacturer rebates by checking for keywords: `"after rebates"`, `"includes $X rebate"`, `"with loyalty bonus"`. If detected, the rebate amount must be logged separately in `listings.raw_data` (JSONB) and not double-subtracted in the Deal Score.

### 5.4 Dealer Add-on Detection Engine

The keyword-matching engine scans the raw listing body and fine-print text for mandatory add-on patterns. Detection is case-insensitive.

| Trigger Keywords | Canonical Name | Cost Range | Deal Score Penalty |
|---|---|---|---|
| `"window tint"`, `"tinted windows"`, `"window film"` | Window Tint | $399–$799 | High |
| `"nitrogen"`, `"n2 fill"`, `"nitrogen tires"` | Nitrogen Fill | $199–$299 | Extreme |
| `"ceramic coat"`, `"paint protection"`, `"ceramic shield"` | Ceramic Coating | $995–$1,495 | High |
| `"vin etch"`, `"vehicle identification"`, `"theft protection"` | VIN Etching | $299–$599 | High |
| `"interior protection"`, `"fabric protection"`, `"scotchgard"` | Interior Protection | $195–$395 | Moderate |
| `"protection package"`, `"laredo package"`, `"dealer installed"` | Generic Package | Parsed from text | High |

When a mandatory add-on is detected, the midpoint of the cost range is used in `addon_adjusted_price` unless an explicit dollar amount is found in the text via regex: `\$[\d,]+`.

### 5.5 VIN Enrichment

After scraping, every VIN is decoded against the **NHTSA vPIC API** (`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/{vin}?format=json`) to populate:
- `assembly_country`
- `assembly_plant`
- `obbba_eligible` (set `TRUE` if `assembly_country = 'US'`)

This is a free, rate-limit-friendly public API and requires no authentication.

---

## 6. Financial Intelligence Engine

All financial calculations are implemented in the **Python Financial Engine** service using the `decimal.Decimal` type for monetary precision. No floating-point arithmetic is used for money.

### 6.1 Money Factor ↔ APR Conversion

```
APR (%) = Money Factor × 2400
Money Factor = APR (%) / 2400
```

**Markup Detection Logic:**

```python
def detect_mf_markup(implied_mf: Decimal, buy_rate_mf: Decimal) -> bool:
    MARKUP_THRESHOLD = Decimal("0.0004")
    return (implied_mf - buy_rate_mf) > MARKUP_THRESHOLD
```

**MF Risk Classification:**

| Money Factor | Equivalent APR | Risk Level |
|---|---|---|
| ≤ 0.00100 | ≤ 2.4% | Low (likely base rate) |
| 0.00101–0.00175 | 2.4%–4.2% | Moderate (standard 2026 rate) |
| 0.00176–0.00250 | 4.2%–6.0% | High (potential dealer markup) |
| > 0.00250 | > 6.0% | Very High (subprime or heavy markup) |

The engine flags any `money_factor > 0.00220` (the 2026 market average of 5.3% APR) unless `buy_rates` has no record for that vehicle, in which case the flag is set to `NULL` (indeterminate).

### 6.2 Texas Sales Tax Calculation

Texas levies **6.25%** tax on the full retail sale/lease price at the time of registration — not on monthly payments.

```python
TX_SALES_TAX_RATE = Decimal("0.0625")

def calculate_texas_tax(adjusted_selling_price: Decimal) -> Decimal:
    return (adjusted_selling_price * TX_SALES_TAX_RATE).quantize(Decimal("0.01"))
```

**Tax Credit Detection:** During scraping, the fine-print text is scanned for the following keywords indicating a lender tax credit (e.g., NMAC Special Program). If detected, `texas_tax` is set to `0` for that listing and a `tax_credit_flag = TRUE` is stored.

- `"tax relief"`, `"lender tax credit"`, `"0% sales tax"`, `"nmac special program"`, `"tax credit applied"`

### 6.3 Total Cost of Lease (TCOL) & Effective Monthly Payment (EMP)

```
TCOL = (Monthly Payment × Term) + Due at Signing + Acquisition Fee + Doc Fee + Texas Tax

EMP = TCOL / Term (months)
```

```python
def calculate_emp(
    monthly_payment: Decimal,
    term_months: int,
    due_at_signing: Decimal,
    acquisition_fee: Decimal,
    doc_fee: Decimal,
    texas_tax: Decimal,
) -> Decimal:
    tcol = (monthly_payment * term_months) + due_at_signing + acquisition_fee + doc_fee + texas_tax
    return (tcol / term_months).quantize(Decimal("0.01"))
```

**Default Fee Assumptions** (used when not found in scrape):

| Fee | Default Value | Source |
|---|---|---|
| Acquisition Fee | $895 | Industry standard for Laredo market |
| Doc Fee | $150 | Texas average (not capped by state law) |
| First Month's Payment | Included in `due_at_signing` | Per standard lease structure |

### 6.4 Monthly Payment to MSRP Ratio (MPMR) & Deal Quality

```
MPMR = EMP / MSRP
```

| Category | MPMR Threshold | Weighting Factor | Color Code |
|---|---|---|---|
| **Unicorn Deal** | ≤ 0.0100 (≤ 1%) | 1.00 (max score) | Green |
| **Excellent Deal** | ≤ 0.0085 | 0.85 | Green |
| **Competitive Deal** | ≤ 0.0100 | 0.70 | Yellow |
| **Average Deal** | ≤ 0.0115 | 0.50 | Yellow |
| **Sub-Optimal Deal** | > 0.0115 | 0.25 | Red |

> **Note:** MPMR thresholds use `EMP` (not the advertised monthly payment) as the numerator to capture the full cost impact of Texas tax.

### 6.5 Deal Score Algorithm (0–100)

The Deal Score is a weighted composite of three components:

```
Deal Score = (MPMR Score × 0.50) + (Market Price Score × 0.30) + (Finance Integrity Score × 0.20)
```

#### Component 1: MPMR Efficiency Score (50% weight)
Maps the MPMR weighting factor (0.25–1.00) to a 0–100 scale.

```python
def mpmr_score(mpmr: Decimal) -> int:
    if mpmr <= Decimal("0.0085"):   return 100
    elif mpmr <= Decimal("0.0090"): return 85
    elif mpmr <= Decimal("0.0100"): return 70
    elif mpmr <= Decimal("0.0115"): return 50
    else:                           return 25
```

#### Component 2: Market Price Parity Score (30% weight)
Compares `addon_adjusted_price` to the rolling 30-day regional average for the same `(make, model, trim, year)` combination.

```python
def market_price_score(dealer_price: Decimal, regional_avg: Decimal) -> int:
    ratio = dealer_price / regional_avg
    if ratio <= Decimal("0.95"):   return 100  # > 5% below market
    elif ratio <= Decimal("1.00"): return 80   # at or below market
    elif ratio <= Decimal("1.05"): return 60   # up to 5% above market
    else:                          return 20   # more than 5% above market
```

#### Component 3: Finance Integrity Score (20% weight)

```python
def finance_integrity_score(mf_markup_flag: bool, mf_risk_level: str) -> int:
    if not mf_markup_flag:        return 100
    if mf_risk_level == "High":   return 50
    return 20  # Very High markup
```

### 6.6 Reverse Search: Solving for Maximum Target Selling Price

Given user inputs `(desired_monthly_payment, down_payment, term_months)`, the engine solves for the maximum vehicle price that keeps the EMP within budget.

Using the standard loan amortization formula:

$$P = \frac{PMT \times (1 - (1 + r)^{-n})}{r}$$

Where:
- $P$ = Principal (target selling price)
- $PMT$ = Desired monthly payment
- $r$ = Monthly interest rate (current Laredo market average APR ÷ 12)
- $n$ = Term in months

The engine then subtracts expected Texas tax, acquisition fee, and doc fee to arrive at the **maximum `adjusted_selling_price`** used to filter listings.

```python
def solve_max_selling_price(
    desired_monthly: Decimal,
    down_payment: Decimal,
    term_months: int,
    avg_apr: Decimal,
) -> Decimal:
    r = avg_apr / 12 / 100
    # Solve for principal using standard PV of annuity formula
    principal = desired_monthly * (1 - (1 + r) ** (-term_months)) / r
    # Back-calculate: P = selling_price × (1 + TX_TAX) + fees
    # Rearrange: selling_price = (principal - fees) / (1 + TX_TAX)
    estimated_fees = Decimal("1045.00")  # acquisition + doc fee defaults
    max_price = (principal + down_payment - estimated_fees) / (1 + TX_SALES_TAX_RATE)
    return max_price.quantize(Decimal("0.01"))
```

---

## 7. API Specification

### 7.1 Base URL

```
https://api.laredoautointel.com/v1
```

### 7.2 Authentication

All user-specific endpoints require a Bearer JWT in the `Authorization` header. Public listing endpoints are unauthenticated but rate-limited to 60 req/min per IP.

### 7.3 Endpoints

#### `GET /listings`
Returns paginated, enriched listings filtered by query parameters.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `make` | string | Filter by vehicle make (comma-separated) |
| `model` | string | Filter by model |
| `transaction_type` | string | `lease` \| `finance` \| `balloon` |
| `max_effective_monthly` | number | Max EMP in USD |
| `min_deal_score` | integer | Minimum deal score (0–100) |
| `dealer_id` | UUID | Filter to specific dealer |
| `obbba_eligible` | boolean | Filter OBBBA-eligible vehicles only |
| `page` | integer | Page number (default: 1) |
| `per_page` | integer | Results per page (default: 20, max: 50) |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "vin": "1N4BL4BV5NN123456",
      "year": 2026,
      "make": "Nissan",
      "model": "Rogue",
      "trim": "SV AWD",
      "msrp": 32490.00,
      "selling_price": 30100.00,
      "addon_adjusted_price": 31595.00,
      "transaction_type": "lease",
      "advertised_monthly": 349.00,
      "effective_monthly": 489.22,
      "tcol": 17611.92,
      "money_factor": 0.00175,
      "equivalent_apr": 4.2,
      "mf_markup_flag": false,
      "deal_score": 74,
      "deal_quality": "Competitive Deal",
      "texas_tax": 1881.25,
      "tax_credit_flag": false,
      "obbba_eligible": true,
      "assembly_plant": "Smyrna, TN",
      "dealer": {
        "id": "uuid",
        "name": "Sames Laredo Nissan",
        "group": "Sames Auto Group"
      },
      "addons": [
        {
          "name": "Window Tint",
          "estimated_cost": 599.00,
          "is_mandatory": true
        }
      ],
      "scraped_at": "2026-04-16T08:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 142
  }
}
```

---

#### `POST /reverse-search`
Solves for the maximum vehicle price given budget constraints.

**Request Body:**
```json
{
  "desired_monthly": 550.00,
  "down_payment": 2500.00,
  "term_months": 36,
  "transaction_type": "lease",
  "preferred_makes": ["Nissan", "Toyota"],
  "obbba_only": false
}
```

**Response:** Same structure as `GET /listings`, pre-filtered to payment-qualified vehicles. Includes a `reverse_search_summary` object:
```json
{
  "reverse_search_summary": {
    "max_selling_price": 41230.00,
    "assumed_apr": 5.3,
    "texas_tax_included": true
  },
  "data": [ ... ]
}
```

---

#### `GET /listings/:id/disclosure`
Returns the full normalized fine-print text scraped from the dealer listing, with detected add-ons and fee line items highlighted.

---

#### `GET /listings/:id/obbba`
Returns a detailed OBBBA federal interest deduction simulation for a finance scenario.

**Response:**
```json
{
  "vehicle": "2026 Toyota Tundra SR5",
  "assembly_country": "US",
  "assembly_plant": "San Antonio, TX",
  "obbba_eligible": true,
  "estimated_annual_interest": 2800.00,
  "estimated_annual_deduction": 2800.00,
  "tax_bracket_options": [
    { "bracket": "22%", "annual_savings": 616.00, "monthly_savings": 51.33 },
    { "bracket": "24%", "annual_savings": 672.00, "monthly_savings": 56.00 },
    { "bracket": "32%", "annual_savings": 896.00, "monthly_savings": 74.67 },
    { "bracket": "35%", "annual_savings": 980.00, "monthly_savings": 81.67 }
  ]
}
```

---

#### `POST /users/saved-searches`
Saves a Reverse Search configuration for a logged-in user and optionally enables deal score alerts.

---

#### `GET /dealers`
Returns the list of all active scraped dealers with last-scraped timestamps.

---

#### `GET /buy-rates`
Returns current month's buy rates for all tracked makes/models. (Internal use; requires admin JWT role.)

---

## 8. UX / UI Specification

### 8.1 Design Principles

1. **Payment-First:** Monthly payment is always the primary number. MSRP is secondary.
2. **Transparency by Default:** Texas tax and dealer add-ons are shown proactively, not buried.
3. **Mobile-First:** Designed for 390px viewport width. Desktop is an enhanced experience.
4. **Bilingual:** Full English and Spanish localization (i18n via `react-i18next`).

### 8.2 Deal Score Gauge Component

- Rendered as a 0–100 arc gauge (SVG-based, no external chart library required)
- Color bands: Green (85–100), Yellow (70–84), Red (0–69)
- Tapping/clicking the gauge expands a three-row breakdown: MPMR Score / Market Score / Finance Score
- Must be accessible (WCAG 2.1 AA): includes `aria-label` with the score and quality category

### 8.3 Listing Card

Each listing card must surface the following fields at a glance, in priority order:

1. **Deal Score Gauge** (top-right)
2. **Effective Monthly Payment** (large, bold) — labeled "True Monthly (w/ TX Tax)"
3. **Advertised Monthly Payment** (smaller, dimmed) — labeled "Dealer Ad Price"
4. **Vehicle Year / Make / Model / Trim**
5. **Dealer Name** + distance label (if geolocation available)
6. **Transaction Type** badge: `LEASE` / `FINANCE` / `BALLOON`
7. **MF Markup Warning** badge (shown if `mf_markup_flag = true`)
8. **Add-on Alert** count badge (shown if `addons.length > 0`)
9. **OBBBA Eligible** badge (shown if `obbba_eligible = true` and `transaction_type = 'finance'`)

### 8.4 Reverse Search Flow

**Screen 1 — Budget Input:**
```
What's your monthly budget? 
[ $ _____ / month ]

How much can you put down?
[ $ _____ ]

Preferred term:
[ 24 mo ]  [ 36 mo ]  [ 48 mo ]  [ 60 mo ]

Deal type:
[ Lease ]  [ Finance ]  [ Balloon ]

[ Find My Cars → ]
```

**Screen 2 — Results:**
- Header: "X cars under $[budget]/mo in Laredo"
- Sub-header: "Including Texas tax. Sorted by Deal Score."
- Listing cards (see §8.3)
- Filter pills: Make · Dealer · OBBBA Only · No Add-ons

### 8.5 One-Tap Disclosure Panel

A bottom sheet (mobile) or side drawer (desktop) that shows:
- Full scraped fine-print text
- Highlighted add-on line items with detected costs
- Tax credit flag indicator (if `tax_credit_flag = true`, show "Lender Tax Credit Detected")
- Link to live dealer listing (opens in browser)

### 8.6 OBBBA Toggle

Located in the Finance search filter panel:
- Toggle: "Apply OBBBA Interest Deduction"
- When enabled, a tax bracket selector appears: `22% / 24% / 32% / 35%`
- Monthly payments in results recalculate in real-time to show the post-deduction "Real Monthly Cost"

---

## 9. Texas Tax & Regulatory Logic

### 9.1 The Texas Tax Problem

Texas levies **6.25% motor vehicle sales tax on the full retail sales or lease price** at time of registration, not on the monthly payment (unlike 46 other states). This must be disclosed prominently throughout the app and factored into every EMP calculation.

### 9.2 Tax Credit Detection

See §5.4 keyword list. If a lender tax credit is detected, a high-visibility banner is shown on the listing:

> "Lender Tax Credit Detected — This lease may have $0 upfront Texas sales tax. Verify with dealer."

### 9.3 Balloon Financing (Ford Options / BMW Owner's Choice)

Balloon financing is treated as a distinct `transaction_type = 'balloon'` and modeled differently from a standard lease:

| Attribute | Lease | Balloon Finance |
|---|---|---|
| Texas Tax Timing | Upfront, full vehicle value | Upfront, full vehicle value (one-time only) |
| Title Holder | Lender/Bank | Customer |
| End-of-Term Sales Tax | 6.25% again if buying out | None (already titled in customer name) |
| GAP Insurance | Typically included | **Not included — flagged as required add-on** |
| Deal Score Adjustment | Standard | +5 bonus for eliminating double-tax risk |

When `transaction_type = 'balloon'` and `gap_insurance_detected = false`, the API response must include:
```json
"warnings": ["GAP insurance not detected in this balloon finance contract. Consider adding before signing."]
```

---

## 10. OBBBA Federal Deduction Module

### 10.1 Eligibility Rules

1. Vehicle must have `assembly_country = 'US'` (verified via NHTSA vPIC)
2. Transaction type must be `finance` (purchase loan), not `lease` or `balloon`
3. Loan interest eligible for deduction: up to **$10,000/year**
4. Deduction applies per the One Big Beautiful Bill (OBBBA), effective 2026 tax year

### 10.2 Calculation

```python
def calculate_obbba_monthly_savings(
    loan_amount: Decimal,
    apr: Decimal,
    tax_bracket_pct: Decimal,
    term_months: int,
) -> Decimal:
    """
    Approximates average monthly interest for Year 1 using simple amortization,
    then applies the marginal tax rate.
    """
    monthly_rate = apr / 12 / 100
    monthly_payment = loan_amount * monthly_rate / (1 - (1 + monthly_rate) ** (-term_months))
    year1_interest = sum(
        loan_amount * monthly_rate - (monthly_payment - loan_amount * monthly_rate) * i
        for i in range(12)
    )
    annual_deductible = min(year1_interest, Decimal("10000.00"))
    annual_savings = annual_deductible * (tax_bracket_pct / 100)
    return (annual_savings / 12).quantize(Decimal("0.01"))
```

### 10.3 OBBBA-Eligible Vehicles in Laredo Inventory

| Vehicle | Assembly Plant | OBBBA Eligible |
|---|---|---|
| Toyota Tundra | San Antonio, TX | Yes |
| Nissan Frontier | Canton, MS | Yes |
| Ford F-150 | Dearborn, MI | Yes |
| Toyota Camry | Georgetown, KY | Yes |
| Toyota 4Runner | Tahara, Japan | No |

---

## 11. Security & Compliance

### 11.1 OWASP Top 10 Mitigations

| Threat | Mitigation |
|---|---|
| **A01 – Broken Access Control** | JWT with role claims (`user`, `admin`); all routes server-side authorized; saved searches scoped to `user_id` |
| **A02 – Cryptographic Failures** | Passwords hashed with `bcrypt` (cost factor 12); JWT signed with RS256; HTTPS enforced everywhere |
| **A03 – Injection** | All DB queries use parameterized statements (no string concatenation); scraped text sanitized before storage |
| **A04 – Insecure Design** | Rate limiting on public API (60 req/min/IP); Reverse Search inputs validated and clamped to sane ranges |
| **A05 – Security Misconfiguration** | No default credentials; environment secrets via AWS Secrets Manager; security headers (Helmet.js) |
| **A06 – Vulnerable Components** | Automated dependency scanning via Dependabot; no direct `npm audit` failures in CI |
| **A07 – Auth Failures** | JWT expiry 15 min (access) + 7 days (refresh); refresh tokens stored as `HttpOnly` cookies |
| **A09 – Security Logging** | All auth events, scrape errors, and flagged listings logged to Datadog with alert thresholds |

### 11.2 Scraper Legal Considerations

- Scraper only accesses publicly available listing pages (no login-gated data)
- Respects `robots.txt` — scraping is limited to paths not disallowed
- No PII is collected from dealer sites; only vehicle and pricing data is stored
- Raw HTML archives retained for 90 days then deleted (S3 lifecycle policy)

### 11.3 Data Privacy

- No user PII shared with third parties
- Saved searches and alert preferences may be deleted by user at any time
- Geolocation (if used for distance display) is processed client-side only; coordinates are never sent to the API

---

## 12. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Availability** | 99.5% uptime for the API; scraper failures do not affect serving cached listings |
| **Latency** | `GET /listings` p95 < 300ms; `POST /reverse-search` p95 < 500ms |
| **Freshness** | Listings no older than 6 hours (aligns with scrape schedule) |
| **Scalability** | Scraper fleet must scale to 20 concurrent Playwright instances without IP blocking |
| **Accuracy** | EMP calculations must match manual verification within ±$1.00 |
| **Localization** | Full EN/ES support; currency formatted as USD with `Intl.NumberFormat` |
| **Accessibility** | WCAG 2.1 AA compliance on all UI components |
| **Browser Support** | Last 2 major versions: Chrome, Safari, Firefox, Samsung Internet |
| **Mobile** | iOS 16+ and Android 12+ via React Native (Expo managed workflow) |

---

## 13. Development Phases & Roadmap

### Phase 1 — Scraper Resilience *(Weeks 1–4)*

**Goal:** Reliably extract inventory and pricing data from Dealer.com (Sames) and Sincro (Powell Watson).

- [ ] Set up Playwright project with `playwright-extra` and stealth plugin
- [ ] Build residential proxy rotation module
- [ ] Implement JSON-LD extractor for Dealer.com inventory pages
- [ ] Implement XHR intercept extractor for Sincro price stacks
- [ ] Build scrape job queue (Redis + BullMQ)
- [ ] Persist raw HTML to S3
- [ ] Implement NHTSA vPIC VIN enrichment pipeline
- [ ] Build Buy Rate Database seed from Leasehackr API (or manual CSV)
- [ ] Unit tests: extractor functions, anti-bot resilience, VIN decoder

**Definition of Done:** 95% of listings on both platforms are successfully scraped and stored per run.

---

### Phase 2 — Tax Engine & Financial Intelligence *(Weeks 5–8)*

**Goal:** Transform raw listings into scored, enriched financial intelligence.

- [ ] Build Python Financial Engine service (FastAPI)
- [ ] Implement Texas Sales Tax calculator (§6.2)
- [ ] Implement EMP and TCOL calculator (§6.3)
- [ ] Implement MPMR scoring (§6.4)
- [ ] Implement Deal Score composite algorithm (§6.5)
- [ ] Implement MF markup detection against buy_rates table (§6.1)
- [ ] Implement dealer add-on keyword detection engine (§5.4)
- [ ] Implement lender tax credit keyword detection (§9.2)
- [ ] Implement Balloon Finance GAP insurance warning (§9.3)
- [ ] Unit tests: every formula with at least 5 test cases including Texas tax edge cases

**Definition of Done:** Deal Score variance vs. manual spreadsheet calculation ≤ ±2 points on 20 test listings.

---

### Phase 3 — Data Normalization & Core API *(Weeks 9–11)*

**Goal:** Expose enriched data through a production-ready REST API.

- [ ] Build field normalization layer with dealer terminology map
- [ ] Implement `GET /listings` with all filter parameters
- [ ] Implement `POST /reverse-search` with amortization solver
- [ ] Implement `GET /listings/:id/disclosure` endpoint
- [ ] Implement `GET /listings/:id/obbba` endpoint
- [ ] Implement Auth Service (JWT issue/refresh/revoke)
- [ ] Implement `POST /users/saved-searches` endpoint
- [ ] Implement rate limiting and security headers
- [ ] Integration tests for all endpoints

**Definition of Done:** All endpoints return correct data with < 300ms p95 latency under 50 concurrent users.

---

### Phase 4 — UX Launch *(Weeks 12–16)*

**Goal:** Ship a mobile-first, bilingual web app with Reverse Search as the primary entry point.

- [ ] Build Reverse Search input screen (§8.4)
- [ ] Build listing card component with Deal Score gauge (§8.2, §8.3)
- [ ] Build One-Tap Disclosure panel (§8.5)
- [ ] Build OBBBA Toggle module (§8.6)
- [ ] Implement EN/ES i18n strings
- [ ] Implement saved search and alert preferences UI
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Performance audit (Lighthouse score ≥ 85 on mobile)
- [ ] E2E tests (Playwright): Reverse Search flow, disclosure panel, OBBBA toggle
- [ ] Beta launch to 50 Laredo-based testers

**Definition of Done:** Beta testers can complete a Reverse Search from budget input to disclosure panel review in under 60 seconds on a mobile device.

---

## 14. Open Questions & Assumptions

| # | Question | Current Assumption | Owner |
|---|---|---|---|
| 1 | Will Leasehackr grant API access for Buy Rate data? | Fallback: monthly manual CSV import | Backend Lead |
| 2 | Does any Laredo dealer use non-standard platforms not listed in §5.1? | Assumption: all in-scope dealers use Dealer.com, Sincro, or DealerOn | Research |
| 3 | Is the OBBBA $10,000 deduction cap per vehicle or per taxpayer? | Per taxpayer per year | Legal Review |
| 4 | Are bilingual UI strings needed at Phase 4 launch or can ES be post-launch? | Required at launch given cross-border user persona | PM Decision |
| 5 | What is the target pricing model (free, freemium, subscription)? | Out of scope for this spec | Product |
| 6 | Should the scraper archive fine-print text as searchable full-text in PostgreSQL? | Yes, using `tsvector` column on listings table | Backend Lead |
| 7 | Is GAP insurance detectable from dealer listing text, or only from contract documents? | Only from listing fine-print keywords; contract-level detection is out of scope | Backend Lead |

---

*This document is a living specification. All formula implementations must be validated against manual calculations before production deployment. Changes to scoring weights must be approved and logged in the project changelog.*
