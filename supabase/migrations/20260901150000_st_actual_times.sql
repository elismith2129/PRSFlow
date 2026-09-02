-- ─────────────────────────────────────────────────────────────────────────────
-- studio_time_rows.actual_from_time / actual_to_time (Eli, 2026-09-01).
--
-- When the client ACTUALLY arrived and left, per day-room row, typed by the
-- runner in the day sheet (mock docs/design-refs/wo-actual-times-options.html,
-- option B — typed wells, no punch buttons).
--
-- THE LAW THESE COLUMNS LIVE UNDER: billed = booked, always, for 100% of
-- sessions. Nothing that computes money reads these fields — not
-- computeWoTotals, not calcCharge, not the projection, not the client PDF
-- (lib/woPdf draws only the fields it is told to). They exist purely as the
-- internal record, so utilization (% of booked time used, per room / client /
-- month) is a one-query report whenever it's wanted:
--   calcHours(actual_from_time, actual_to_time) vs the row's booked hours.
--
-- Text columns, same time format as from_time/to_time. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.studio_time_rows add column if not exists actual_from_time text;
alter table public.studio_time_rows add column if not exists actual_to_time text;
