-- Shift logs + Daily Ops review markers — spec §19 (RULING 2026-08-14).
--
-- shift_log_entries: replaces the Slack shift-notes post. APPEND-ONLY log per
-- studio per night — multiple authors (mid-shift handoffs), each entry stamped
-- who + when. No update/delete policies on purpose: like the Slack history it
-- replaces, an entry is a record, not a draft.
--
-- daily_ops_reviews: the /daily-ops queue's persistent "seen" marker. One row
-- per cleared item per day, keyed by a generic item_key
-- ('missing:track:closing_checklist', 'mic:<uuid>', …) so the queue state is
-- shared across managers. Flags are NOT marked here — clearing a flag item
-- acknowledges the flag itself (flags.status → acknowledged).
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code ships.

create table if not exists shift_log_entries (
  id uuid primary key default gen_random_uuid(),
  studio text not null check (studio in ('paramount','ameraycan','encore','track')),
  date text not null,                 -- local calendar date of the SHIFT (matches other runner tables)
  author_name text not null,          -- initials or name, typed (shared login era) or profile-derived later
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_log_studio_date on shift_log_entries(studio, date);

alter table shift_log_entries enable row level security;

drop policy if exists shift_log_sel on shift_log_entries;
create policy shift_log_sel on shift_log_entries
  for select to authenticated using (true);

drop policy if exists shift_log_ins on shift_log_entries;
create policy shift_log_ins on shift_log_entries
  for insert to authenticated with check (true);

-- No UPDATE or DELETE policies — append-only by design.

create table if not exists daily_ops_reviews (
  id uuid primary key default gen_random_uuid(),
  date text not null,                 -- the reviewed night (the queue's date)
  item_key text not null,             -- e.g. 'missing:track:closing_checklist'
  reviewed_by text,                   -- display name / initials
  reviewed_at timestamptz not null default now(),
  unique (date, item_key)
);

alter table daily_ops_reviews enable row level security;

drop policy if exists dor_sel on daily_ops_reviews;
create policy dor_sel on daily_ops_reviews
  for select to authenticated using (true);

drop policy if exists dor_ins on daily_ops_reviews;
create policy dor_ins on daily_ops_reviews
  for insert to authenticated
  with check (get_my_role() in ('owner','manager','asst_manager'));

drop policy if exists dor_del on daily_ops_reviews;
create policy dor_del on daily_ops_reviews
  for delete to authenticated
  using (get_my_role() in ('owner','manager','asst_manager'));

-- Realtime (hard rule: every fetch pairs with a subscription).
alter table shift_log_entries replica identity full;
alter table daily_ops_reviews replica identity full;
do $$
begin
  alter publication supabase_realtime add table shift_log_entries;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table daily_ops_reviews;
exception when duplicate_object then null;
end $$;
