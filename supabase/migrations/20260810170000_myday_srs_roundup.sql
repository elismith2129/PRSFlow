-- ===========================================================================
-- MY DAY — monthly SRS round-up for billing (RULING 2026-08-10, Eli)
--
-- "For Aaron, on the first of each month, we need to round up all SRS bookings
--  so that we can pay. We built logic to have SRS be on the booking form and
--  automatically generate a log. That just needs to happen on the first of
--  each month."
--
-- SRS = Studio Referral Service: a 10% referral fee on room charges (excluding
-- ENG lines), already shipped — bookings.is_srs / srs_fee_amount, per-booking
-- paid/unpaid toggles, and a monthly bulk-mark in Admin. The data and the screen
-- both exist; what was missing was anything telling Aaron to go and do it. This
-- is that.
--
-- MONTHLY, day 1, and CUMULATIVE on purpose. Cumulative because referral
-- payments are owed to real people: missing the 1st does not make the money go
-- away, so the duty must clear the miss when it is finally done rather than
-- vanish. Monthly duties are also STICKY in lib/myday.ts (STICKY_CADENCES) —
-- they stay on the card past their due date and escalate, instead of scrolling
-- out of sight until the next month.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

insert into myday_duties
  (duty_key, role, label, cadence, due_days, dtype, captures, sub_items, sort_order)
values
  ('bil_srs_roundup', 'billing',
   'Round up SRS bookings for payment',
   'monthly', array[1], 'cumulative',
   '[{"key":"srs_bookings","label":"Bookings"}]'::jsonb,
   '[]'::jsonb, 75)
on conflict (duty_key) do update set
  role       = excluded.role,
  label      = excluded.label,
  cadence    = excluded.cadence,
  due_days   = excluded.due_days,
  dtype      = excluded.dtype,
  captures   = excluded.captures,
  sub_items  = excluded.sub_items,
  sort_order = excluded.sort_order;
-- is_active deliberately untouched, so retiring this later cannot be undone by
-- a replay — the same rule every seed in this project follows.

commit;
