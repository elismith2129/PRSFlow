-- NO SHOW (Eli, 2026-10-05): "a 'no show' option on the WO card when artists
-- don't show up. this would be only right beside the actual arrival times."
--
-- One flag per studio-time row, beside Arrived / Left. It is the THIRD answer
-- to "when was the client actually here": a time, a blank someone forgot, or
-- "they never came". Set by the No show chip; cleared the moment an Arrived or
-- Left time is typed. It satisfies the runner's Arrived/Left submit gate.
--
-- Like the actual times it sits beside, NOTHING that computes money reads it:
-- a no-show is billed exactly as booked unless the office decides otherwise.
-- save_work_order_atomic is a generic jsonb applier, so the column is all it
-- needs (same as times_tbd, 20260919120000). Idempotent.
alter table public.studio_time_rows
  add column if not exists no_show boolean not null default false;

select count(*) as rows_total, count(*) filter (where no_show) as no_shows from public.studio_time_rows;
