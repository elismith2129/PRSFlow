-- 2026-09-24 — Collection notes on the billing row (Eli).
--
-- "A small click to add notes; on the row just an indication that a note
-- exists; view them in the pop-up — a big text box with log entries and
-- initials auto-made." Operations notes about COLLECTING the money: called
-- Tuesday, PO comes from Maria, card declined twice, use Zelle.
--
-- ITS OWN TABLE, ON PURPOSE. Internal only: never on the work order screen,
-- never on the package/PDF, never in the activity log, never on the runner
-- app. Keeping it out of work_orders / wo_activity is what guarantees that —
-- nothing that renders those can render this. Append-only: a collections
-- note is a trail ("who told the client what, when"), so no update/delete.
-- Office roles only, read and write.

create table if not exists wo_collection_notes (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  author_name   text,
  initials      text,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists wo_collection_notes_wo_idx on wo_collection_notes (work_order_id, created_at desc);

alter table wo_collection_notes enable row level security;

drop policy if exists wo_collection_notes_sel on wo_collection_notes;
create policy wo_collection_notes_sel on wo_collection_notes for select to authenticated
  using (get_my_role() in ('owner','manager','billing','asst_manager'));

drop policy if exists wo_collection_notes_ins on wo_collection_notes;
create policy wo_collection_notes_ins on wo_collection_notes for insert to authenticated
  with check (get_my_role() in ('owner','manager','billing','asst_manager'));

-- Post-May-30 tables need explicit grants (CLAUDE.md).
grant select, insert on wo_collection_notes to authenticated;

-- Realtime: the dot on the row and the open pop-up update without a refresh.
alter table wo_collection_notes replica identity full;
do $$ begin
  alter publication supabase_realtime add table wo_collection_notes;
exception when duplicate_object then null; end $$;
