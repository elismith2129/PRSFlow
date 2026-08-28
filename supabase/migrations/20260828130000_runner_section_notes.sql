-- ---------------------------------------------------------------------------
-- runner_section_notes (Eli, 2026-08-28 — ARS test pass, Pass 3): a general
-- notes box on the stock lists and the mic inventory. Per-item notes existed;
-- there was nowhere to say "this whole list was entered from Ezra's account
-- and the office run is already done."
--
-- One shared note per (studio, operational day, section) — section is
-- 'stock' | 'office' | 'mics'. Shared, not per-author: it annotates the
-- LIST, and both shifts should read/extend the same note. Autosaved by the
-- pages (debounce + draft net, same engine as shift notes); surfaced to the
-- office inside Daily Ops' existing notes popup.
--
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

create table if not exists runner_section_notes (
  id         uuid primary key default gen_random_uuid(),
  studio     text not null,
  date       text not null,     -- operational day (8:50 AM roll — lib/time opsToday)
  section    text not null check (section in ('stock', 'office', 'mics')),
  text       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio, date, section)
);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_runner_section_notes_updated on runner_section_notes;
    create trigger trg_runner_section_notes_updated before update on runner_section_notes
      for each row execute function set_updated_at();
  end if;
end $$;

grant select, insert, update, delete on runner_section_notes to authenticated;

alter table runner_section_notes enable row level security;
drop policy if exists runner_section_notes_all on runner_section_notes;
create policy runner_section_notes_all on runner_section_notes
  for all to authenticated using (true) with check (true);

alter table runner_section_notes replica identity full;
do $$ begin
  alter publication supabase_realtime add table runner_section_notes;
exception when duplicate_object then null;
end $$;

comment on table runner_section_notes is
  'General notes box on the runner stock lists + mic inventory (2026-08-28). One shared note per studio/ops-day/section; autosaved; shown to the office in Daily Ops.';

commit;
