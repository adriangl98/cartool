-- Migration: 002_create_listings
-- Creates the listings table and all required indexes (spec §4.1)
-- Depends on: 001_create_dealers

-- Up
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

CREATE INDEX idx_listings_vin             ON listings(vin);
CREATE INDEX idx_listings_dealer          ON listings(dealer_id);
CREATE INDEX idx_listings_deal_score      ON listings(deal_score DESC);
CREATE INDEX idx_listings_effective_monthly ON listings(effective_monthly);
