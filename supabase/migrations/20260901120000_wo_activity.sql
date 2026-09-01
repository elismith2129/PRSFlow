-- ─────────────────────────────────────────────────────────────────────────────
-- wo_activity — the work order's history (Eli, 2026-09-01).
--
-- One APPEND-ONLY row per save event: who · when · which fields (from → to),
-- plus the creation snapshot as entry zero (kind='created', snapshot = the
-- original WO stored whole). All diffing happens in TS (lib/woActivity.ts) at
-- the save choke points — this table is dumb storage, per the house law.
--
-- Append-only is enforced by POLICY ABSENCE: authenticated may SELECT and
-- INSERT; there are no UPDATE or DELETE policies, so history cannot be edited
-- or erased from the client (same shape as dashboard_task_comments).
--
-- Runner note: the shared runner login writes entries too (its submits and
-- saves), so INSERT is any-authenticated, not office-tiered.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.wo_activity (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders(id) on delete cascade,
  at             timestamptz not null default now(),
  actor_id       uuid,
  actor_name     text not null default '',
  source         text not null default 'office' check (source in ('office', 'runner', 'system')),
  -- The ladder, in house convention (Eli, 2026-09-01): runner SUBMITS the day,
  -- admin REVIEWS it (the per-row lock), owner APPROVES the invoice.
  kind           text not null check (kind in ('created', 'saved', 'submitted', 'reviewed', 'approved')),
  -- True when the change landed AFTER an invoice was attached — the history
  -- feed's ⚠, same fact billing calls drift.
  after_invoice  boolean not null default false,
  -- [{what, day, from, to}] — null for 'created' (the snapshot IS the content).
  changes        jsonb,
  -- kind='created' only: the original WO, whole (lib/woActivity WoSnapshot).
  snapshot       jsonb
);

create index if not exists wo_activity_wo_at on public.wo_activity (work_order_id, at desc);

alter table public.wo_activity enable row level security;

drop policy if exists "wo_activity_select" on public.wo_activity;
create policy "wo_activity_select" on public.wo_activity
  for select to authenticated using (true);

drop policy if exists "wo_activity_insert" on public.wo_activity;
create policy "wo_activity_insert" on public.wo_activity
  for insert to authenticated with check (true);

-- No UPDATE / DELETE policies — deliberately. History is append-only.

-- Post-2026-05-30 tables are NOT grandfathered: explicit grants required
-- (ONBOARDING §5). No anon access of any kind.
grant select, insert on public.wo_activity to authenticated;
grant all on public.wo_activity to service_role;

-- Realtime: the history modal live-updates while open (standing rule — every
-- fetch pairs with a subscription).
alter table public.wo_activity replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.wo_activity;
exception when duplicate_object then
  null;
end $$;
