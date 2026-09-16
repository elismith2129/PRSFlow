-- ===========================================================================
-- FLAGS — one page, two departments (Eli, 2026-09-15).
-- Mock: docs/design-refs/flags-options.html (round 3).
--
-- A FLAG is anything that needs doing. A task is a flag someone typed by
-- hand. Same row: dashboard_tasks IS the flag row from here on (it already
-- had source / source_id / photo / comments / RLS). A flag is never nobody's:
-- its KIND decides its DEPARTMENT the moment it exists.
--
--     kind                → department
--     facility, gear      → tech      (mics are gear)
--     clients_billing,    → admin
--     office
--
-- `flags` stays as the INTAKE table for the runner checklist (Needs Attention)
-- and the WO popup (wo_flag) — neither of those code paths changes. Every
-- flags row is mirrored into dashboard_tasks by trigger; done on the task
-- resolves the flag, so the Admin Flags tab keeps reading the same truth.
--
-- Visibility (replaces the per-person tiers of 20260702175800 + the peer
-- clause of 20260728200000 for this table):
--     tech                    every non-private row with department = 'tech'
--     owner/manager/billing/  every non-private row
--       asst_manager
--     everyone                rows they created or were assigned
--     Eli's is_private rows   Eli only (unchanged — trigger 20260702175212)
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the page ships.
-- Requires get_my_role() + get_my_profile_id() (20260702161117).
-- ===========================================================================

begin;

