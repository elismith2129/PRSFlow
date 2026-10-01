-- ===========================================================================
-- SRS PAYOUTS (Eli, 2026-10-01) — the SRS list gets its own page, and the fee
-- percent becomes adjustable.
--
-- "it's typically 20% on one offs and we go down to 10% if its a low rate or
--  extended booking." Default 20% (studio-wide, app_settings), any session can
-- override (srs_payouts.fee_pct). A PAID row freezes the percent and dollars it
-- was paid at — changing the default never re-prices money already sent.
--
-- WHY A NEW TABLE, not srs_log: srs_log is keyed on booking_id and only ever got
-- a row when SRS was ticked at booking creation on the calendar. Ticking it on
-- the work order (the normal path) never wrote one, so sessions fell off the
-- list. The list now reads work_orders.is_srs directly; this table only holds
-- what a person decided (the % override and the paid stamp), one row per WO,
-- created on first touch. srs_log is left in place (the calendar still writes
-- it) but nothing reads it any more.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('srs_default_pct', '20'::jsonb)
on conflict (key) do nothing;

create table if not exists public.srs_payouts (
  work_order_id uuid primary key references public.work_orders(id) on delete cascade,
  fee_pct       numeric,       -- null = the studio default
  paid_at       timestamptz,   -- null = owed
  paid_on       date,          -- the date the money went out (asked on Mark paid)
  paid_pct      numeric,       -- frozen at payment
  paid_amount   numeric,       -- frozen at payment
  paid_by       uuid,
  updated_at    timestamptz not null default now()
);

-- Carry over what the old log already marked paid. Those were paid at the old
-- flat 10%; dollars weren't stored (srs_fee_amount was never filled), so the
-- page computes them at 10% from the WO.
insert into public.srs_payouts (work_order_id, paid_at, paid_on, paid_pct)
select b.work_order_id, max(l.paid_at), max(l.paid_at)::date, 10
from public.srs_log l
join public.bookings b on b.id = l.booking_id
where l.paid and b.work_order_id is not null
group by b.work_order_id
on conflict (work_order_id) do nothing;

alter table public.app_settings enable row level security;
alter table public.srs_payouts  enable row level security;

drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select" on public.app_settings
  for select to authenticated using (true);
drop policy if exists "app_settings_write" on public.app_settings;
create policy "app_settings_write" on public.app_settings
  for all to authenticated
  using (get_my_role() in ('owner', 'manager'))
  with check (get_my_role() in ('owner', 'manager'));

drop policy if exists "srs_payouts_select" on public.srs_payouts;
create policy "srs_payouts_select" on public.srs_payouts
  for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'));
drop policy if exists "srs_payouts_write" on public.srs_payouts;
create policy "srs_payouts_write" on public.srs_payouts
  for all to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'))
  with check (get_my_role() in ('owner', 'manager', 'billing'));

grant select, insert, update, delete on public.app_settings to authenticated;
grant select, insert, update, delete on public.srs_payouts  to authenticated;
grant all on public.app_settings to service_role;
grant all on public.srs_payouts  to service_role;

commit;

select (select count(*) from public.srs_payouts) as srs_rows_carried_over,
       (select value from public.app_settings where key = 'srs_default_pct') as default_pct,
       (select count(*) from public.work_orders where is_srs) as srs_work_orders;
