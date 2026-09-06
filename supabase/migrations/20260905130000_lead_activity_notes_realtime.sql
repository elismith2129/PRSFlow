-- Activity notes on leads (2026-09-05)
-- The CRM lead panel now writes typed entries into lead_activity with
-- type='note' ("XX - text", stamped by created_at) and subscribes to the
-- table so the Activity fold stays live. Two prerequisites in the live DB:
--
-- 1. Realtime: lead_activity must be in the publication with full replica
--    identity or the new subscription never fires. Idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'lead_activity'
  ) then
    alter publication supabase_realtime add table lead_activity;
  end if;
end $$;

alter table lead_activity replica identity full;

-- 2. Verify no CHECK constraint blocks type='note' (the table was created
--    outside the repo's migration history, so this is belt-and-braces —
--    run the SELECT and, ONLY if it shows a constraint restricting `type`,
--    the commented DROP applies):
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'lead_activity'::regclass and contype = 'c';
-- alter table lead_activity drop constraint <conname_from_above>;
