-- ═══════════════════════════════════════════════════════════════════════════
-- SHIFT NOTE DOCS — the Slack-replacement, take two (Eli, 2026-08-26).
--
-- The timestamped shift LOG (shift_log_entries, spec §19) was never adopted.
-- Eli's ruling: runners get ONE LARGE TEXT FIELD each, like the manager
-- notes — no posts, no timestamps, continuously saved so nothing is ever
-- lost even if the app closes. A night has at most an opener, a floater and
-- a closer, so the note is attached to the person's SHIFT:
--
--   shift_note_docs — one row per (studio, shift-day, author).
--     role: 'opener' | 'floater' | 'closer' (nullable — warn, never block).
--     text: the whole note. The page auto-bullets on every return key.
--
-- Same 8:50 AM America/Los_Angeles seal as the old log: while the shift-day
-- is live anyone can update THEIR row; at 8:50 the UPDATE policy matches
-- zero rows and the night is immutable for the office's morning review.
-- The policy and lib/time.ts shiftLogDate() MUST agree — change both or
-- neither.
--
-- shift_log_entries stays in the DB untouched (it holds nothing of value —
-- "we haven't used it yet") but ALL code reads/writes move to this table.
--
-- Idempotent; run by hand in the Supabase SQL editor. Verify:
--   select to_regclass('public.shift_note_docs');   -- must NOT be null
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists shift_note_docs (
  id          uuid primary key default gen_random_uuid(),
  studio      text not null,
  date        text not null,               -- shift-day (8:50 AM → 8:49 AM), lib/time shiftLogDate()
  author_id   uuid references user_profiles(id) on delete set null,
  author_name text not null default '',
  role        text check (role in ('opener', 'floater', 'closer')),
  text        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (studio, date, author_id)
);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_shift_note_docs_updated on shift_note_docs;
    create trigger trg_shift_note_docs_updated before update on shift_note_docs
      for each row execute function set_updated_at();
  else
    raise notice 'set_updated_at() not found — shift_note_docs updated_at trigger skipped';
  end if;
end $$;

grant select, insert, update, delete on shift_note_docs to authenticated;

alter table shift_note_docs enable row level security;

-- Read: any signed-in user (the office reviews, other runners see the night).
drop policy if exists shift_note_docs_select on shift_note_docs;
create policy shift_note_docs_select on shift_note_docs
  for select to authenticated using (true);

-- Write: only while the shift-day is LIVE (same 8:50 AM seal as the old log).
drop policy if exists shift_note_docs_insert on shift_note_docs;
create policy shift_note_docs_insert on shift_note_docs
  for insert to authenticated
  with check (
    date = to_char((now() at time zone 'America/Los_Angeles') - interval '8 hours 50 minutes', 'YYYY-MM-DD')
  );

drop policy if exists shift_note_docs_update on shift_note_docs;
create policy shift_note_docs_update on shift_note_docs
  for update to authenticated
  using (
    date = to_char((now() at time zone 'America/Los_Angeles') - interval '8 hours 50 minutes', 'YYYY-MM-DD')
  )
  with check (
    date = to_char((now() at time zone 'America/Los_Angeles') - interval '8 hours 50 minutes', 'YYYY-MM-DD')
  );

-- No DELETE policy — a note is emptied, never deleted, while live; sealed after.

alter table shift_note_docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table shift_note_docs;
exception when duplicate_object then null;
end $$;

comment on table shift_note_docs is
  'One shift note per (studio, shift-day, author) — the Slack-replacement big text field (2026-08-26). Continuously autosaved by the runner shift-notes page; seals at 8:50 AM LA like the retired shift_log_entries.';

commit;
