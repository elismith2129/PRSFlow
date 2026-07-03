-- ===========================================================================
-- sop_acknowledged — first-login SOP gate on user_profiles.
-- Run ONCE in the Supabase SQL editor.
-- ===========================================================================

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS sop_acknowledged boolean NOT NULL DEFAULT false;

-- Any logged-in user must be able to mark THEIR OWN SOP as acknowledged. The
-- user_profiles UPDATE policy is mgr+-only (manager/billing/owner), so a normal
-- browser update would be blocked for asst_manager / tech / runner. This
-- SECURITY DEFINER function flips only this one boolean on the caller's own row
-- (auth.uid()) — it cannot change role or touch anyone else's row.
CREATE OR REPLACE FUNCTION acknowledge_sop()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.user_profiles
  SET sop_acknowledged = true, updated_at = now()
  WHERE auth_user_id = auth.uid()
$$;

REVOKE ALL ON FUNCTION acknowledge_sop() FROM PUBLIC;
REVOKE ALL ON FUNCTION acknowledge_sop() FROM anon;
GRANT EXECUTE ON FUNCTION acknowledge_sop() TO authenticated;

COMMIT;
