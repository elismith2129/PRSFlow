-- ===========================================================================
-- venue_open_items — mutable status for the Nadine's build-out open items.
--
-- Deliberately ONE small table. The items themselves (their titles, the detail
-- text, who owns them, and whether they block external claims) live in CODE at
-- lib/nadines.ts, not here — same reasoning as test_results / lib/testBatches.ts:
--   • The item definitions are a transcription of the venue brief §5. They change
--     when a revised brief or permit set is issued, which is a commit.
--   • No migration each time an item is added or its wording sharpened.
--   • Only the human-tracked state is data: what's the status now, who's chasing
--     it, and what came back. That's all this table holds.
--
-- `item_key` matches the `key` in lib/nadines.ts OPEN_ITEMS and is UNIQUE, so the
-- UI upserts on it rather than needing a seed row per item. An item with no row
-- yet reads as 'open' — the default state — which means this table starts empty
-- and no backfill is required.
--
-- NEVER RENAME an item_key once a status has been recorded against it: the key is
-- the only link back to the code definition, so a rename orphans the history.
--
-- RLS: read is any signed-in staff member (everyone working the build-out needs
-- to see where things stand). Write excludes `tech` and `runner`, which are
-- read-only / phone-scoped roles everywhere else in the app. Delete is
-- owner/manager, so a status can be reset without a wider role wiping history.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

create table if not exists venue_open_items (
  id          uuid primary key default gen_random_uuid(),
  item_key    text not null unique,
  status      text not null default 'open'
                check (status in ('open', 'in_progress', 'resolved')),
  owner       text,
  notes       text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table venue_open_items enable row level security;

-- Read: any signed-in staff member.
drop policy if exists venue_open_items_sel on venue_open_items;
create policy venue_open_items_sel on venue_open_items for select to authenticated
  using (true);

-- Record / change a status. Excludes the read-only roles.
drop policy if exists venue_open_items_ins on venue_open_items;
create policy venue_open_items_ins on venue_open_items for insert to authenticated
  with check (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists venue_open_items_upd on venue_open_items;
create policy venue_open_items_upd on venue_open_items for update to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'))
  with check (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

-- Reset an item: owner/manager only.
drop policy if exists venue_open_items_del on venue_open_items;
create policy venue_open_items_del on venue_open_items for delete to authenticated
  using (get_my_role() in ('owner', 'manager'));

-- Explicit table grants. Tables created before 2026-05-30 are grandfathered into
-- the old blanket grants; anything newer needs these spelled out or every query
-- fails with a permission error that looks like an RLS problem but isn't.
grant select, insert, update, delete on venue_open_items to authenticated;

-- Realtime: the app's standing rule is that every fetch is paired with a
-- subscription, which requires publication membership + full replica identity.
alter table venue_open_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'venue_open_items'
  ) then
    alter publication supabase_realtime add table venue_open_items;
  end if;
end $$;

comment on table venue_open_items is
  'Mutable status for the Nadine''s build-out open items. Item definitions live in code (lib/nadines.ts OPEN_ITEMS); this table holds only status/owner/notes. Unique on item_key — upsert to change a status. A missing row reads as ''open''. Never rename an item_key.';

commit;
