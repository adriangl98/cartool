-- Migration: 004_create_buy_rates
-- Creates the buy_rates table (spec §4.1)
-- Depends on: 001_create_dealers (no FK, but logical ordering)

-- Up
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
