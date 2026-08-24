-- ---------------------------------------------------------------------------
-- My Day: per-person note ENTRIES replace the shared per-role scratchpad
-- (Ruling 2026-08-24, Eli.)
--
-- WHY: the shift notes replace the "manager notes" email chain. Every day two
-- managers (an opener and a closer) each submit notes that everybody can
-- reference later. The old model — myday_notes, ONE row per role per day with
-- two shared text columns — could not do that:
--   • opener and closer typed into the SAME box; last debounce won, and with
--     two tabs open one silently overwrote the other (myday_notes was never in
--     the page's realtime channel, so neither saw the other's text);
--   • attribution was only "last editor" (updated_by);
--   • nothing ever read past days — the log everyone references did not exist.
--
-- NEW MODEL: myday_note_entries — append-style, one row per submitted note,
-- like the email chain it replaces. `role` is the CARD the note was posted
-- from ('manager'|'billing' — an asst_manager posts onto the manager card);
-- `kind` keeps the two existing categories (session|studio); author + time are
-- first-class. myday_notes stays in place read-only as history (backfilled
-- below) — do not write new code against it.
--
-- ACCESS (Eli 2026-08-24: "all admin has access to read and write and
-- submit"): owner, manager, billing AND asst_manager — read + insert; authors
-- edit/delete their own entries; owner may delete any. tech/runner: nothing.
--
-- Idempotent; run by hand in the Supabase SQL editor (working-conventions).
-- ---------------------------------------------------------------------------

begin;

create table if not exists myday_note_entries (
  id          uuid primary key default gen_random_uuid(),
  role        text not null check (role in ('manager', 'billing')),
  date        date not null,
  kind        text not null check (kind in ('session', 'studio')),
  body        text not null,
  created_by  uuid references user_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists myday_note_entries_date_idx
  on myday_note_entries (date desc, created_at);

-- updated_at trigger — same guarded pattern as the 20260810120000 migration.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_myday_note_entries_updated on myday_note_entries;
    create trigger trg_myday_note_entries_updated before update on myday_note_entries
      for each row execute function set_updated_at();
  else
    raise notice 'set_updated_at() not found — myday_note_entries updated_at trigger skipped';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Backfill: carry every non-empty legacy scratchpad box over as one entry,
-- attributed to the last editor at the time it was last touched. Guarded per
-- (role, date, kind) so re-running the migration cannot duplicate.
-- ---------------------------------------------------------------------------

insert into myday_note_entries (role, date, kind, body, created_by, created_at)
select n.role, n.date, 'session', n.session_notes, n.updated_by, n.updated_at
from myday_notes n
where coalesce(trim(n.session_notes), '') <> ''
  and not exists (
    select 1 from myday_note_entries e
    where e.role = n.role and e.date = n.date and e.kind = 'session'
  );

insert into myday_note_entries (role, date, kind, body, created_by, created_at)
select n.role, n.date, 'studio', n.studio_notes, n.updated_by, n.updated_at
from myday_notes n
where coalesce(trim(n.studio_notes), '') <> ''
  and not exists (
    select 1 from myday_note_entries e
    where e.role = n.role and e.date = n.date and e.kind = 'studio'
  );


-- ---------------------------------------------------------------------------
-- RLS — note the widened circle: asst_manager reads AND writes here, unlike
-- every other myday_* table. Attribution comes from created_by, enforced at
-- insert (no posting as somebody else).
-- ---------------------------------------------------------------------------

alter table myday_note_entries enable row level security;

drop policy if exists myday_note_entries_sel on myday_note_entries;
create policy myday_note_entries_sel on myday_note_entries for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists myday_note_entries_ins on myday_note_entries;
create policy myday_note_entries_ins on myday_note_entries for insert to authenticated
  with check (
    get_my_role() in ('owner', 'manager', 'billing', 'asst_manager')
    and created_by = get_my_profile_id()
  );

drop policy if exists myday_note_entries_upd on myday_note_entries;
create policy myday_note_entries_upd on myday_note_entries for update to authenticated
  using (
    get_my_role() in ('owner', 'manager', 'billing', 'asst_manager')
    and created_by = get_my_profile_id()
  )
  with check (created_by = get_my_profile_id());

drop policy if exists myday_note_entries_del on myday_note_entries;
create policy myday_note_entries_del on myday_note_entries for delete to authenticated
  using (
    created_by = get_my_profile_id()
    or get_my_role() = 'owner'
  );


-- Explicit grants (new-table rule — grandfathering ends 2026-10-30).
grant select, insert, update, delete on myday_note_entries to authenticated;


-- Realtime: publication membership + full replica identity (standing rule).
alter table myday_note_entries replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'myday_note_entries'
  ) then
    alter publication supabase_realtime add table myday_note_entries;
  end if;
end $$;


comment on table myday_note_entries is
  'My Day shift notes, per-person entries (2026-08-24) — replaces the shared myday_notes scratchpad. One row per submitted note; role = the card it was posted from, kind = session|studio. The referenceable log the manager-notes email chain used to be. myday_notes is legacy read-only history.';

comment on table myday_notes is
  'LEGACY (2026-08-24) — superseded by myday_note_entries (per-person entries). Backfilled into it; kept for history. Do not write new code against this table.';

commit;
