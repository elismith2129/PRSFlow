-- ROOM LOCK (Eli, 2026-11-19; mock docs/design-refs/room-lock-options.html).
-- COD clients run past their booked time at 3am and won't pay. Each room's Mac
-- runs a small agent (scripts/room-lock) that asks PRSFlo every few seconds
-- whether the room is unlocked, in its 30-minute warning, or locked.
--
-- Three tables:
--   room_locks          one row per room: state, when it locks, who changed it,
--                       the room Mac's secret key, when the Mac last checked in
--   room_lock_settings  one row: the staff PIN that clears a lock at the room
--   room_lock_log       every lock / unlock / warning / PIN change, who, when
--
-- Owners and managers read all three. NOBODY writes them directly: every change
-- goes through a function below so the change and its log line land together.
-- The room Mac has no login; it calls room_lock_poll / room_lock_pin_unlock
-- with its room's key, and gets nothing without it.
-- Idempotent.

create table if not exists public.room_locks (
  room_slug     text primary key,
  location      text not null,
  studio        text not null,
  state         text not null default 'unlocked' check (state in ('unlocked', 'warning', 'locked')),
  lock_at       timestamptz,
  changed_by    text,
  changed_at    timestamptz,
  agent_key     text not null default replace(gen_random_uuid()::text, '-', ''),
  agent_seen_at timestamptz
);

insert into public.room_locks (room_slug, location, studio) values
  ('prs-a', 'Paramount', 'Studio A'), ('prs-b', 'Paramount', 'Studio B'),
  ('prs-c', 'Paramount', 'Studio C'), ('prs-e', 'Paramount', 'Studio E'),
  ('prs-x', 'Paramount', 'Studio X'),
  ('ars-a', 'Ameraycan', 'Studio A'), ('ars-b', 'Ameraycan', 'Studio B'),
  ('ers-a', 'Encore', 'Studio A'),    ('ers-b', 'Encore', 'Studio B'),
  ('trk-north', 'Track', 'North'),    ('trk-south', 'Track', 'South')
on conflict (room_slug) do nothing;

