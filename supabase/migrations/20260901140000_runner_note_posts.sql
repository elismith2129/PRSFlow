-- ─────────────────────────────────────────────────────────────────────────────
-- runner_note_posts — the runner notes CHANNEL (Eli, 2026-09-01; mock
-- docs/design-refs/runner-notes-options.html, option A).
--
-- One Slack-shaped channel per studio, on the studio hub: every note ever,
-- one list, PURE SUBMIT ORDER — no midnight, no 8:50, no day keys on the
-- table. (Daily Ops still shows "last night's notes" by computing each
-- post's operational day from created_at at READ time — display grouping,
-- never storage.)
--
-- Supersedes shift_note_docs as the WRITE surface (v4's autosaving doc per
-- runner per shift — the model had no submit moment, which a chronological
-- feed needs). The docs table stays untouched as history; the backfill below
-- pours its non-empty docs in as messages so day one isn't an empty channel.
--
-- `source`: 'runner' or 'office' — admins read AND write the channel (the
-- admin view), and their posts wear an Office chip instead of a shift role.
-- Edits: author-only (matched through user_profiles.auth_user_id). No delete
-- policy — like the manager log, a posted note is a record.
--
-- Idempotent; the backfill only runs into an EMPTY table.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.runner_note_posts (
  id           uuid primary key default gen_random_uuid(),
  studio       text not null,
  author_id    uuid references public.user_profiles(id),
  author_name  text not null default '',
  role         text check (role in ('opener', 'floater', 'closer')),
  source       text not null default 'runner' check (source in ('runner', 'office')),
  text         text not null,
  -- Storage PATHS in the private checklist-photos bucket (runner-notes/
  -- prefix), signed at read time — same pattern as every photo in the app.
  photo_urls   text[],
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Same-day amendment (photos on notes) — covers a table created before the
-- column was added to the CREATE above.
alter table public.runner_note_posts add column if not exists photo_urls text[];

create index if not exists runner_note_posts_studio_at on public.runner_note_posts (studio, created_at desc);

alter table public.runner_note_posts enable row level security;

drop policy if exists "runner_note_posts_select" on public.runner_note_posts;
create policy "runner_note_posts_select" on public.runner_note_posts
  for select to authenticated using (true);

drop policy if exists "runner_note_posts_insert" on public.runner_note_posts;
create policy "runner_note_posts_insert" on public.runner_note_posts
  for insert to authenticated with check (true);

drop policy if exists "runner_note_posts_update" on public.runner_note_posts;
create policy "runner_note_posts_update" on public.runner_note_posts
  for update to authenticated
  using (author_id in (select id from public.user_profiles where auth_user_id = auth.uid()))
  with check (author_id in (select id from public.user_profiles where auth_user_id = auth.uid()));

-- No DELETE policy — posted notes are records.

-- Post-2026-05-30 table: explicit grants required (ONBOARDING §5).
grant select, insert, update on public.runner_note_posts to authenticated;
grant all on public.runner_note_posts to service_role;

-- Realtime (standing rule — every fetch pairs with a subscription).
alter table public.runner_note_posts replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.runner_note_posts;
exception when duplicate_object then
  null;
end $$;

-- Backfill: every non-empty shift-note doc becomes one message, stamped with
-- the doc's own timestamps so the feed's history reads in the order the
-- shifts actually started. Runs once, into an empty table only.
do $$
begin
  if not exists (select 1 from public.runner_note_posts limit 1) then
    insert into public.runner_note_posts
      (studio, author_id, author_name, role, source, text, created_at, updated_at)
    select studio, author_id, author_name, role, 'runner', text, created_at, updated_at
      from public.shift_note_docs
      where coalesce(text, '') <> ''
      order by created_at;
  end if;
end $$;
