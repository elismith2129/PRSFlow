-- FOLLOW-UP LIST (owner + Eli, 2026-10-22/23).
-- "A list of people that didn't book but that I think are potentials that we
-- hit up once a week. Say last 90 days." Mock: docs/design-refs/
-- follow-up-list-options.html (round 2, C1).
--
-- 1. leads.follow_rating — ONE manual rating, 1–3, size and seriousness
--    folded together (3 = big and real, 1 = small or a long shot). NULL =
--    unranked; unranked leads sit at the top of the list so none fall
--    through. No 0–100 score (ruled out Oct 22: size data isn't reliably
--    entered, so nothing is derived).
-- 2. A follow-up is a lead_activity row with type = 'followup'
--    ("XX - Follow-up · Text - note"). No new table: the lead's Activity
--    already shows every type, and the list reads the newest row per lead
--    for "last followed up" and "done this week". RLS on lead_activity
--    already lets asst_manager / billing / manager / owner insert.
-- Idempotent.

alter table public.leads add column if not exists follow_rating smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_follow_rating_range' and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_follow_rating_range check (follow_rating between 1 and 3);
  end if;
end $$;

create index if not exists lead_activity_followup_idx
  on public.lead_activity (lead_id, created_at desc)
  where type = 'followup';

-- Result: rating_column = 1 means it worked. type_checks must be 0 — any
-- CHECK on lead_activity.type would block the new 'followup' rows.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'follow_rating') as rating_column,
  (select count(*) from pg_constraint
    where conrelid = 'public.lead_activity'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%type%') as type_checks;
