-- ─────────────────────────────────────────────────────────────────────────────
-- BLANKET-RATE OVERTIME IS A TYPED AMOUNT (Eli, 2026-09-14 evening, WO-1076).
--
-- "For OT in the instance of whole building buy outs or just blanket deals,
-- these are always custom so need full flex. So likely OT for blanket rates
-- will be just an OT applied to the booking, so no need to have it auto fill
-- OT. And for multiroom/whole building OT, just allocate the OT across."
--
-- This SUPERSEDES ruling 5 of docs/design-refs/wo-blanket-rate-options.html
-- ("OT is rack", per room) for bundled days only. Non-bundled day rows keep
-- deriving OT from the clock at rack ÷ 10 exactly as before.
--
-- The bundle carries one OT figure for the day; lib/woBundles allocates it
-- across the member rooms pro-rata by rack (same weights as the rate), into
-- each row's ot_charge. Member rows' ot_hours are NOT derived — a blanket
-- deal's overrun is negotiated, not clocked.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.wo_rate_bundles
  add column if not exists ot_amount numeric not null default 0 check (ot_amount >= 0);

comment on column public.wo_rate_bundles.ot_amount is
  'Overtime for the whole bundled day, typed by the office (blanket deals are custom — never clocked). Allocated across member rows into ot_charge, pro-rata by rate_daily, same as amount.';
