-- ─────────────────────────────────────────────────────────────────────────────
-- pin_login_failures — forensics log for FAILED PIN login attempts.
--
-- WHY THIS EXISTS
-- On 29 July 2026 the PIN endpoint took a distributed brute-force attempt:
-- ~50 distinct IPs, roughly one attempt per second, spread deliberately so no
-- single IP tripped the per-IP lockout. We only found out because Eli happened
-- to be looking at the Vercel request log — there was no record of it in the
-- app, and Vercel's logs roll off.
--
-- `pin_login_attempts` can't answer questions after the fact: it holds ONE row
-- per IP (current counter + lock), is deleted on a successful login, and keeps
-- no history. So it tells you the current state and nothing about what happened.
-- This table is the append-only history: every failure, with its source, kept
-- long enough to see a pattern.
--
-- DELIBERATELY NOT STORED: the attempted PIN. Logging guessed PINs would mean
-- that anyone who later read this table could see near-misses against live
-- credentials, and a typo'd real PIN would be sitting in plaintext. The IP and
-- the timing are what make an attack legible; the guess itself adds nothing.
--
-- RETENTION: nothing prunes this automatically. Under normal use it takes a
-- handful of rows a week (staff mistypes). Under attack it takes thousands an
-- hour — which is the point. Delete old rows by hand when it gets large:
--     delete from pin_login_failures where created_at < now() - interval '90 days';
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS pin_login_failures (
  id          bigserial PRIMARY KEY,
  ip          text NOT NULL,
  user_agent  text,
  -- 'incorrect' = wrong PIN. 'locked' = rejected without checking, already
  -- locked out. Distinguishing them shows whether the lockout is actually
  -- absorbing attempts or the attacker is pacing under it.
  outcome     text NOT NULL DEFAULT 'incorrect'
                CHECK (outcome IN ('incorrect', 'locked')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- "What just happened / what happened last night" — the query you actually run.
CREATE INDEX IF NOT EXISTS pin_login_failures_created_at_idx
  ON pin_login_failures (created_at DESC);

-- "How many distinct IPs, and how hard is each one pushing" — the query that
-- distinguishes one stuck device from a distributed attack.
CREATE INDEX IF NOT EXISTS pin_login_failures_ip_created_at_idx
  ON pin_login_failures (ip, created_at DESC);

ALTER TABLE pin_login_failures ENABLE ROW LEVEL SECURITY;

-- The route writes with the service-role key, which bypasses RLS entirely — so
-- there is deliberately NO insert policy. Nothing holding an anon or a staff
-- token can write here, which means the log can't be flooded or forged from the
-- browser.
--
-- Read is owner/manager only. This is security telemetry; it does not belong in
-- front of a tech or a runner, and a runner's role has no business seeing which
-- IPs are probing the login.
DROP POLICY IF EXISTS pin_login_failures_sel ON pin_login_failures;
CREATE POLICY pin_login_failures_sel ON pin_login_failures
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.auth_user_id = auth.uid()
        AND up.role IN ('owner', 'manager')
        AND up.deleted_at IS NULL
    )
  );

COMMIT;
