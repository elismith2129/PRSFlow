-- ===========================================================================
-- PIN auth support: bcrypt-verify RPC + server-side rate-limit store.
-- Run ONCE in the Supabase SQL editor. No secrets in this file.
-- ===========================================================================

BEGIN;

-- ── Server-side rate-limit store for POST /api/auth/pin (per client IP). ──
-- Only the service role (which bypasses RLS) reads/writes this table; the
-- localStorage lockout in the UI is cosmetic and cannot be trusted.
CREATE TABLE IF NOT EXISTS pin_login_attempts (
  ip           text PRIMARY KEY,
  fail_count   int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pin_login_attempts ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: anon/authenticated get nothing; service role bypasses RLS.

-- ── PIN verification. bcrypt compare happens in Postgres via pgcrypto crypt().
--    SECURITY DEFINER so it can read staff_pins regardless of RLS; EXECUTE is
--    granted ONLY to service_role, so the only way to test a PIN is through the
--    rate-limited server route. Returns the single matched profile (or nothing).
CREATE OR REPLACE FUNCTION verify_staff_pin(p_pin text)
RETURNS TABLE (user_profile_id uuid, email text, auth_user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT up.id, up.email, up.auth_user_id
  FROM staff_pins sp
  JOIN user_profiles up ON up.id = sp.user_profile_id
  WHERE sp.pin_hash = crypt(p_pin, sp.pin_hash)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION verify_staff_pin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO service_role;

COMMIT;
