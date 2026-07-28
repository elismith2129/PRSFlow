-- ===========================================================================
-- app_errors → realtime publication (project standing rule: every fetched
-- table gets a subscription so the Admin Errors tab updates live).
-- Run ONCE in the Supabase SQL editor. Safe to re-run (IF-EXISTS guarded).
-- ===========================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_errors'
  ) then
    alter publication supabase_realtime add table public.app_errors;
  end if;
end $$;

alter table public.app_errors replica identity full;
