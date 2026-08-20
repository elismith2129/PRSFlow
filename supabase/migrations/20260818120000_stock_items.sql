-- stock_items — the table the runner Stock page and lib/dailyOps.ts have
-- queried since June WITHOUT IT EXISTING (ghost found 2026-08-17 during the
-- launch reset; documented in CLAUDE.md as real the whole time).
--
-- No code ships with this: the page (app/runner/[studio]/stock/page.tsx)
-- already works against exactly this shape — it seeds its default item list
-- in the UI when a studio has no rows, runners can add items, and Save
-- upserts rows + the daily_ops_submissions 'stock' marker. Creating the
-- table is the entire fix.
--
-- Idempotent. Run by hand in the SQL editor, then VERIFY:
--   select to_regclass('public.stock_items');   -- must NOT be null

create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  studio text not null,
  item text not null,
  qty integer default 0,
  notes text default '',
  low boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One row per item per studio — the page inserts unseen items on save, and
-- without this a double-save could file the same item twice.
create unique index if not exists uq_stock_items_studio_item
  on stock_items (studio, item);

alter table stock_items enable row level security;

-- Any signed-in user (runners included) reads and writes; anon gets nothing.
drop policy if exists stock_items_all on stock_items;
create policy stock_items_all on stock_items
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on stock_items to authenticated;

alter table stock_items replica identity full;
do $$ begin
  alter publication supabase_realtime add table stock_items;
exception when duplicate_object then null;
end $$;
