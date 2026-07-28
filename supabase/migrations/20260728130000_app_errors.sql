-- ===========================================================================
-- Phase 0 (audit) — first-party error logging table.
-- Run ONCE in the Supabase SQL editor. Idempotent, additive only.
--
-- Client-side errors (render crashes, unhandled rejections, failed DB writes)
-- are reported to /api/log-error, which inserts here via the service role.
-- RLS: enabled with NO anon/authenticated write policies — only the service
-- role can insert. Owner/manager can read (for a future admin Errors tab).
-- ===========================================================================

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  url text,
  meta jsonb,
  user_agent text
);

alter table public.app_errors enable row level security;

drop policy if exists app_errors_select_mgr on public.app_errors;
create policy app_errors_select_mgr on public.app_errors
  for select to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.auth_user_id = auth.uid() and p.role in ('owner','manager')
    )
  );

-- Keep it from growing forever: callers may prune, or run this occasionally:
-- delete from public.app_errors where created_at < now() - interval '90 days';
