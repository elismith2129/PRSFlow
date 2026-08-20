-- ─────────────────────────────────────────────────────────────────────────────
-- DUPLICATE STAFF LINES — the same person billed twice on the same day
-- 2026-08-13 · run by hand in the Supabase SQL editor
--
-- FOUND IN LIVE DATA. WO-1018 (29–30 July 2026) had, for each day, a studio row
-- carrying its staff sub-row AND a separate standalone staff row for the SAME
-- engineer — same name, same role, same $55 rate, same hours. Both feed the
-- engineer total, so those sessions bill that engineer twice. On screen it just
-- reads as "two engineering lines", which is why it went unnoticed.
--
-- HOW THEY GOT THERE, so nobody hunts for a bug that is not there: nothing
-- creates these automatically. `+ Add Engineer` deliberately pre-fills the
-- previous staff line's name, rate and times as a convenience, so pressing it on
-- a session that already had that engineer on the studio row produced an exact
-- duplicate. Likely during the 28–30 July studio-time rebuild, when the
-- sub-row-vs-standalone model was new. The $55 rate dates them — that default
-- was retired in June.
--
-- The work order screen now WARNS about this the moment it sees it (see
-- lib/woValidation.findDuplicateStaffLines), so this is a one-off clean-up of
-- what already exists, not a recurring chore.
--
-- ⚠ RUN STEP 1 AND READ IT BEFORE RUNNING STEP 2. Two lines for one person on
-- one day is LEGITIMATE when they genuinely worked two separate calls. Only you
-- can tell those apart. Step 1 shows every candidate; delete only what is wrong.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1 · LOOK FIRST ──────────────────────────────────────────────────────
-- Every standalone staff row whose person is ALSO on a studio row that same day.
select
  w.wo_number,
  w.client,
  w.status                       as wo_status,
  w.invoice_state,
  dup.date,
  dup.eng_name,
  dup.eng_role,
  dup.eng_rate,
  dup.eng_from_time,
  dup.eng_to_time,
  dup.id                         as standalone_row_id
from studio_time_rows dup
join work_orders w on w.id = dup.work_order_id
where coalesce(trim(dup.studio), '') = ''          -- a standalone staff row
  and coalesce(trim(dup.eng_name), '') <> ''
  and exists (
    select 1
    from studio_time_rows main
    where main.work_order_id = dup.work_order_id
      and coalesce(trim(main.studio), '') <> ''     -- a real studio row
      and main.date is not distinct from dup.date
      and main.eng_visible is distinct from false
      and lower(trim(main.eng_name)) = lower(trim(dup.eng_name))
  )
order by w.wo_number, dup.date;

-- ── STEP 2 · DELETE (only after reading step 1) ──────────────────────────────
-- Same predicate. Uncomment to run.
--
-- Deletes ONLY the standalone duplicate — the studio row and its sub-row are
-- untouched, so the engineer is still billed once. Nothing else references these
-- rows: the booking projection is rebuilt from the remaining rows on the next
-- save, and any invoice already sent keeps its stored `invoice_total`, so a
-- corrected work order shows as DRIFT rather than silently restating history.
--
-- begin;
--
-- delete from studio_time_rows dup
-- where coalesce(trim(dup.studio), '') = ''
--   and coalesce(trim(dup.eng_name), '') <> ''
--   and exists (
--     select 1
--     from studio_time_rows main
--     where main.work_order_id = dup.work_order_id
--       and coalesce(trim(main.studio), '') <> ''
--       and main.date is not distinct from dup.date
--       and main.eng_visible is distinct from false
--       and lower(trim(main.eng_name)) = lower(trim(dup.eng_name))
--   );
--
-- commit;

-- ── STEP 3 · the retired $55 ─────────────────────────────────────────────────
-- The old inherited engineer default. It is a REAL value on these rows now, so
-- it is not automatically wrong — an engineer may genuinely be at $55. Listed
-- rather than deleted, because guessing at somebody's rate is worse than leaving
-- it. Check these against what the engineer was actually owed.
--
-- select w.wo_number, s.date, s.studio, s.eng_name, s.eng_rate
-- from studio_time_rows s
-- join work_orders w on w.id = s.work_order_id
-- where trim(coalesce(s.eng_rate, '')) in ('55', '$55', '55.00', '$55.00')
-- order by s.date;
