-- ---------------------------------------------------------------------------
-- Stock v3 (Eli, 2026-08-24, Option C ruling): history + categories +
-- live-sheet corrections. Run AFTER 20260824140000_stock_sections.sql.
--
-- 1. stock_checks — one row per item per date. The paper sheet's date
--    columns ARE its history (7/15 · 7/22 · 8/14 · 8/21 side by side), and
--    the runner asked to "see the other entries". stock_items.qty alone
--    can't do that — it overwrites. qty is TEXT because the real sheet says
--    "0.5", "1.25", "IFAK", "✓" — the paper's vocabulary is richer than an
--    integer and the app must not be dumber than the clipboard it replaces.
--
-- 2. stock_items.category — the Option C collapsible groups (Dairy &
--    Creamers, Cleaning, …). Assigned by sort ranges from the 140000 seed.
--    NULL category renders in a single flat group (all non-paramount studios).
--
-- 3. Office list corrected to the LIVE clipboard sheet (photo 2026-08-24),
--    which drifted from the 2024 PDF: Large/Small Post-It Notes are
--    "6 Individuals" (was 3 Packs), and Paper Clips is ONE line, 1 Box
--    (was Big/Small at 2 Boxes each).
--
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

-- ── 1. Per-date check history ───────────────────────────────────────────────

create table if not exists stock_checks (
  id             uuid primary key default gen_random_uuid(),
  stock_item_id  uuid not null references stock_items(id) on delete cascade,
  date           date not null,
  qty            text not null default '',
  low            boolean not null default false,
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (stock_item_id, date)
);

create index if not exists stock_checks_item_date_idx
  on stock_checks (stock_item_id, date desc);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_stock_checks_updated on stock_checks;
    create trigger trg_stock_checks_updated before update on stock_checks
      for each row execute function set_updated_at();
  else
    raise notice 'set_updated_at() not found — stock_checks updated_at trigger skipped';
  end if;
end $$;

-- Same access model as stock_items: any signed-in user (runners included).
alter table stock_checks enable row level security;
drop policy if exists stock_checks_all on stock_checks;
create policy stock_checks_all on stock_checks
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on stock_checks to authenticated;

alter table stock_checks replica identity full;
do $$ begin
  alter publication supabase_realtime add table stock_checks;
exception when duplicate_object then null;
end $$;

comment on table stock_checks is
  'Per-item per-date stock check — the paper sheet''s date columns (2026-08-24). qty is text on purpose: the clipboard says "0.5", "IFAK", "✓". Latest row also mirrors onto stock_items.qty/low/notes for the surfaces that read current state.';


-- ── 2. Categories (Option C groups) — paramount nightly list ────────────────

alter table stock_items add column if not exists category text;

update stock_items set category = c.cat
from (values
  (1, 14,  'Dairy & Creamers'),
  (15, 26, 'Cleaning'),
  (27, 35, 'Water & Snacks'),
  (36, 36, 'Paper & Restroom'),   -- Kleenex
  (37, 43, 'Coffee & Tea'),
  (44, 45, 'Kitchen & Supplies'), -- plastic wrap, foil
  (46, 51, 'Food & Condiments'),  -- sugars, sweeteners, jelly
  (52, 55, 'Kitchen & Supplies'), -- Finish, hand soap, laundry, dryer sheets
  (56, 60, 'Coffee & Tea'),       -- Keurigs, hot chocolate
  (61, 66, 'Kitchen & Supplies'), -- straws, toothpicks, lighters, gloves
  (67, 81, 'Food & Condiments'),  -- bagels … salt, sugar bag
  (82, 83, 'Paper & Restroom'),   -- trash bags
  (84, 84, 'Batteries & Misc'),   -- RAID
  (85, 91, 'Paper & Restroom'),   -- TP … cutlery
  (92, 98, 'Batteries & Misc')    -- Glade, batteries, ear plugs
) as c(lo, hi, cat)
where studio = 'paramount' and section = 'stock'
  and sort_order between c.lo and c.hi;

comment on column stock_items.category is
  'Collapsible group on the runner Stock page (Option C, 2026-08-24). NULL renders flat — non-paramount studios today.';


-- ── 3. Office list → the live clipboard sheet ───────────────────────────────

update stock_items set target = '6 Individuals'
where studio = 'paramount' and section = 'office'
  and item in ('Large Post-It Notes', 'Small Post-It Notes');

-- One "Paper Clips" line, like the sheet. Guarded so a re-run no-ops.
delete from stock_items
where studio = 'paramount' and section = 'office'
  and item in ('Big Paper Clips', 'Small Paper Clips');

insert into stock_items (studio, section, sort_order, item, target)
select 'paramount', 'office', 19, 'Paper Clips', '1 Box'
where not exists (
  select 1 from stock_items
  where studio = 'paramount' and section = 'office' and item = 'Paper Clips'
);

commit;
