-- 2026-09-24 — Personal recurring items on "Your list" (Eli).
--
-- "Lori — anyone with a task list — can add tasks for herself: a single task,
-- or a recurring one: daily, weekly, monthly, and set the day. But she can't
-- remove any task I created. Those are permanent."
--
-- The recurring engine already exists (myday_duties: cadence + due_days,
-- lateness/backlog in lib/myday). Two columns make a duty PERSONAL and one
-- makes it PERMANENT:
--   owner_profile_id  NULL = the role's duty (every existing row); set = one
--                     person's own item. Still carries `role` so the seat's
--                     card picks it up unchanged.
--   created_by        who made it.
--   locked            true = set by an owner (or seeded) — nobody but an owner
--                     may edit or retire it. Written by the app at insert
--                     (creator's role is owner) and backfilled true here.
-- Removing a personal duty is is_active=false, never DELETE — past ticks stay.

alter table myday_duties add column if not exists owner_profile_id uuid references user_profiles(id) on delete set null;
alter table myday_duties add column if not exists created_by       uuid references user_profiles(id) on delete set null;
alter table myday_duties add column if not exists locked           boolean not null default false;

-- Everything that exists today was seeded by Eli: permanent.
update myday_duties set locked = true where created_by is null;

-- INSERT: office roles may add; billing joins (it could only read before).
drop policy if exists myday_duties_ins on myday_duties;
create policy myday_duties_ins on myday_duties for insert to authenticated
  with check (get_my_role() in ('owner', 'manager', 'billing'));

-- UPDATE: an owner may edit anything; anyone else only their own UNLOCKED rows.
drop policy if exists myday_duties_upd on myday_duties;
create policy myday_duties_upd on myday_duties for update to authenticated
  using (
    get_my_role() = 'owner'
    or (get_my_role() in ('manager', 'billing') and not locked and created_by = get_my_profile_id())
  )
  with check (
    get_my_role() = 'owner'
    or (get_my_role() in ('manager', 'billing') and not locked and created_by = get_my_profile_id())
  );

-- DELETE stays owner-only (unchanged). The app retires with is_active=false.
