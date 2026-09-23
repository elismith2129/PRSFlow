-- ===========================================================================
-- PETTY CASH BECOMES A DAILY LEDGER (Eli, 2026-09-23).
--
-- Until now the runner page loaded EVERY entry a studio had ever made and
-- called the original seed "Opening balance", so the opening never moved and
-- the closing was seed + all history. The office modal scoped entries to one
-- day but still read that seed as the day's opening, so its closing balance
-- was seed + one night's movement — a number that meant nothing.
--
-- THE RULE, in one place so the two surfaces cannot disagree:
--   opening(studio, date) = the most recent COUNTED close before `date`
--                         + every entry logged after that count and before `date`
-- Cash is physical, so a count is the truth and the ledger resets to it. A
-- skipped night does not break the chain. With no count on record it falls
-- back to the studio's seed.
--
-- Idempotent. Rewrites no history: old rows keep whatever they say, they just
-- stop being read as openings.
-- ===========================================================================

BEGIN;

-- ── 1 · The seed: what was in the box when the log began. One per studio. ──
CREATE TABLE IF NOT EXISTS petty_cash_seed (
  studio      text PRIMARY KEY,
  amount      numeric(10,2) NOT NULL DEFAULT 0,
  set_by_name text,
  set_at      timestamptz DEFAULT now(),
  note        text
);

ALTER TABLE petty_cash_seed ENABLE ROW LEVEL SECURITY;

-- Everyone signed in may READ it (the runner page shows it when no count has
-- ever been taken). Only the office may SET it — a runner overwriting the seed
-- was the landmine this whole change removes.
DROP POLICY IF EXISTS petty_cash_seed_sel ON petty_cash_seed;
CREATE POLICY petty_cash_seed_sel ON petty_cash_seed FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS petty_cash_seed_ins ON petty_cash_seed;
CREATE POLICY petty_cash_seed_ins ON petty_cash_seed FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('owner','manager','billing'));

DROP POLICY IF EXISTS petty_cash_seed_upd ON petty_cash_seed;
CREATE POLICY petty_cash_seed_upd ON petty_cash_seed FOR UPDATE TO authenticated
  USING (get_my_role() IN ('owner','manager','billing'))
  WITH CHECK (get_my_role() IN ('owner','manager','billing'));

-- ── 2 · Who counted, and what they noticed. ────────────────────────────────
ALTER TABLE petty_cash_balances ADD COLUMN IF NOT EXISTS counted_by_name text;
ALTER TABLE petty_cash_balances ADD COLUMN IF NOT EXISTS count_note      text;

COMMENT ON COLUMN petty_cash_balances.amount IS
  'That day''s OPENING balance, derived by petty_cash_opening() and stamped on save. No longer typed by the runner.';

-- ── 3 · The opening rule. ONE definition, read by both surfaces. ───────────
CREATE OR REPLACE FUNCTION petty_cash_opening(p_studio text, p_date text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since text;
  v_base  numeric(10,2);
  v_move  numeric(10,2);
BEGIN
  -- The most recent night anyone actually counted the box.
  SELECT b.date::text, b.counted_close
    INTO v_since, v_base
    FROM petty_cash_balances b
   WHERE b.studio = p_studio
     AND b.date::text < p_date
     AND b.counted_close IS NOT NULL
   ORDER BY b.date::text DESC
   LIMIT 1;

  IF v_since IS NULL THEN
    -- Never counted: start from the seed and take everything since.
    SELECT COALESCE(s.amount, 0) INTO v_base FROM petty_cash_seed s WHERE s.studio = p_studio;
    v_base  := COALESCE(v_base, 0);
    v_since := '0000-00-00';
  END IF;

  -- Everything logged AFTER that count and BEFORE the day we are opening.
  SELECT COALESCE(SUM(CASE WHEN e.type = 'in' THEN e.amount ELSE -e.amount END), 0)
    INTO v_move
    FROM petty_cash_entries e
   WHERE e.studio = p_studio
     AND e.date::text > v_since
     AND e.date::text < p_date;

  RETURN ROUND(v_base + v_move, 2);
END;
$$;

REVOKE ALL ON FUNCTION petty_cash_opening(text, date) FROM PUBLIC;  -- superseded by 20260923140000
GRANT EXECUTE ON FUNCTION petty_cash_opening(text, text) TO authenticated;

-- ── 4 · Seed rows for the four studios, so nothing reads NULL on day one. ──
-- Amount 0 deliberately: the real cutover is a COUNTED CLOSE typed tonight,
-- not a seed backfilled from a number nobody verified.
INSERT INTO petty_cash_seed (studio, amount, note)
VALUES ('paramount', 0, 'awaiting first count'),
       ('ameraycan', 0, 'awaiting first count'),
       ('encore',    0, 'awaiting first count'),
       ('track',     0, 'awaiting first count')
ON CONFLICT (studio) DO NOTHING;

COMMIT;