-- ── 1. Columns ─────────────────────────────────────────────────────────────
alter table dashboard_tasks
  add column if not exists studio          text,
  add column if not exists kind            text not null default 'office',
  add column if not exists department      text not null default 'admin',
  add column if not exists done_vendor     text,
  add column if not exists done_cost       numeric,
  add column if not exists created_by_name text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dashboard_tasks_kind_check') then
    alter table dashboard_tasks add constraint dashboard_tasks_kind_check
      check (kind in ('facility','gear','clients_billing','office'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dashboard_tasks_department_check') then
    alter table dashboard_tasks add constraint dashboard_tasks_department_check
      check (department in ('tech','admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dashboard_tasks_studio_check') then
    alter table dashboard_tasks add constraint dashboard_tasks_studio_check
      check (studio is null or studio in ('paramount','ameraycan','encore','track'));
  end if;
end $$;

-- ── 2. kind → department, always, by trigger ───────────────────────────────
create or replace function set_dashboard_task_department()
returns trigger
language plpgsql
as $$
begin
  new.department := case when new.kind in ('facility','gear') then 'tech' else 'admin' end;
  return new;
end;
$$;

drop trigger if exists trg_dashboard_task_department on dashboard_tasks;
create trigger trg_dashboard_task_department
  before insert or update of kind on dashboard_tasks
  for each row execute function set_dashboard_task_department();

-- ── 3. Backfill existing tasks ─────────────────────────────────────────────
-- Anything sitting on a tech's plate was building work; everything else was
-- office work. Department follows from kind via the trigger.
update dashboard_tasks t
   set kind = 'facility'
  from user_profiles p
 where p.id = t.assigned_to
   and p.role = 'tech'
   and t.kind = 'office';
update dashboard_tasks set kind = kind;   -- fires the department trigger for every row

-- ── 4. flags → dashboard_tasks mirror ──────────────────────────────────────
-- One task per flags row, keyed on (source, source_id = flags.id).
-- EVERY intake flag lands as Office (→ Admin). Admin triages: changing the
-- kind to Facility or Gear moves it to Tech. (Round 4, 2026-09-16 — runner
-- flags defaulting to Tech put "way too many things" on the tech list; a
-- runner's note is not a tech's job until the office says it is.)
-- Text is the runner's note, falling back to the source label.
create or replace function mirror_flag_to_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
  task_text text;
begin
  task_text := coalesce(nullif(btrim(new.runner_note), ''), new.source_label, 'Flag');

  select id into existing
    from dashboard_tasks
   where source = new.source and source_id = new.id
   order by created_at limit 1;

  if existing is null then
    insert into dashboard_tasks
      (text, assigned_role, source, source_id, source_label, studio, kind,
       photo_url, created_by_name, completed, completed_at, completed_note)
    values
      (task_text, 'admin', new.source, new.id, new.source_label, new.studio,
       'office',
       new.photo_url, new.created_by_name,
       new.status = 'resolved',
       case when new.status = 'resolved' then coalesce(new.resolved_at, now()) end,
       new.resolved_note);
  elsif TG_OP = 'UPDATE' then
    -- The runner re-saved: the note, photo and initials follow; a flag that
    -- went back to pending re-opens the task; a flag the runner cleared
    -- ("Needs attention cleared by runner") completes it.
    update dashboard_tasks
       set text            = case when new.runner_note is distinct from old.runner_note then task_text else text end,
           photo_url       = coalesce(new.photo_url, photo_url),
           created_by_name = coalesce(new.created_by_name, created_by_name),
           completed       = (new.status = 'resolved'),
           completed_at    = case when new.status = 'resolved' then coalesce(completed_at, new.resolved_at, now()) else null end,
           completed_note  = case when new.status = 'resolved' then coalesce(completed_note, new.resolved_note) else completed_note end,
           done_vendor     = coalesce(done_vendor, new.resolved_vendor),
           done_cost       = coalesce(done_cost, new.resolved_cost),
           deleted_at      = new.deleted_at,
           updated_at      = now()
     where id = existing
       and (completed is distinct from (new.status = 'resolved')
            or new.runner_note is distinct from old.runner_note
            or new.photo_url is distinct from old.photo_url
            or new.deleted_at is distinct from old.deleted_at
            or new.created_by_name is distinct from old.created_by_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mirror_flag_to_task on flags;
create trigger trg_mirror_flag_to_task
  after insert or update on flags
  for each row execute function mirror_flag_to_task();

-- ── 5. task done → flag resolved (the other direction, status only) ────────
create or replace function mirror_task_to_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
begin
  if new.source not in ('runner_flag','wo_flag') or new.source_id is null then return new; end if;
  fid := new.source_id;   -- source_id is uuid; for runner_flag / wo_flag it is flags.id

  if new.completed and not coalesce(old.completed, false) then
    update flags
       set status = 'resolved',
           resolved_at = coalesce(new.completed_at, now()),
           resolved_note = coalesce(new.completed_note, resolved_note),
           resolved_vendor = coalesce(new.done_vendor, resolved_vendor),
           resolved_cost = coalesce(new.done_cost, resolved_cost),
           resolved_by = coalesce(resolved_by, (select display_name from user_profiles where id = new.assigned_to)),
           updated_at = now()
     where id = fid and status is distinct from 'resolved';
  elsif not new.completed and coalesce(old.completed, false) then
    update flags set status = 'pending', resolved_at = null, updated_at = now()
     where id = fid and status = 'resolved';
  elsif new.deleted_at is not null and old.deleted_at is null then
    update flags set deleted_at = new.deleted_at, updated_at = now()
     where id = fid and deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mirror_task_to_flag on dashboard_tasks;
create trigger trg_mirror_task_to_flag
  after update of completed, deleted_at on dashboard_tasks
  for each row execute function mirror_task_to_flag();

-- ── 6. Backfill: every existing flag gets its task row ────────────────────
-- Same shape as the trigger's insert. Skips flags that already have one.
insert into dashboard_tasks
  (text, assigned_role, source, source_id, source_label, studio, kind,
   photo_url, created_by_name, completed, completed_at, completed_note,
   done_vendor, done_cost, deleted_at, created_at)
select
  coalesce(nullif(btrim(f.runner_note), ''), f.source_label, 'Flag'),
  'admin', f.source, f.id, f.source_label, f.studio,
  'office',
  f.photo_url, f.created_by_name,
  f.status = 'resolved',
  case when f.status = 'resolved' then coalesce(f.resolved_at, f.updated_at) end,
  f.resolved_note, f.resolved_vendor, f.resolved_cost, f.deleted_at, f.created_at
from flags f
where not exists (
  select 1 from dashboard_tasks t where t.source = f.source and t.source_id = f.id
);

-- ── 7. Visibility ──────────────────────────────────────────────────────────
drop policy if exists dashboard_tasks_sel on dashboard_tasks;
create policy dashboard_tasks_sel on dashboard_tasks for select to authenticated
  using (
    (is_private = false and get_my_role() in ('owner','manager','billing','asst_manager'))
    or (is_private = false and get_my_role() = 'tech' and department = 'tech')
    or assigned_by = get_my_profile_id()
    or assigned_to = get_my_profile_id()
  );

drop policy if exists dashboard_tasks_upd on dashboard_tasks;
create policy dashboard_tasks_upd on dashboard_tasks for update to authenticated
  using (
    (is_private = false and get_my_role() in ('owner','manager','billing','asst_manager'))
    or (is_private = false and get_my_role() = 'tech' and department = 'tech')
    or assigned_by = get_my_profile_id()
    or assigned_to = get_my_profile_id()
  )
  with check (
    (is_private = false and get_my_role() in ('owner','manager','billing','asst_manager'))
    or (is_private = false and get_my_role() = 'tech' and department = 'tech')
    or assigned_by = get_my_profile_id()
    or assigned_to = get_my_profile_id()
  );

-- INSERT: admin roles anything; tech only flags they raise themselves.
drop policy if exists dashboard_tasks_ins on dashboard_tasks;
create policy dashboard_tasks_ins on dashboard_tasks for insert to authenticated
  with check (
    get_my_role() in ('asst_manager','billing','manager','owner')
    or (get_my_role() = 'tech' and assigned_by = get_my_profile_id())
  );

-- DELETE unchanged (manager+; the page soft-deletes via UPDATE anyway).
-- dashboard_task_comments policies are EXISTS subqueries over dashboard_tasks
-- and inherit all of the above without change.

-- ── 8. Assignment roster for the page ──────────────────────────────────────
-- Tech can only read its own user_profiles row (Jul 2 hardening), so the page
-- resolves names through this instead of a profiles query. Names only.
create or replace function flag_roster()
returns table (id uuid, display_name text, role text)
language sql
security definer
stable
set search_path = public
as $$
  select id, display_name, role
    from public.user_profiles
   where deleted_at is null
     and role in ('owner','manager','billing','asst_manager','tech')
   order by case role when 'owner' then 0 when 'manager' then 1 when 'billing' then 2
                      when 'asst_manager' then 3 else 4 end, display_name
$$;
grant execute on function flag_roster() to authenticated;

commit;
