-- ─────────────────────────────────────────────────────────────────────────────
-- ROOM RATES ARE A TABLE (ruling 7, 2026-09-03 — approved; built 2026-09-14).
-- docs/design-refs/wo-seed-rooms-and-rates-options.html §1.
--
-- Every place a room is picked and NO rate exists yet reads from here: the
-- Add-dates prompt, the Seed panel, a blank row's room pick. Nowhere else
-- (Eli, 2026-09-14): not the lead form, never an existing row. The table
-- FILLS a rate; it never overrides one someone typed.
--
-- Why: adding ERS B beside ERS A copied A's $3,150 onto B. The blanket rate
-- allocates by that number, so one inherited rate quietly skewed every
-- room's share. A rate comes from the ROOM, not from the row above it.
--
-- day_rate is the typed number; hourly is day ÷ 10 (DAY_HOUR_RATIO, house
-- law) and is derived, never stored twice. min_hours is display-only for the
-- client rate sheet — the WO does not enforce it.
--
-- Seeded from the rate sheet with Paramount A corrected to $1,750 (it had
-- been quoted at $1,650 for months). Re-running keeps any edited rate:
-- on conflict do nothing.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.room_rates (
  id         uuid primary key default gen_random_uuid(),
  venue      text not null,          -- 'Paramount' | 'Ameraycan' | 'Encore' | 'Track'
  room       text not null,          -- the LETTER form ('A', 'X') or 'North'/'South' — what studio_time_rows.studio stores
  day_rate   numeric not null check (day_rate >= 0),
  min_hours  integer,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (venue, room)
);

comment on table public.room_rates is
  'Rack day rate per room. Fills the rate when a room is picked and none exists yet (Add-dates, Seed, blank row); never overrides a typed rate. Hourly = day_rate / 10.';

alter table public.room_rates enable row level security;

drop policy if exists room_rates_sel on public.room_rates;
create policy room_rates_sel on public.room_rates for select to authenticated
  using (get_my_role() in ('asst_manager','billing','manager','owner','runner','tech'));

drop policy if exists room_rates_ins on public.room_rates;
create policy room_rates_ins on public.room_rates for insert to authenticated
  with check (get_my_role() in ('billing','manager','owner'));

drop policy if exists room_rates_upd on public.room_rates;
create policy room_rates_upd on public.room_rates for update to authenticated
  using (get_my_role() in ('billing','manager','owner'))
  with check (get_my_role() in ('billing','manager','owner'));

drop policy if exists room_rates_del on public.room_rates;
create policy room_rates_del on public.room_rates for delete to authenticated
  using (get_my_role() in ('owner'));

insert into public.room_rates (venue, room, day_rate, min_hours, sort_order) values
  ('Paramount', 'C',     1950, 8, 10),
  ('Paramount', 'A',     1750, 8, 11),
  ('Paramount', 'B',     1550, 8, 12),
  ('Paramount', 'X',     1250, 6, 13),
  ('Paramount', 'E',      750, 4, 14),
  ('Ameraycan', 'A',     1750, 8, 20),
  ('Ameraycan', 'B',     1750, 8, 21),
  ('Encore',    'A',     1850, 8, 30),
  ('Encore',    'B',     1950, 8, 31),
  ('Track',     'North', 1950, 8, 40),
  ('Track',     'South', 1450, 8, 41)
on conflict (venue, room) do nothing;

-- Live edits in Admin → Rates should reach an open work order without a refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'room_rates'
  ) then
    alter publication supabase_realtime add table public.room_rates;
  end if;
end $$;
alter table public.room_rates replica identity full;
