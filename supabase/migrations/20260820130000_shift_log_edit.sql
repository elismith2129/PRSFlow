-- ═══════════════════════════════════════════════════════════════════════════
-- SHIFT LOG: editable while live, sealed at 8:50 AM (Eli, 2026-08-20).
-- Run in the Supabase SQL editor. Verify afterwards:
--   select column_name from information_schema.columns
--     where table_name='shift_log_entries' and column_name='edited_at';
--   select policyname from pg_policies where tablename='shift_log_entries';
--
-- WHAT: the shift log was append-only (no UPDATE policy at all) — a typo
-- could only be "fixed" by a follow-up correction entry, which read worse
-- than the typo. Now: any entry may be edited while its log is LIVE, and the
-- log seals at 8:50 AM America/Los_Angeles — the same boundary the app uses
-- for the log's date (lib/time.ts shiftLogDate: date = LA now minus 8h50m).
-- After 8:50 AM the UPDATE policy matches zero rows, so yesterday's log is
-- immutable by the time the office reviews it. Edits stamp edited_at, which
-- the page renders as an "· edited" marker.
--
-- The policy and shiftLogDate() MUST agree — if the seal time ever changes,
-- change BOTH.
-- ═══════════════════════════════════════════════════════════════════════════

alter table shift_log_entries
  add column if not exists edited_at timestamptz;

drop policy if exists "shift_log_edit_live" on shift_log_entries;

create policy "shift_log_edit_live" on shift_log_entries
  for update to authenticated
  using (
    date = to_char((now() at time zone 'America/Los_Angeles') - interval '8 hours 50 minutes', 'YYYY-MM-DD')
  )
  with check (
    date = to_char((now() at time zone 'America/Los_Angeles') - interval '8 hours 50 minutes', 'YYYY-MM-DD')
  );