create table if not exists public.room_lock_settings (
  id         integer primary key default 1 check (id = 1),
  staff_pin  text not null check (staff_pin ~ '^[0-9]{6}$'),
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.room_lock_settings (id, staff_pin)
values (1, lpad(floor(random() * 1000000)::int::text, 6, '0'))
on conflict (id) do nothing;

create table if not exists public.room_lock_log (
  id         uuid primary key default gen_random_uuid(),
  room_slug  text,
  action     text not null,
  by_name    text,
  created_at timestamptz not null default now()
);
create index if not exists room_lock_log_created_idx on public.room_lock_log (created_at desc);

alter table public.room_locks         enable row level security;
alter table public.room_lock_settings enable row level security;
alter table public.room_lock_log      enable row level security;

drop policy if exists room_locks_sel on public.room_locks;
create policy room_locks_sel on public.room_locks
  for select to authenticated using ((select get_my_role()) in ('owner', 'manager'));
drop policy if exists room_lock_settings_sel on public.room_lock_settings;
create policy room_lock_settings_sel on public.room_lock_settings
  for select to authenticated using ((select get_my_role()) in ('owner', 'manager'));
drop policy if exists room_lock_log_sel on public.room_lock_log;
create policy room_lock_log_sel on public.room_lock_log
  for select to authenticated using ((select get_my_role()) in ('owner', 'manager'));

grant select on public.room_locks, public.room_lock_settings, public.room_lock_log to authenticated;
grant all    on public.room_locks, public.room_lock_settings, public.room_lock_log to service_role;

-- ── Office: lock / unlock / start the 30-minute warning ─────────────────────
create or replace function public.room_lock_set(p_room text, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if coalesce(get_my_role(), '') not in ('owner', 'manager') then
    raise exception 'Only owners and managers can lock or unlock a room.';
  end if;
  if p_action not in ('lock', 'unlock', 'warn') then
    raise exception 'Unknown action %', p_action;
  end if;
  select coalesce(display_name, email) into v_name from user_profiles where auth_user_id = auth.uid();

  update room_locks set
    state      = case p_action when 'lock' then 'locked' when 'warn' then 'warning' else 'unlocked' end,
    lock_at    = case p_action when 'warn' then now() + interval '30 minutes' else null end,
    changed_by = v_name,
    changed_at = now()
  where room_slug = p_room;
  if not found then raise exception 'No such room %', p_room; end if;

  insert into room_lock_log (room_slug, action, by_name)
  values (p_room, case p_action when 'lock' then 'Locked' when 'warn' then '30-minute warning started' else 'Unlocked' end, v_name);
end $$;

-- ── Office: change the staff PIN (the PIN itself is never logged) ───────────
create or replace function public.room_lock_set_pin(p_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if coalesce(get_my_role(), '') not in ('owner', 'manager') then
    raise exception 'Only owners and managers can change the staff PIN.';
  end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'The PIN must be exactly six digits.'; end if;
  select coalesce(display_name, email) into v_name from user_profiles where auth_user_id = auth.uid();
  update room_lock_settings set staff_pin = p_pin, updated_by = v_name, updated_at = now() where id = 1;
  insert into room_lock_log (room_slug, action, by_name) values (null, 'Staff PIN changed', v_name);
end $$;

-- ── Room Mac: "what state am I in?" ─────────────────────────────────────────
-- Returns the state, when the warning runs out, the server clock (the Mac's
-- own clock is not trusted), and a one-way scramble of the staff PIN so the
-- Mac can check a typed PIN with the internet down without ever holding the
-- PIN itself. A warning that has run out becomes a lock here.
create or replace function public.room_lock_poll(p_room text, p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare
  r   room_locks%rowtype;
  pin text;
begin
  select * into r from room_locks where room_slug = p_room and agent_key = p_key;
  if not found then raise exception 'Not authorised.'; end if;

  if r.state = 'warning' and r.lock_at is not null and r.lock_at <= now() then
    update room_locks set state = 'locked', lock_at = null,
      changed_by = 'Automatic — warning ran out', changed_at = now()
    where room_slug = p_room;
    insert into room_lock_log (room_slug, action, by_name)
    values (p_room, 'Locked', 'Automatic — warning ran out');
    r.state := 'locked'; r.lock_at := null;
  end if;

  -- "Listening" stamp, at most every 20s so the Rooms page is not woken up
  -- every three seconds by eleven rooms.
  if r.agent_seen_at is null or r.agent_seen_at < now() - interval '20 seconds' then
    update room_locks set agent_seen_at = now() where room_slug = p_room;
  end if;

  select staff_pin into pin from room_lock_settings where id = 1;
  return json_build_object(
    'state',    r.state,
    'lock_at',  extract(epoch from r.lock_at),
    'now',      extract(epoch from now()),
    'pin_hash', encode(sha256(convert_to(pin || ':' || r.agent_key, 'UTF8')), 'hex')
  );
end $$;

-- ── Room Mac: "staff typed the PIN here" ────────────────────────────────────
create or replace function public.room_lock_pin_unlock(p_room text, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update room_locks set state = 'unlocked', lock_at = null,
    changed_by = 'Staff PIN at the room', changed_at = now()
  where room_slug = p_room and agent_key = p_key;
  if not found then raise exception 'Not authorised.'; end if;
  insert into room_lock_log (room_slug, action, by_name) values (p_room, 'Unlocked', 'Staff PIN at the room');
end $$;

revoke all on function public.room_lock_set(text, text)        from public, anon;
revoke all on function public.room_lock_set_pin(text)          from public, anon;
grant execute on function public.room_lock_set(text, text)     to authenticated;
grant execute on function public.room_lock_set_pin(text)       to authenticated;
grant execute on function public.room_lock_poll(text, text)        to anon, authenticated;
grant execute on function public.room_lock_pin_unlock(text, text)  to anon, authenticated;

-- Realtime: the Rooms page subscribes to all three.
alter table public.room_locks replica identity full;
do $$ begin alter publication supabase_realtime add table public.room_locks;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.room_lock_settings;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.room_lock_log;
exception when duplicate_object then null; end $$;

select count(*) as rooms_ready from public.room_locks;   -- expect 11
