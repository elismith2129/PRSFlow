-- ===========================================================================
-- Email campaigns — suppression flags + campaign history table.
-- Run ONCE in the Supabase SQL editor.
-- Idempotent: safe to re-run.
-- ===========================================================================

-- Opt-out flags on leads and clients
alter table public.leads
  add column if not exists email_opt_out boolean not null default false;

alter table public.clients
  add column if not exists email_opt_out boolean not null default false;

-- Campaign history: one row per send
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body text not null,
  -- snapshot of filters used to build the list
  segment_tags text[] not null default '{}',
  segment_statuses text[] not null default '{}',
  segment_billing text,            -- 'COD' | 'Billing' | null = both
  recipient_count int not null default 0,
  sent_by text not null,           -- display_name of sender
  sent_at timestamptz not null default now(),
  -- per-recipient results stored as jsonb array: [{email, name, status, error}]
  results jsonb not null default '[]'
);

-- RLS: owner-only (matches role gate in the UI)
alter table public.email_campaigns enable row level security;

create policy "owner select campaigns" on public.email_campaigns
  for select using (
    exists (
      select 1 from public.user_profiles
      where auth_user_id = auth.uid() and role = 'owner'
    )
  );

create policy "owner insert campaigns" on public.email_campaigns
  for insert with check (
    exists (
      select 1 from public.user_profiles
      where auth_user_id = auth.uid() and role = 'owner'
    )
  );

-- No realtime needed for campaigns (history view, not a live surface).
