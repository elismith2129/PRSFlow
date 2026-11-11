-- NO DUPLICATE DAY ROWS (Eli, 2026-11-11). WO #35040 (Doechii) grew a second
-- row for Nov 10 and Nov 11 at the same instant: two clients opened the work
-- order together, both read "those dates are missing", both inserted. The
-- work order groups rows by date so the copies hid inside the day cards; the
-- calendar projection then wrote a stray tentative card. The app had three
-- read-then-insert paths and no rule behind them. This is the rule.
--
-- One row per work order + date + room. Staff lines (studio '') are exempt:
-- a day legitimately holds several of them. Run the SWEEP first (box 1); the
-- index refuses to build while doubles exist.
--
-- Idempotent.
create unique index if not exists studio_time_rows_one_per_day_room
  on public.studio_time_rows (work_order_id, date, studio)
  where coalesce(studio, '') <> '' and date is not null;

select count(*) as rows_guarded from public.studio_time_rows where coalesce(studio, '') <> '' and date is not null;
