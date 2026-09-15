-- ─────────────────────────────────────────────────────────────────────────────
-- Runner notes → a room (Eli, 2026-09-15; mock docs/design-refs/
-- runner-channel-options.html, option A).
--
--   · CHANNELS. A post belongs to a channel: the four studios, or 'general'.
--     Existing rows keep their studio; channel defaults from it.
--   · MENTIONS. user_profiles.id[] of everyone tagged, parsed at send.
--   · MENTION + TIME = A TASK. The post carries the studio_tasks id it made;
--     the task carries who it's for, the time, and the post it came from.
--   · READS. Per person per channel: the last moment they had it open. The
--     hub doorway's "3 new · 1 for you" and the room's "new since you looked"
--     divider both derive from this. Nothing is scheduled.
--   · ROSTER. Runners can only SELECT their own user_profiles row (RLS
--     hardening, Jul 2). Tagging needs names, so a SECURITY DEFINER function
--     returns id / name / initials / role for active profiles — names only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Posts: channel, mentions, task ───────────────────────────────────────────
alter table public.runner_note_posts
  add column if not exists channel  text,
  add column if not exists mentions uuid[] not null default '{}',
  add column if not exists task_id  uuid;

update public.runner_note_posts set channel = studio where channel is null;
alter table public.runner_note_posts alter column channel set not null;
alter table public.runner_note_posts alter column studio drop not null;

alter table public.runner_note_posts drop constraint if exists runner_note_posts_channel_check;
alter table public.runner_note_posts
  add constraint runner_note_posts_channel_check
  check (channel in ('paramount', 'ameraycan', 'encore', 'track', 'general'));

create index if not exists runner_note_posts_channel_created_idx
  on public.runner_note_posts (channel, created_at desc);
create index if not exists runner_note_posts_mentions_idx
  on public.runner_note_posts using gin (mentions);

-- ── Tasks: who, when, from which post ────────────────────────────────────────
alter table public.studio_tasks
  add column if not exists assigned_to uuid references public.user_profiles(id),
  add column if not exists assigned_to_name text,
  add column if not exists due_time text,
  add column if not exists post_id uuid;

-- ── Reads ────────────────────────────────────────────────────────────────────
create table if not exists public.runner_note_reads (
  user_id      uuid not null references public.user_profiles(id) on delete cascade,
  channel      text not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel)
);
alter table public.runner_note_reads enable row level security;

drop policy if exists "runner_note_reads_own" on public.runner_note_reads;
create policy "runner_note_reads_own" on public.runner_note_reads
  for select to authenticated
  using (user_id in (select id from public.user_profiles where auth_user_id = auth.uid()));
grant select on public.runner_note_reads to authenticated;
grant all on public.runner_note_reads to service_role;

-- Writes go through the RPC (the memo_seen shape): own row only, by identity.
create or replace function public.channel_read(p_channel text)
returns void language sql security definer set search_path = public as $$
  insert into public.runner_note_reads (user_id, channel, last_read_at)
  select id, p_channel, now() from public.user_profiles where auth_user_id = auth.uid()
  on conflict (user_id, channel) do update set last_read_at = now()
$$;
grant execute on function public.channel_read(text) to authenticated;

-- ── Roster for tagging: names only, every signed-in person ───────────────────
create or replace function public.mention_roster()
returns table (id uuid, display_name text, initials text, role text)
language sql security definer set search_path = public stable as $$
  select id, display_name, initials, role
  from public.user_profiles
  where deleted_at is null
    and coalesce(email, '') <> 'runner@paramountrecording.com'
  order by display_name
$$;
grant execute on function public.mention_roster() to authenticated;

-- Realtime: reads are per-person; the hub listens for posts (already
-- published) and refetches its own read row — no publication change needed.
