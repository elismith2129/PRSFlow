-- Financials — variable-grain series.
--
-- WHY (Eli, 2026-08-20): "can we get some better resolution on this thing? I
-- have you day by day numbers for 9 years."
--
-- Correct. `financial_history` stores one row per DAY per room per category —
-- roughly 3,650 days — and the chart was reducing all of it to 116 monthly
-- points. A month is the right grain for a nine-year arc and far too coarse for
-- a two-month window, where the shape of the business is week to week.
--
-- So the grain follows the zoom (the "semantic zoom" every serious charting
-- tool does): month across years, week inside a year or two, day inside a few
-- months. `financial_monthly` stays for the brush overview and the year
-- overlay, where twelve points per year is exactly right.
--
-- THE ROW CAP IS WHY THIS TAKES A WINDOW AND A METRIC. PostgREST truncates at
-- 1,000 rows silently (see migration 20260820150000). Daily × 9 years × 4
-- categories is 14,600 rows and would truncate; daily for ONE metric over a
-- windowed range is at most a few hundred. The parameters are not conveniences
-- — they are what keeps this under the cap by construction:
--
--     day  grain, 2-year window   →   730 rows
--     week grain, 10-year window  →   520 rows
--     month grain, 10-year window →   120 rows
--
-- SECURITY INVOKER, so the owner-only policy on `financial_history` still
-- decides who sees anything.
--
-- Idempotent. Run by hand in the Supabase SQL editor.

create or replace function financial_series(
  p_scope  text default '',
  p_metric text default 'total',
  p_grain  text default 'month',
  p_from   date default date '2000-01-01',
  p_to     date default date '2100-01-01'
)
returns table (bucket date, amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    -- The bucket's START date. Returned as a date rather than a formatted
    -- string so the caller can do arithmetic on it — the year-over-year lookup
    -- needs to subtract a year from it, and re-parsing 'YYYY-MM-DD' to do that
    -- is how timezone bugs get in.
    case p_grain
      when 'day'  then session_date
      when 'week' then (date_trunc('week',  session_date))::date
      else             (date_trunc('month', session_date))::date
    end as bucket,
    sum(amount) as amount
  from financial_history
  where direction = 'revenue'
    and session_date between p_from and p_to
    and (p_metric = 'total' or category = p_metric)
    and (
      coalesce(p_scope, '') = ''
      or (p_scope like 'venue:%' and venue = substring(p_scope from 7))
      or (venue || ' · ' || room) = p_scope
    )
  group by 1
  order by 1
$$;

grant execute on function financial_series(text, text, text, date, date) to authenticated;
