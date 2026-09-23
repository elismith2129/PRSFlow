-- ===========================================================================
-- FIX: petty_cash_opening() assumed a `date` column. Both petty_cash tables
-- store `date` as TEXT, so `b.date < p_date` raised
--     42883: operator does not exist: text < date
-- and the function was unusable.
--
-- ISO 'YYYY-MM-DD' sorts lexicographically exactly as it sorts chronologically,
-- so the comparison is done in TEXT. Taking p_date as text also means the
-- function works whether the columns are text or date, which is the property
-- the first version lacked.
--
-- The (text, date) signature is DROPPED rather than left alongside: two
-- overloads would make supabase-js's rpc() call ambiguous, since it sends the
-- date as a JSON string either way.
-- ===========================================================================

BEGIN;

DROP FUNCTION IF EXISTS petty_cash_opening(text, date);

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
  SELECT b.date::text, b.counted_close
    INTO v_since, v_base
    FROM petty_cash_balances b
   WHERE b.studio = p_studio
     AND b.date::text < p_date
     AND b.counted_close IS NOT NULL
   ORDER BY b.date::text DESC
   LIMIT 1;

  IF v_since IS NULL THEN
    SELECT COALESCE(s.amount, 0) INTO v_base FROM petty_cash_seed s WHERE s.studio = p_studio;
    v_base  := COALESCE(v_base, 0);
    -- Earlier than any real row, and safe to compare as text.
    v_since := '0000-00-00';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN e.type = 'in' THEN e.amount ELSE -e.amount END), 0)
    INTO v_move
    FROM petty_cash_entries e
   WHERE e.studio = p_studio
     AND e.date::text > v_since
     AND e.date::text < p_date;

  RETURN ROUND(v_base + v_move, 2);
END;
$$;

REVOKE ALL ON FUNCTION petty_cash_opening(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION petty_cash_opening(text, text) TO authenticated;

COMMIT;
