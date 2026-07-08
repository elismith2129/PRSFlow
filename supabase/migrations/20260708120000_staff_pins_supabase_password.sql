-- ===========================================================================
-- staff_pins.supabase_password — a server-generated Supabase Auth password per
-- staff member, enabling one-round-trip PIN login via signInWithPassword()
-- (replaces the slower generateLink + verifyOtp flow).
--
-- Run ONCE in the Supabase SQL editor, THEN run:
--     node --env-file=.env.local scripts/set-staff-passwords.mjs
-- to generate + set the actual passwords (this column stays NULL until then,
-- and the PIN route returns 403 no_account for any row without a password).
--
-- The password is a fully random 32-char secret (NOT derived from the PIN) and
-- is only ever read by the service-role PIN route — never sent to the browser.
-- Same RLS as pin_hash: owner/manager only for authenticated access; the
-- service role bypasses RLS.
-- ===========================================================================

BEGIN;

ALTER TABLE staff_pins ADD COLUMN IF NOT EXISTS supabase_password text;

-- verify_staff_pin must now also return the stored password so the route can
-- sign in within the same call. The RETURNS TABLE signature changes, so the
-- function has to be dropped and recreated (CREATE OR REPLACE cannot alter a
-- function's output columns).
DROP FUNCTION IF EXISTS verify_staff_pin(text);

CREATE OR REPLACE FUNCTION verify_staff_pin(p_pin text)
RETURNS TABLE (user_profile_id uuid, email text, auth_user_id uuid, supabase_password text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT up.id, up.email, up.auth_user_id, sp.supabase_password
  FROM staff_pins sp
  JOIN user_profiles up ON up.id = sp.user_profile_id
  WHERE sp.pin_hash = crypt(p_pin, sp.pin_hash)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION verify_staff_pin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO service_role;

COMMIT;
