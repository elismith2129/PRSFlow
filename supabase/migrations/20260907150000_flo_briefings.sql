-- FLO'S AI BRIEFING (Eli, 2026-09-07): "i want there to be a thing that not
-- only gives briefing but is able to see where they are lacking... helpful
-- accountability." One row per operational day (the 8:50 AM boundary),
-- written ONLY by the cron route /api/cron/flo-briefing (service role — no
-- authenticated write policy on purpose).
--
--   shared — jsonb string[]: the narrative every viewer sees.
--   slices — jsonb { owner: string[], manager: string[], billing: string[],
--            asst_manager: string[] }: per-seat accountability. The RULING
--            (Eli): each person sees their own slice; owners see all.
--            Enforced in the UI (the dashboard picks by role), not RLS —
--            same posture as imported-booking read-onlyness. It is a
--            courtesy boundary, not a security one; nothing here is secret
--            from staff, it is about not calling people out in public.
create table if not exists flo_briefings (
  id uuid primary key default gen_random_uuid(),
  date text not null unique,          -- opsToday() key, e.g. '2026-09-07'
  model text,                          -- which model wrote it, for the record
  shared jsonb not null default '[]'::jsonb,
  slices jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table flo_briefings enable row level security;

-- Any signed-in staff member may read (the UI slices by role).
create policy "flo_briefings_read" on flo_briefings
  for select to authenticated using (true);
-- No insert/update/delete policies: the service-role cron is the only writer.

-- Realtime: the dashboard listens so the briefing appears the moment the
-- 8:50 cron lands, with no refresh (the standing rule).
alter publication supabase_realtime add table flo_briefings;
alter table flo_briefings replica identity full;
