-- Financial history — the years that predate PRSFlo.
--
-- WHY A SEPARATE TABLE AND NOT BACKFILLED WORK ORDERS (RULING 2026-08-20).
-- The obvious move is to synthesise work orders for the spreadsheet years so
-- one query covers everything. It is the wrong move. `work_orders` carries
-- invoice state, package/PDF state, approval triggers, projection cards and
-- realtime subscriptions; three years of dead rows would flow into the billing
-- pipeline, the calendar and My Day, and every one of those surfaces would then
-- need an "except the fake ones" clause. CLAUDE.md's standing rule is that the
-- WO is the source of truth post-creation — history has no WO and never will,
-- so inventing one makes the rule a lie.
--
-- Instead: a frozen archive table the app never writes, plus an aggregation in
-- lib/financials.ts that unions it with live money at read time. The seam is in
-- one file. When the historical window ages out, drop this table and nothing
-- else changes.
--
-- LONG FORMAT, NOT WIDE. The spreadsheet has four money columns per session
-- (room / assistant / engineering / rental). Those become four ROWS. Wide would
-- force the stacked chart, the room filter and the year-over-year compare to
-- each special-case four column names; long makes all three the same group-by.
--
-- `direction` is 'revenue' for everything imported today. It exists because Eli
-- may later want what we PAY OUT charted against what we bill (assistant wages,
-- engineer splits, rental cost) — and adding that as a second value is a one
-- word insert, where adding it as four more columns is a migration plus a
-- rewrite of every consumer.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the Financials tab
-- ships. Import is a separate step (scripts/import-financial-history.mjs).

create table if not exists financial_history (
  id            uuid primary key default gen_random_uuid(),

  session_date  date not null,

  -- Venue + room as PLAIN TEXT, matching lib/studios.ts vocabulary:
  --   venue: 'Paramount' | 'Ameraycan' | 'Encore' | 'Track'
  --   room:  'Studio A'..'Studio X', or 'North' | 'South' for Track
  -- Deliberately not a FK. The spreadsheet's room names are whatever was typed
  -- between 2023 and now; a FK would reject the import instead of letting the
  -- mapping table below absorb the variants. Unmapped rows import with the raw
  -- string so nothing is silently dropped.
  venue         text not null,
  room          text not null,

  category      text not null
    check (category in ('room', 'assistant', 'engineering', 'rental')),

  direction     text not null default 'revenue'
    check (direction in ('revenue', 'expense')),

  amount        numeric(12,2) not null,

  client_name   text,
  artist_name   text,

  -- Provenance. Which CSV/tab produced this row, and a stable hash of the
  -- source line so a re-run of the importer updates instead of duplicating.
  source_file   text not null,
  source_key    text not null,

  imported_at   timestamptz not null default now()
);

-- Re-running the importer must not double the books. The unique key is the
-- source line plus its category, so one spreadsheet row's four money columns
-- coexist while a second import of the same file is an upsert.
create unique index if not exists idx_financial_history_source
  on financial_history(source_key, category);

create index if not exists idx_financial_history_date
  on financial_history(session_date);
create index if not exists idx_financial_history_venue_date
  on financial_history(venue, room, session_date);
create index if not exists idx_financial_history_cat_date
  on financial_history(category, session_date);

alter table financial_history enable row level security;

-- OWNERS ONLY. Not manager, not billing — Eli's ruling is that the revenue
-- history is an owner surface. `get_my_role()` is the same helper the invoice
-- policies use (migration 20260811120000).
drop policy if exists financial_history_select on financial_history;
create policy financial_history_select on financial_history
  for select to authenticated using (get_my_role() = 'owner');

-- No insert/update/delete policies, deliberately. The import runs with the
-- service-role key, which bypasses RLS. Nothing in the browser may write to the
-- archive — an archive you can edit from a page is not an archive.

-- New table, created after 2026-05-30, so it is NOT grandfathered into the old
-- blanket grants and needs these explicitly.
grant select on financial_history to authenticated;

-- Realtime: the Financials tab subscribes, per the standing hard rule that
-- every Supabase fetch pairs with a channel.
alter table financial_history replica identity full;
do $$
begin
  alter publication supabase_realtime add table financial_history;
exception when duplicate_object then null;
end $$;
