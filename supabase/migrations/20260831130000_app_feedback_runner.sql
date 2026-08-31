-- ---------------------------------------------------------------------------
-- Runner submissions ride on app_feedback (Eli, 2026-08-31).
--
-- Runners get a Bug / Suggestion box on the /runner landing page. Rather than a
-- second table with its own policies to keep in step, the existing rollout
-- feedback board grows three columns and the two audiences are told apart by
-- `source`. One inbox, one resolved flag, one set of RLS rules — the office
-- board is `source='office'`, the runner tab is `source='runner'`.
--
--   source     'office' | 'runner' — NOT NULL, defaults to 'office' so every
--              existing row (and the existing /feedback form, unchanged) stays
--              exactly what it was.
--   studio     which studio the runner was standing in. Null for office rows.
--   photo_url  optional signed-path photo in the private checklist-photos
--              bucket, same pattern as flags.
--
-- RLS is UNCHANGED and already correct for this: any authenticated user may
-- SELECT and INSERT; only owner/manager may UPDATE (resolve) or DELETE. Runners
-- are authenticated as themselves since 2026-08-20, so they can post without
-- any new grant.
--
-- NOTE (inherited, not introduced here): the SELECT policy is `using (true)`,
-- so a runner can read the office's board too. That predates this migration and
-- is deliberate for the rollout period — tighten it here if that changes.
--
-- Idempotent; run by hand in the Supabase SQL editor. Verify:
--   select source, count(*) from app_feedback group by source;
-- ---------------------------------------------------------------------------

begin;

alter table public.app_feedback
  add column if not exists source    text not null default 'office',
  add column if not exists studio    text,
  add column if not exists photo_url text;

-- Constrain the vocabulary. Guarded so a re-run doesn't error on the existing
-- constraint (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_feedback_source_check'
  ) then
    alter table public.app_feedback
      add constraint app_feedback_source_check check (source in ('office', 'runner'));
  end if;
end $$;

create index if not exists app_feedback_source_idx
  on public.app_feedback (source, created_at desc);

comment on column public.app_feedback.source is
  'office = the /feedback board; runner = submitted from the /runner landing page (2026-08-31).';
comment on column public.app_feedback.studio is
  'Studio the runner was working when they submitted. Null for office rows.';
comment on column public.app_feedback.photo_url is
  'Optional photo path in the private checklist-photos bucket (signed on read), same pattern as flags.';

-- Realtime: the board and the runner tab both subscribe (standing rule).
alter table public.app_feedback replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_feedback'
  ) then
    alter publication supabase_realtime add table public.app_feedback;
  end if;
end $$;

commit;
