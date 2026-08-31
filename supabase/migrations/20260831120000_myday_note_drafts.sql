-- ---------------------------------------------------------------------------
-- My Day shift notes: THE DRAFT SURVIVES (Eli's ruling, 2026-08-31).
--
-- "They need to be able to compile through the day. Meaning they need to
-- never clear out. So they can switch screens and tabs and their notes never
-- clear."
--
-- The composer on /my-day held its text in React state alone: navigating to
-- the calendar, switching tabs on a phone, or any reload threw away
-- everything that had not been submitted yet. The runners got this fixed on
-- 2026-08-26 (shift_note_docs — "continuously saved so nothing is ever lost
-- even if the app closes"); the manager side never did. This is that fix.
--
-- myday_note_drafts — ONE ROW PER AUTHOR. Not per (author, date), on purpose:
--   • A draft is unfinished writing, not a dated record. The dated record is
--     the POST, and the post's date is stamped at submit time ("the time
--     submitted really dictates what it is", 2026-08-24).
--   • Date-keying would silently strand an unsubmitted note the moment the
--     clock rolled over — the exact "my notes cleared out" complaint this
--     migration exists to end. One row means the text is there tomorrow too,
--     still waiting to be submitted.
--   • It also cannot accumulate junk: an author has one row, forever, reused.
--
-- editing_post_id: when an author reopens their own post, the composer
-- becomes that post's editor. Persisting which post is being edited means
-- coming back from another screen resumes the EDIT instead of turning the
-- same text into a second, duplicate post.
--
-- A draft is PRIVATE to its author — not even an owner reads it. Nothing is
-- shared until Submit writes a myday_note_posts row (which keeps its own,
-- wider, admin-circle policies). This is also why there is no clobber risk
-- of the kind that killed the old shared scratchpad box: one row, one writer.
--
-- Idempotent; run by hand in the Supabase SQL editor (working-conventions).
-- Verify:  select to_regclass('public.myday_note_drafts');   -- must NOT be null
-- ---------------------------------------------------------------------------

begin;

create table if not exists myday_note_drafts (
  author_id       uuid primary key references user_profiles(id) on delete cascade,
  session_notes   text not null default '',
  studio_notes    text not null default '',
  editing_post_id uuid references myday_note_posts(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_myday_note_drafts_updated on myday_note_drafts;
    create trigger trg_myday_note_drafts_updated before update on myday_note_drafts
      for each row execute function set_updated_at();
  else
    raise notice 'set_updated_at() not found — myday_note_drafts updated_at trigger skipped';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- RLS — own row only, in every direction. The admin-circle role check is kept
-- so the table matches its sibling (myday_note_posts) rather than quietly
-- granting a tech/runner a scratchpad they have no page to reach.
-- ---------------------------------------------------------------------------

alter table myday_note_drafts enable row level security;

drop policy if exists myday_note_drafts_sel on myday_note_drafts;
create policy myday_note_drafts_sel on myday_note_drafts for select to authenticated
  using (author_id = get_my_profile_id());

drop policy if exists myday_note_drafts_ins on myday_note_drafts;
create policy myday_note_drafts_ins on myday_note_drafts for insert to authenticated
  with check (
    get_my_role() in ('owner', 'manager', 'billing', 'asst_manager')
    and author_id = get_my_profile_id()
  );

drop policy if exists myday_note_drafts_upd on myday_note_drafts;
create policy myday_note_drafts_upd on myday_note_drafts for update to authenticated
  using (author_id = get_my_profile_id())
  with check (author_id = get_my_profile_id());

drop policy if exists myday_note_drafts_del on myday_note_drafts;
create policy myday_note_drafts_del on myday_note_drafts for delete to authenticated
  using (author_id = get_my_profile_id());


-- Explicit grants (new-table rule — grandfathering ends 2026-10-30).
grant select, insert, update, delete on myday_note_drafts to authenticated;


-- Realtime: publication membership + full replica identity (standing rule).
-- This is what carries a draft between a manager's desk and their iPad.
alter table myday_note_drafts replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'myday_note_drafts'
  ) then
    alter publication supabase_realtime add table myday_note_drafts;
  end if;
end $$;


comment on table myday_note_drafts is
  'Unsubmitted My Day shift notes — one row per author, autosaved as they type (2026-08-31). Deliberately NOT date-keyed: a draft is unfinished writing, and the date belongs to the post that Submit creates. Private to the author; cleared on submit. Sibling of shift_note_docs on the runner side.';

commit;
