-- ---------------------------------------------------------------------------
-- My Day shift notes v2: ONE POST PER SHIFT (Eli's ruling, 2026-08-24,
-- same day as — and superseding — 20260824120000_myday_note_entries.sql).
--
-- Eli, on the per-box entries that shipped this morning: "it's one submit per
-- shift, not a log entry throughout a shift. session notes and studio notes
-- both submit to one big entry." A post is the whole email: both sections,
-- signed once. The opener submits theirs, the closer submits theirs.
--
-- myday_note_posts — one row per SUBMISSION:
--   • session_notes / studio_notes — both in one row; either may be empty
--     (an empty box just isn't rendered), never both (app-enforced).
--   • shift ('opening'|'closing'|null) — the tag that tells you WHOSE post
--     you are reading ("make it clear the top box is the opener"). Chosen by
--     the submitter on the manager card; null for billing (no opener/closer —
--     it's one person's day) and for backfilled rows.
--
-- myday_note_entries is DROPPED, not retired: it existed for a few hours
-- today, its only rows are backfilled below, and leaving a same-day
-- superseded table in place would just get re-documented as real. (This is
-- not the duties never-delete rule — no history refers to it.)
--
-- Idempotent; run by hand in the Supabase SQL editor (working-conventions).
-- ---------------------------------------------------------------------------

begin;

create table if not exists myday_note_posts (
  id             uuid primary key default gen_random_uuid(),
  role           text not null check (role in ('manager', 'billing')),
  date           date not null,
  shift          text check (shift in ('opening', 'closing')),
  session_notes  text not null default '',
  studio_notes   text not null default '',
  created_by     uuid references user_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists myday_note_posts_date_idx
  on myday_note_posts (date desc, created_at);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_myday_note_posts_updated on myday_note_posts;
    create trigger trg_myday_note_posts_updated before update on myday_note_posts
      for each row execute function set_updated_at();
  else
    raise notice 'set_updated_at() not found — myday_note_posts updated_at trigger skipped';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Backfill: fold this morning's per-box entries into posts — one post per
-- (role, date, author), session bodies and studio bodies each joined with
-- blank lines, timestamped at the author's first entry. Guarded so a re-run
-- cannot duplicate. Skipped entirely if the entries table is already gone.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.myday_note_entries') is not null then
    insert into myday_note_posts (role, date, session_notes, studio_notes, created_by, created_at)
    select
      e.role,
      e.date,
      coalesce(string_agg(e.body, E'\n\n' order by e.created_at) filter (where e.kind = 'session'), ''),
      coalesce(string_agg(e.body, E'\n\n' order by e.created_at) filter (where e.kind = 'studio'),  ''),
      e.created_by,
      min(e.created_at)
    from myday_note_entries e
    group by e.role, e.date, e.created_by
    having not exists (
      select 1 from myday_note_posts p
      where p.role = e.role and p.date = e.date
        and p.created_by is not distinct from e.created_by
    );

    drop table myday_note_entries;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- RLS — identical circle to v1: owner/manager/billing/asst_manager read and
-- write ("all admin has access to read and write and submit"); authors own
-- their posts; owner may delete any. tech/runner: nothing.
-- ---------------------------------------------------------------------------

alter table myday_note_posts enable row level security;

drop policy if exists myday_note_posts_sel on myday_note_posts;
create policy myday_note_posts_sel on myday_note_posts for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists myday_note_posts_ins on myday_note_posts;
create policy myday_note_posts_ins on myday_note_posts for insert to authenticated
  with check (
    get_my_role() in ('owner', 'manager', 'billing', 'asst_manager')
    and created_by = get_my_profile_id()
  );

drop policy if exists myday_note_posts_upd on myday_note_posts;
create policy myday_note_posts_upd on myday_note_posts for update to authenticated
  using (
    get_my_role() in ('owner', 'manager', 'billing', 'asst_manager')
    and created_by = get_my_profile_id()
  )
  with check (created_by = get_my_profile_id());

drop policy if exists myday_note_posts_del on myday_note_posts;
create policy myday_note_posts_del on myday_note_posts for delete to authenticated
  using (
    created_by = get_my_profile_id()
    or get_my_role() = 'owner'
  );


-- Explicit grants (new-table rule — grandfathering ends 2026-10-30).
grant select, insert, update, delete on myday_note_posts to authenticated;


-- Realtime: publication membership + full replica identity (standing rule).
alter table myday_note_posts replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'myday_note_posts'
  ) then
    alter publication supabase_realtime add table myday_note_posts;
  end if;
end $$;


comment on table myday_note_posts is
  'My Day shift notes, ONE POST PER SHIFT (2026-08-24 v2) — a post is one submission carrying both session_notes and studio_notes, signed once, like one manager-notes email. shift tags it opening/closing on the manager card (null = billing or backfill). Replaced myday_note_entries (per-box rows, same day) which was dropped after backfill. myday_notes (the original shared scratchpad) remains as legacy history.';

commit;
