-- TIMES TBD (Eli, 2026-09-18): "a TBD button for times… for days that are
-- tentative where we don't know yet." An explicit "we haven't decided" on a
-- day, as opposed to "someone forgot to type it". Set by the TBD button on the
-- day sheet / day card; cleared the moment a time is typed. A confirmed
-- session refuses to save with it on (confirmStartProblem). Staff TBD needs
-- no column — an empty eng_name already IS "engineer, TBD" (ruling 2026-07-28).
alter table public.studio_time_rows
  add column if not exists times_tbd boolean not null default false;

select count(*) as rows_total from public.studio_time_rows;
