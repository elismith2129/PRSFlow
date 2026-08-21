-- Financials — aggregate in Postgres, not in the browser.
--
-- WHY THIS EXISTS (bug, 2026-08-20, found on the production chart).
-- The first build selected raw rows out of `financial_history` and summed them
-- client-side. PostgREST caps a response at 1,000 rows, so a table holding
-- 55,601 returned the first 1,000 — all of 2017 — and the chart drew nine years
-- of history as a single bump in 2017 and nothing after. NO ERROR was raised:
-- a truncated response is a valid response, which is what made it look like an
-- RLS or a login problem for a while.
--
-- Pagination was the obvious fix and the wrong one. Fifty-six round trips and
-- ~5MB of JSON to draw one line, growing every year, when the chart never plots
-- anything finer than a month. Aggregation belongs where the rows are.
--
-- `financial_monthly` returns at most 12 months × 10 years × 4 categories ≈ 480
-- rows — comfortably under the cap, and it stays under it as the archive grows,
-- because the shape is bounded by TIME rather than by row count.
--
-- SECURITY INVOKER, DELIBERATELY. These run as the caller, so the owner-only
-- RLS policy on `financial_history` still decides who sees anything. A
-- SECURITY DEFINER rollup would be a hole straight through that policy — the
-- aggregate is exactly as sensitive as the rows it aggregates.
--
-- Idempotent. Run by hand in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Monthly rollup, optionally scoped to a venue or a single room.
--
-- `p_scope` matches the UI's room selector:
--   ''              → every room
--   'venue:Encore'  → one building
--   'Encore · Studio A' → one room
--
-- `p_day` exists for THE PARTIAL MONTH. The current month is not finished, so
-- comparing it against a whole month a year earlier reports a collapse that did
-- not happen. `amount_to_day` is the same months summed only to that day of the
-- month, so an August that has run to the 18th can be set against August 1–18
-- of last year. Both figures come back in one pass; the client picks per month.
-- ---------------------------------------------------------------------------
create or replace function financial_monthly(
  p_scope text default '',
  p_day   int  default 31
)
returns table (
  month         text,
  category      text,
  amount        numeric,
  amount_to_day numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(session_date, 'YYYY-MM')                                    as month,
    category,
    sum(amount)                                                         as amount,
    coalesce(
      sum(amount) filter (where extract(day from session_date) <= p_day),
      0
    )                                                                   as amount_to_day
  from financial_history
  where direction = 'revenue'
    and (
      coalesce(p_scope, '') = ''
      or (p_scope like 'venue:%' and venue = substring(p_scope from 7))
      or (venue || ' · ' || room) = p_scope
    )
  group by 1, 2
$$;

-- ---------------------------------------------------------------------------
-- The rooms the archive actually contains — for the dropdown.
--
-- Nineteen rows, and deliberately NOT derived from lib/studios.ts: seven of
-- these rooms (PRS D/F/H, ARS C, ERS C/D/E) are not in STUDIO_LOCATIONS but
-- carry $2.5M of history between them. The list of rooms that EARNED money is
-- not the same as the list of rooms the calendar can book.
-- ---------------------------------------------------------------------------
create or replace function financial_rooms()
returns table (venue text, room text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct venue, room
  from financial_history
  order by venue, room
$$;

-- ---------------------------------------------------------------------------
-- The newest day the archive holds. One row. Used to decide whether the latest
-- month is partial, and to how many days the comparison should be narrowed.
-- ---------------------------------------------------------------------------
create or replace function financial_latest_date()
returns date
language sql
stable
security invoker
set search_path = public
as $$
  select max(session_date) from financial_history
$$;

grant execute on function financial_monthly(text, int) to authenticated;
grant execute on function financial_rooms()            to authenticated;
grant execute on function financial_latest_date()      to authenticated;
