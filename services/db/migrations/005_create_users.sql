-- Migration: 005_create_users
-- Creates the users and saved_searches tables (spec §4.1)
-- Depends on: 001_create_dealers (no FK, but logical ordering)

-- Up
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
