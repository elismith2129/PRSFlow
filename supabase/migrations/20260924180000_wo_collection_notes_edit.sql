-- 2026-09-24 — Collection notes are editable (Eli, same afternoon as the
-- table). Office roles may edit any note; the row keeps who last edited it
-- and when, and the pop-up says "edited". Still no delete — the trail stays.
-- Idempotent: safe to run whether or not 20260924170000 ran first (it must
-- have — this alters that table).

alter table wo_collection_notes add column if not exists updated_at timestamptz;
alter table wo_collection_notes add column if not exists edited_initials text;

drop policy if exists wo_collection_notes_upd on wo_collection_notes;
create policy wo_collection_notes_upd on wo_collection_notes for update to authenticated
  using (get_my_role() in ('owner','manager','billing','asst_manager'))
  with check (get_my_role() in ('owner','manager','billing','asst_manager'));

grant update on wo_collection_notes to authenticated;
