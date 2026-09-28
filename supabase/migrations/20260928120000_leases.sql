-- ─────────────────────────────────────────────────────────────────────────────
-- leases — tenants become data (Eli, 2026-09-28: "change the amounts, due
-- dates, import new tenants, remove old ones").
--
-- Reverses the 2026-09-02 "roster is code" ruling. What forced it: MBA's
-- cycle is anchored on the 16th (a full month, not prorated, due mid-month),
-- and a code roster cannot carry a cycle or a start date. A lease is a
-- recurring charge: tenant, room, amount, anchor day, start, end.
--
-- has_work_order: the ONE flag that separates Mustard from the rest. True →
-- a normal WO exists for the room (runners fill day cards, office approves
-- daily, $0 rate / 12 hrs incl. / OT priced on the WO) and the Tenants tab
-- shows his incidentals line + the shared-runner sheet. False → no WO, no
-- day cards, nothing in Billing; the room is just blocked on the calendar.
--
-- tenant_rent_months gains lease_id (replacing the code-side room_id key),
-- amount (FROZEN when the period row is created — a rent change never
-- re-prices an old month) and paid_amount (partial payments are real).
-- `month` stays 'YYYY-MM' and means the month the period STARTS in: MBA's
-- "Sep 16 – Oct 15" is '2026-09'.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code lands.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.leases (
  id              uuid primary key default gen_random_uuid(),
  tenant          text not null,
  venue           text not null check (venue in ('Paramount', 'Ameraycan', 'Encore', 'Track')),
  room_label      text not null,            -- 'Studio B', 'South + PR1'
  amount          numeric(10,2) not null default 0,
  anchor_day      int  not null default 1 check (anchor_day between 1 and 28),
  start_date      date not null,
  end_date        date,                     -- null = ongoing
  has_work_order  boolean not null default false,
  notes           text,
  sort_order      int  not null default 0,
  legacy_key      text unique,              -- old code-side room_id, for the stamp backfill
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists leases_updated_at on public.leases;
    create trigger leases_updated_at
      before update on public.leases
      for each row execute function set_updated_at();
  end if;
end $$;

-- Seed — the roster as of 2026-09-28. legacy_key matches lib/tenants.ts ids
-- so existing stamps carry over. Empty rooms (PRS D) are not leases.
insert into public.leases (tenant, venue, room_label, amount, anchor_day, start_date, has_work_order, sort_order, legacy_key)
values
  ('Spencer Nezy', 'Paramount', 'Studio F',    2500.00,  1, '2025-01-01', false, 10, 'prs-f'),
  ('Dada',         'Paramount', 'Treehouse',   5500.00,  1, '2025-01-01', false, 20, 'prs-treehouse'),
  ('Oren Yoel',    'Ameraycan', 'Studio C',    3250.00,  1, '2025-01-01', false, 30, 'ars-c'),
  ('Bobby Raps',   'Track',     'PR2',         2100.00,  1, '2025-01-01', false, 40, 'trk-pr2'),
  ('Sean Dorian',  'Track',     'PR3',         1622.25,  1, '2025-01-01', false, 50, 'trk-pr3'),
  ('Camper',       'Track',     'North',      19500.00,  1, '2025-01-01', false, 60, 'trk-north'),
  ('MBA',          'Track',     'South + PR1', 7000.00, 16, '2026-09-16', false, 70, 'trk-south-pr1'),
  ('Mustard',      'Encore',    'Studio B',   29500.00,  1, '2025-01-01', true,  80, 'ers-b')
on conflict (legacy_key) do nothing;

-- ─── tenant_rent_months: key on the lease, carry money ───────────────────────
alter table public.tenant_rent_months add column if not exists lease_id    uuid references public.leases(id);
alter table public.tenant_rent_months add column if not exists amount      numeric(10,2);
alter table public.tenant_rent_months add column if not exists paid_amount numeric(10,2);

-- Backfill: old room_id → lease_id; old rows get the amount that applied.
update public.tenant_rent_months m
   set lease_id = l.id
  from public.leases l
 where m.lease_id is null and l.legacy_key = m.room_id;

update public.tenant_rent_months m
   set amount = l.amount
  from public.leases l
 where m.amount is null and m.kind = 'rent' and m.lease_id = l.id;

-- Paid-in-full is the only thing the old board could say.
update public.tenant_rent_months
   set paid_amount = amount
 where paid_amount is null and paid_at is not null and amount is not null;

-- New key. The old (room_id, month, kind) unique stays until room_id is
-- dropped in a later migration, after the code no longer writes it.
create unique index if not exists tenant_rent_months_lease_month_kind
  on public.tenant_rent_months (lease_id, month, kind);
alter table public.tenant_rent_months alter column room_id drop not null;

-- ─── Access ──────────────────────────────────────────────────────────────────
-- Read: same set as the rent board. Write: deal terms are owner / manager.
alter table public.leases enable row level security;

drop policy if exists "leases_select" on public.leases;
create policy "leases_select" on public.leases
  for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists "leases_insert" on public.leases;
create policy "leases_insert" on public.leases
  for insert to authenticated
  with check (get_my_role() in ('owner', 'manager'));

drop policy if exists "leases_update" on public.leases;
create policy "leases_update" on public.leases
  for update to authenticated
  using (get_my_role() in ('owner', 'manager'))
  with check (get_my_role() in ('owner', 'manager'));

-- Delete is for a lease entered by mistake. A tenant who LEAVES gets an
-- end_date — their stamped months are history and stay.
drop policy if exists "leases_delete" on public.leases;
create policy "leases_delete" on public.leases
  for delete to authenticated
  using (get_my_role() = 'owner'
         and not exists (select 1 from public.tenant_rent_months m where m.lease_id = leases.id));

grant select, insert, update, delete on public.leases to authenticated;
grant all on public.leases to service_role;

alter table public.leases replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.leases;
exception when duplicate_object then
  null;
end $$;
