-- Migration: 003_create_dealer_addons
-- Creates the dealer_addons table (spec §4.1)
-- Depends on: 002_create_listings

-- Up
CREATE TABLE dealer_addons (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id    UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    addon_name    TEXT NOT NULL,                 -- e.g. "Window Tint", "Nitrogen Fill"
    detected_cost NUMERIC(8,2),
    is_mandatory  BOOLEAN DEFAULT TRUE,
    keyword_match TEXT NOT NULL,               -- raw keyword that triggered detection
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
