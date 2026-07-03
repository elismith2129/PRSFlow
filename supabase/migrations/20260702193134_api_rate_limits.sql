-- ===========================================================================
-- api_rate_limits — fixed-window per-IP request limiter for public/API routes.
-- Run ONCE in the Supabase SQL editor. Safe to run immediately (no dependencies).
--
-- Backs the /api/inquiry (3/min) and /api/ocr-receipt (10/min) rate limits.
-- Only the service role (which bypasses RLS) reads/writes this table.
--
-- NOTE: the separate `leads_ins_anon` DROP (so the inquiry server route becomes
-- the only insert path) ships in its own migration and must be run AFTER the
-- inquiry route + page are deployed — not with this one.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket       text NOT NULL,        -- 'inquiry' | 'ocr'
  ip           text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, ip)
);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: anon/authenticated get nothing; service role bypasses RLS.

COMMIT;
