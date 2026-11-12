-- FINANCIALS TIMED OUT (Eli, 2026-11-11): "Loading revenue history failed:
-- canceling statement due to statement timeout."
--
-- financial_history holds ~55k rows behind an owner-only RLS policy written
-- as `get_my_role() = 'owner'`. Postgres evaluates that per row, and
-- get_my_role() is a SECURITY DEFINER lookup that is not inlined — 55k
-- profile lookups to answer one question, past Supabase's 8s statement
-- timeout. The standard fix: wrap the call in a scalar subquery so it runs
-- once per statement as an InitPlan. Same rule, same owner-only result.
--
-- The other policies that call get_my_role() guard small tables and are
-- fine; this is the only 50k-row table. Idempotent.
drop policy if exists financial_history_select on public.financial_history;
create policy financial_history_select on public.financial_history
  for select to authenticated using ((select public.get_my_role()) = 'owner');

select count(*) as policy_ok from pg_policies
 where tablename = 'financial_history' and policyname = 'financial_history_select';
