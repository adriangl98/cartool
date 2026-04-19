-- Migration: 006_add_disclosure_fields
-- Adds raw fine-print text, tax credit flag, and GAP insurance detection
-- to the listings table (spec §5.4, §9.2, §9.3)
-- Depends on: 002_create_listings

-- Up
ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS raw_fine_print_text  TEXT,
    ADD COLUMN IF NOT EXISTS tax_credit_flag       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS gap_insurance_detected BOOLEAN NOT NULL DEFAULT FALSE;

-- Down
-- ALTER TABLE listings
--     DROP COLUMN IF EXISTS raw_fine_print_text,
--     DROP COLUMN IF EXISTS tax_credit_flag,
--     DROP COLUMN IF EXISTS gap_insurance_detected;
