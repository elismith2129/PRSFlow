-- ─────────────────────────────────────────────────────────────────────────────
-- A day rate's INCLUDED HOURS (Eli, 2026-09-14, WO-1076).
--
-- "OT doesn't seem to be working... the day rate in this case was 9-6p, not a
-- 12 hour day. very unique case here. but actually not that unique as we do
-- plenty of events that are 3-6 hours. and its a day rate and can incur OT."
--
-- WHAT WAS WRONG. Overtime on a day row was `actual - 12`, with 12 hard-coded
-- in two places: the derivation, and a literal '12h lockout' string on the day
-- sheet that was never reading anything. A day rate does NOT always buy twelve
-- hours — a 9-6 day buys nine, a product shoot or event buys three to six — so
-- a 10-hour day against a 9-hour agreement computed 10 - 12 = 0 OT and billed
-- an hour for free. The 'agreed with client' line lied on every non-12h day,
-- which is worse than saying nothing: it looked like a read value.
--
-- NULL MEANS 12. Deliberately (Eli chose this over defaulting to the booked
-- window): every existing row keeps behaving exactly as it does today, a normal
-- lockout needs no typing, and the exception is typed once on the day it
-- applies. Reading the booked from/to instead would have been less typing but
-- depends on those times being right — and they are edited to ACTUAL times
-- during a session, which is precisely how the hourly OT bug (WO-1121) managed
-- to double-bill.
--
--   OT hours = max(0, actual hours - coalesce(included_hours, 12))
--
-- Hourly rows ignore this entirely — they have no overtime at all (WO-1121,
-- 2026-09-10): an hourly session that runs long simply bills more hours.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.studio_time_rows
  add column if not exists included_hours numeric;

do $fn$
begin
  -- A day cannot include a negative number of hours, and anything past 24 is a
  -- typo rather than a deal — a multi-day booking is multiple ROWS, not one row
  -- with a 36-hour window.
  if not exists (select 1 from pg_constraint where conname = 'studio_time_rows_included_hours_ck') then
    alter table public.studio_time_rows add constraint studio_time_rows_included_hours_ck check (
      included_hours is null or (included_hours > 0 and included_hours <= 24)
    );
  end if;
end
$fn$;

comment on column public.studio_time_rows.included_hours is
  'Day rows only: hours the day rate buys before overtime starts. NULL = 12 (the normal lockout), so existing rows are unchanged. OT = max(0, actual - coalesce(included_hours, 12)). Hourly rows never have overtime and ignore this.';
