-- ===========================================================================
-- staff_pins — bcrypt-hashed PIN credentials for numpad login.
-- One row per user_profiles staff member.
--
-- Run ONCE in the Supabase SQL editor.
--
-- The PIN SEED IS DELIBERATELY NOT IN THIS COMMITTED FILE. Plaintext PINs must
-- never enter git history. Seed via the git-ignored file:
--     supabase/seed/staff_pins_seed.local.sql   (run manually, do not commit)
--
-- SECURITY NOTE: the PIN-verification server route uses the SERVICE ROLE key,
-- which bypasses RLS — so these policies do NOT gate login. They only restrict
-- browser/authenticated access to the hash table to owner/manager.
-- ===========================================================================

BEGIN;

-- bcrypt (crypt / gen_salt('bf')). Supabase ships pgcrypto; ensure it exists.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS staff_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- One PIN per staff member (also enables the idempotent ON CONFLICT in the seed).
CREATE UNIQUE INDEX IF NOT EXISTS staff_pins_user_profile_id_key
  ON staff_pins (user_profile_id);

ALTER TABLE staff_pins ENABLE ROW LEVEL SECURITY;

-- Only owner + manager may read/manage PIN hashes.
DROP POLICY IF EXISTS staff_pins_sel ON staff_pins;
CREATE POLICY staff_pins_sel ON staff_pins FOR SELECT TO authenticated
  USING (get_my_role() IN ('owner','manager'));

DROP POLICY IF EXISTS staff_pins_ins ON staff_pins;
CREATE POLICY staff_pins_ins ON staff_pins FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('owner','manager'));

DROP POLICY IF EXISTS staff_pins_upd ON staff_pins;
CREATE POLICY staff_pins_upd ON staff_pins FOR UPDATE TO authenticated
  USING (get_my_role() IN ('owner','manager'))
  WITH CHECK (get_my_role() IN ('owner','manager'));

DROP POLICY IF EXISTS staff_pins_del ON staff_pins;
CREATE POLICY staff_pins_del ON staff_pins FOR DELETE TO authenticated
  USING (get_my_role() IN ('owner','manager'));

COMMIT;
