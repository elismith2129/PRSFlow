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
-- THE SOURCE'S ACTUAL SHAPE (verified against the real workbook, 2026-08-20).
-- "PRS Daily Numbers", one tab per year 2017–2029, grain DAY × ROOM. Per room
-- it carries Studio, Rental Profit and Engineer, plus two derived columns and
-- four levels of roll-up that must never be imported. There is NO session, NO
-- client, NO artist and NO assistant column anywhere in nine years of it —
-- `client_name`/`artist_name` stay null for every historical row, and the
-- 'assistant' category has no history at all and charts as zero until PRSFlo's
-- own data takes over. Those columns exist for the live side, which does know.
--
-- LONG FORMAT, NOT WIDE. Each room's money columns become their own ROWS. Wide
-- would force the stacked chart, the room filter and the year-over-year compare
-- to each special-case a set of column names; long makes all three the same
-- group-by.
--
-- 'rental' IS PRS'S SHARE, NOT THE GROSS (Eli, 2026-08-20). Own gear rents at
-- full cost; contracted gear earns a 30% fee, and the sheet's "Rental Profit"
-- is what Paramount actually made. `rental_rows.charge` on the live side is the
-- GROSS figure and does not yet model that split, so live rentals will read
-- high against history until the work order learns the difference. That is a WO
-- change, not an import change — but it is why the rental line will step up at
-- the cutover for a reason that is not growth.
--
-- `direction` is 'revenue' for everything imported today. It exists because Eli
-- may later want what we PAY OUT charted against what we bill (assistant wages,
-- engineer splits, rental cost) — and adding that as a second value is a one
-- word insert, where adding it as four more columns is a migration plus a
-- rewrite of every consumer.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the Financials tab
-- ships. Import is two separate steps: scripts/extract-financial-history.py
-- (workbook → one CSV per year, reconciled against the sheet's own roll-ups)
-- then scripts/import-financial-history.mjs (CSVs → this table).

create table if not exists financial_history (
  id            uuid primary key default gen_random_uuid(),

  session_date  date not null,

  -- Venue + room as PLAIN TEXT, normalised by the extractor to lib/studios.ts
  -- vocabulary so a historical room and a live one are the same string and land
  -- in the same filter chip:
  --   venue: 'Paramount' | 'Ameraycan' | 'Encore' | 'Track'
  --   room:  'Studio A'..'Studio X', or 'North' | 'South' for Track
  -- Deliberately not a FK, for two reasons. The sheet's own headers drift
  -- (Track was NTH/STH in 2020, N/S after, and one header lost its separator
  -- entirely), and SEVEN of the nineteen rooms here — PRS D/F/H, ARS C,
  -- ERS C/D/E, $2.5M of lifetime revenue — are not in STUDIO_LOCATIONS at all.
  -- A FK would reject a third of the archive to enforce a list that is itself
  -- incomplete.
  venue         text not null,
  room          text not null,

  category      text not null
    check (category in ('room', 'assistant', 'engineering', 'rental')),

  direction     text not null default 'revenue'
    check (direction in ('revenue', 'expense')),

  amount        numeric(12,2) not null,

  client_name   text,
  artist_name   text,

  -- Provenance. `source_file` is a stable label ('PRS Daily Numbers.xlsx'),
  -- `source_key` is '<tab>#<date>#<venue>#<room>' — deterministic and readable,
  -- so a re-run of the importer upserts instead of doubling the books, and a
  -- suspect figure can be traced back to one cell in one tab. A hash would do
  -- the same job while telling nobody anything.
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
