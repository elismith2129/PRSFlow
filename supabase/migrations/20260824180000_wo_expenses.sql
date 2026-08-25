-- ---------------------------------------------------------------------------
-- Food-budget expense report (Eli, 2026-08-24 — mocks wo-food-budget.html +
-- wo-top-rework.html). Digitizes the paper "Food Budget" sheet the labels
-- get in the invoice package: Date · Place of Business · Amount (incl. tip),
-- one row per receipt, plus a receipt PHOTO per row — which retires the
-- splay-receipts-on-the-scanner ritual (the photos become package pages).
--
-- wo_expenses — one row per receipt, keyed to the work order.
--   • amount is TEXT like every WO money field (CLAUDE.md); math parses it.
--   • receipt_path points into the private checklist-photos bucket
--     (wo-receipts/{workOrderId}/…), served via signed URLs like every other
--     private photo. The PDF package embeds them server-side.
--   • The budget on/off + amount already live on work_orders
--     (food_budget / food_amount) — no new WO columns.
--
-- RLS mirrors rental_rows (read staff+runner+tech · write staff+runner),
-- EXCEPT delete: runners may delete expense rows too — the receipts are
-- their own entries and a typo'd row shouldn't need a manager.
--
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

create table if not exists wo_expenses (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references work_orders(id) on delete cascade,
  date           text not null default '',
  place          text not null default '',
  amount         text not null default '',
  receipt_path   text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists wo_expenses_wo_idx on wo_expenses (work_order_id, sort_order);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_wo_expenses_updated on wo_expenses;
    create trigger trg_wo_expenses_updated before update on wo_expenses
      for each row execute function set_updated_at();
  else
    raise notice 'set_updated_at() not found — wo_expenses updated_at trigger skipped';
  end if;
end $$;

alter table wo_expenses enable row level security;

drop policy if exists wo_expenses_sel on wo_expenses;
create policy wo_expenses_sel on wo_expenses for select to authenticated
  using (get_my_role() in ('asst_manager','billing','manager','owner','runner','tech'));

drop policy if exists wo_expenses_ins on wo_expenses;
create policy wo_expenses_ins on wo_expenses for insert to authenticated
  with check (get_my_role() in ('asst_manager','billing','manager','owner','runner'));

drop policy if exists wo_expenses_upd on wo_expenses;
create policy wo_expenses_upd on wo_expenses for update to authenticated
  using (get_my_role() in ('asst_manager','billing','manager','owner','runner'))
  with check (get_my_role() in ('asst_manager','billing','manager','owner','runner'));

drop policy if exists wo_expenses_del on wo_expenses;
create policy wo_expenses_del on wo_expenses for delete to authenticated
  using (get_my_role() in ('asst_manager','billing','manager','owner','runner'));

grant select, insert, update, delete on wo_expenses to authenticated;

alter table wo_expenses replica identity full;
do $$ begin
  alter publication supabase_realtime add table wo_expenses;
exception when duplicate_object then null;
end $$;

comment on table wo_expenses is
  'Food-budget expense report rows (2026-08-24) — the paper sheet''s Date · Place · Amount (incl. tip), one row per receipt, receipt photo in checklist-photos/wo-receipts/. Budget flag+amount live on work_orders.food_budget/food_amount. Rendered into the invoice PDF package with receipt photos as pages.';

commit;
