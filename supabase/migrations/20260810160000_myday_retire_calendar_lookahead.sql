-- ===========================================================================
-- MY DAY — retire "Calendar look-ahead" (RULING 2026-08-10, Eli)
--
-- Second pass over the manager card, which was transcribed from the FD Daily
-- Notes Template — a document describing the pre-PRSFlo, paper-era workflow.
--
-- Eli's review of the remaining three: "keep staff task and time cards. no cal
-- look-ahead."
--
--   KEEP  mgr_staff_tasks_review
--   KEEP  mgr_adp_timecards
--   CUT   mgr_calendar_lookahead  ← this migration
--
-- Retired, not deleted (is_active = false), so any myday_entries recorded
-- against it keep their history — same reasoning as 20260810150000.
--
-- Also removed from the base seed in 20260810120000 so a fresh database never
-- creates it; that seed's ON CONFLICT DO UPDATE deliberately leaves is_active
-- alone, so replaying it cannot resurrect a retired duty.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

update myday_duties
   set is_active = false
 where duty_key = 'mgr_calendar_lookahead';

commit;
