-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_rent_months — the Tenants rent board (Eli, 2026-09-02; mock
-- docs/design-refs/tenants-tab-options.html, option A).
--
-- One row per tenant room per month per kind. The ONLY stored facts are the
-- two human acts: the rent email went out (sent_at — the 25th send) and the
-- money arrived (paid_at). Everything else on the board — open, overdue,
-- collected, the roster itself — is derived. The roster and rents live in
-- code (lib/tenants.ts, the nadines precedent: deal terms change by commit).
--
-- kind: 'rent' (every tenant, monthly) or 'incidentals' (Mustard only —
-- the shared-runner hours invoice that goes out the 2nd–3rd). The incidentals
-- AMOUNT is never stored here; the hours are derived from studio_time_rows.
--
-- room_id is a code-side key ('ers-b', 'trk-north', …), not an FK — the rooms
-- are deal terms, not calendar rooms (most tenant rooms aren't in
-- STUDIO_LOCATIONS at all).
--
-- Access: owner / manager / billing / asst_manager — same set as the invoices
-- bucket since 20260901160000 (asst managers do billing work now; don't
-- repeat the Sep 1 RLS 403).
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code lands.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.tenant_rent_months (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null,
  month       text not null,  -- 'YYYY-MM' (text like every date in the app)
  kind        text not null default 'rent' check (kind in ('rent', 'incidentals')),
  sent_at     timestamptz,
  sent_by     uuid references public.user_profiles(id),
  paid_at     timestamptz,
  paid_by     uuid references public.user_profiles(id),
  -- The third act (Eli, 2026-09-02): the payment was entered in QuickBooks.
  -- Manual for now; the QBO integration (docs/AR-SCOPING.md) would stamp it.
  qb_at       timestamptz,
  qb_by       uuid references public.user_profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (room_id, month, kind)
);

-- Same-day amendment — covers a table created before the columns were added
-- to the CREATE above.
alter table public.tenant_rent_months add column if not exists qb_at timestamptz;
alter table public.tenant_rent_months add column if not exists qb_by uuid references public.user_profiles(id);

create index if not exists tenant_rent_months_month on public.tenant_rent_months (month);

-- Reuse the app-wide updated_at trigger (guarded, house pattern — see
-- 20260824150000_stock_checks.sql).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists tenant_rent_months_updated_at on public.tenant_rent_months;
    create trigger tenant_rent_months_updated_at
      before update on public.tenant_rent_months
      for each row execute function set_updated_at();
  else
    raise notice 'set_updated_at() not found — tenant_rent_months updated_at trigger skipped';
  end if;
end $$;

alter table public.tenant_rent_months enable row level security;

drop policy if exists "tenant_rent_months_select" on public.tenant_rent_months;
create policy "tenant_rent_months_select" on public.tenant_rent_months
  for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists "tenant_rent_months_insert" on public.tenant_rent_months;
create policy "tenant_rent_months_insert" on public.tenant_rent_months
  for insert to authenticated
  with check (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists "tenant_rent_months_update" on public.tenant_rent_months;
create policy "tenant_rent_months_update" on public.tenant_rent_months
  for update to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'))
  with check (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

-- No DELETE policy — a stamped month is a record; undo clears the stamp
-- fields, it never removes the row.

-- Post-2026-05-30 table: explicit grants required (ONBOARDING §5).
grant select, insert, update on public.tenant_rent_months to authenticated;
grant all on public.tenant_rent_months to service_role;

-- Realtime (standing rule — every fetch pairs with a subscription).
alter table public.tenant_rent_months replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.tenant_rent_months;
exception when duplicate_object then
  null;
end $$;
