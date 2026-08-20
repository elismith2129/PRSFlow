-- studio_time_rows.status — the runner submit state (v1.11.0, Aug 16, 2026).
--
-- 'in_progress' → runner Submit sets today's rows to 'submitted' → office
-- approval sets 'approved' (which is also what locks the day for runners).
--
-- The column originally shipped with the old runner "Finish" flow and was
-- ALREADY PRESENT in the live DB when this was verified on Aug 16, 2026
-- (86 rows, all 'in_progress'). This file exists so the repo carries a
-- record of the column regardless of that history — per the standing
-- lesson (July 17, Aug 14): verify the end state, and keep the artifact.
--
-- Idempotent — safe to run on a database that already has both pieces.

alter table studio_time_rows
  add column if not exists status text not null default 'in_progress';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'studio_time_rows_status_check'
      and conrelid = 'studio_time_rows'::regclass
  ) then
    alter table studio_time_rows
      add constraint studio_time_rows_status_check
      check (status in ('in_progress', 'submitted', 'approved'));
  end if;
end $$;

-- Verify:
-- select column_name, column_default from information_schema.columns
--   where table_name = 'studio_time_rows' and column_name = 'status';
