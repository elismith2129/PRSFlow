-- Drop every leftover wide-open RLS policy (2026-08-14 live-DB audit).
--
-- WHAT THIS FIXES. The July 2 hardening (20260702161117) created the tiered
-- role policies and dropped the legacy "Public access" ones it knew about —
-- but the live DB audit (runner-login rollout, 2026-08-14) found ~40 OLDER
-- open policies still standing: "authenticated access" (ALL, to any logged-in
-- user) on ~20 tables, "Public access"/"open access" (ALL, including anon) on
-- several, plus a pile of per-table anon read/insert/update/delete policies
-- from the pre-PIN public-runner era. Postgres RLS policies are PERMISSIVE
-- (they OR together), so any one open policy bypasses the entire tiered
-- system. user_profiles was effectively open to the internet.
--
-- WHAT IT DOES. Dynamically drops every policy in public whose USING /
-- WITH CHECK is literally `true`, EXCEPT the tables where open-to-
-- authenticated is the documented design:
--   app_feedback            any-auth read/insert (rollout feedback board)
--   dashboard_task_comments open by design, append-only
--   studio_tasks            any-auth (shared runner login must read/write)
--   test_results            tester board
--   venue_open_items        read-only reference
-- Dynamic (pg_policies-driven) rather than name-by-name so it also catches
-- any open policy the audit pastes didn't reach.
--
-- RUN ORDER (all by hand, Supabase SQL editor):
--   1. This file.
--   2. Re-run 20260702161117_rls_security_hardening.sql in full — it is
--      idempotent (guarded DO blocks, DROP IF EXISTS before every CREATE)
--      and guarantees the tiered set exists on every table.
--   3. Verify: the audit query below must return ONLY the allowlisted tables.
--   4. Click-test as admin AND as the runner PIN — a missing tiered policy
--      shows up as a red "NOT saved" toast or an empty panel.
--
-- Verify query (step 3):
--   select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and coalesce(qual, with_check) in ('true','(true)')
--   order by tablename, cmd;

do $$
declare
  p record;
  dropped int := 0;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and coalesce(qual, with_check) in ('true', '(true)')
      and tablename not in (
        'app_feedback',
        'dashboard_task_comments',
        'studio_tasks',
        'test_results',
        'venue_open_items'
      )
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    raise notice 'dropped % on %', p.policyname, p.tablename;
    dropped := dropped + 1;
  end loop;
  raise notice 'total legacy open policies dropped: %', dropped;
end $$;
