-- Studio tasks — spec §15b (RULING 2026-08-14, option A · Sections).
-- Admin leaves a task on a STUDIO ("windy last night — blow the parking lot");
-- whoever opens that studio sees it on the runner hub and checks it off.
-- Scoped to studio + shift, NEVER to a person — runners rotate. This is
-- deliberately NOT dashboard_tasks: no assignment, no roles, no comments.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the hub code ships.

create table if not exists studio_tasks (
  id uuid primary key default gen_random_uuid(),
  studio text not null check (studio in ('paramount','ameraycan','encore','track')),
  task text not null,
  created_by_name text,               -- display name of whoever left it ("Fernando")
  created_at timestamptz not null default now(),
  done_at timestamptz,                -- null = open; set = checked off on the hub
  done_by text,                       -- optional initials, if ever collected
  deleted_at timestamptz              -- soft delete, matching dashboard_tasks
);

create index if not exists idx_studio_tasks_open
  on studio_tasks(studio) where deleted_at is null;

alter table studio_tasks enable row level security;

-- Any authenticated user may read and write. The shared runner PIN login is an
-- authenticated session; admins create tasks from their own logins. No delete
-- policy — removal is the soft-delete update, like dashboard_tasks.
drop policy if exists studio_tasks_select on studio_tasks;
create policy studio_tasks_select on studio_tasks
  for select to authenticated using (true);

drop policy if exists studio_tasks_insert on studio_tasks;
create policy studio_tasks_insert on studio_tasks
  for insert to authenticated with check (true);

drop policy if exists studio_tasks_update on studio_tasks;
create policy studio_tasks_update on studio_tasks
  for update to authenticated using (true) with check (true);

-- Realtime: the hub subscribes (hard rule — every fetch pairs with a channel).
alter table studio_tasks replica identity full;
do $$
begin
  alter publication supabase_realtime add table studio_tasks;
exception when duplicate_object then null;
end $$;
