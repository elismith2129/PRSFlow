-- ═══════════════════════════════════════════════════════════════════════════
-- MY DAY RE-ANCHOR — one-off, 2026-08-19 (NOT a schema migration; rows only).
-- Run in the Supabase SQL editor. Ran by Eli at go-live, 2026-08-19.
--
-- WHY: the full launch reset (launch_reset_20260817.sql) was written but the
-- My Day section never actually ran against the live DB — min(created_at) on
-- myday_duties still showed the original seed date, so every cumulative duty
-- reported a compounding "covering N days" backlog for the whole pre-launch
-- period ("Fernando missed…" on the dashboard/briefing). Everything else was
-- already clean, so this is the My Day section alone.
--
-- WHAT: wipes duty history (entries / queue-step ticks / notes) and stamps
-- every duty's created_at to now(). lib/myday.ts clamps every retrospective
-- judgement (computeBacklog, computeOverdueSince, the 14-day grid,
-- missed-yesterday) to created_at, so day one renders no history-based red.
--
-- TOUCHES NOTHING ELSE: no bookings, WOs, CRM, flags, checklists, ops data.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

delete from myday_entries;
delete from myday_queue_steps;
delete from myday_notes;
update myday_duties set created_at = now();

commit;

-- Verify: entries/steps/notes = 0, anchor = today (UTC — an evening PT run
-- may show tomorrow's date, which is harmless).
select 'myday_entries' as t, count(*)::text as v from myday_entries
union all select 'myday_queue_steps', count(*)::text from myday_queue_steps
union all select 'myday_notes', count(*)::text from myday_notes
union all select 'anchor (min created_at)', min(created_at)::date::text from myday_duties;
