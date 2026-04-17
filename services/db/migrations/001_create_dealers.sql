-- Migration: 001_create_dealers
-- Creates the dealers table (spec §4.1)

-- Up
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
