-- ===========================================================================
-- MY DAY — "any day" duties (RULING 2026-08-10, Eli)
--
-- Follow-up to 20260810120000_myday.sql, which is already applied. Written as a
-- separate migration rather than an edit to that file so the applied history
-- stays honest.
--
-- WHAT CHANGED AND WHY:
--
-- Valley checks (Tue + Fri) and office stock (Wed) were seeded as `point`
-- duties, which meant they could ONLY be ticked on their own day — if Fernando
-- was out Tuesday, Tuesday's valley check was permanently missed and there was
-- no way to record having done it Wednesday. Eli's ruling: he must be able to
-- do both on any day, WITHOUT losing the fact that they're expected on
-- particular days (otherwise a fortnight could pass with nothing going red).
--
-- Two changes deliver that:
--
--   1. dtype point → cumulative. A late completion now CLEARS the miss instead
--      of it sitting red forever, and the backlog counter shows how far behind
--      the duty is. due_days is unchanged, so "expected Tue/Fri" and "expected
--      Wed" still drive the staff grid and the briefing.
--
--   2. New column `always_available`. Weekly duties are normally rendered only
--      on their due day; these two must sit on the card EVERY day so they can
--      be ticked whenever. A column rather than a rule ("show all weekly duties
--      daily") because it is deliberately narrow — the billing Monday duties
--      should keep appearing only on Mondays, and a blanket rule would have
--      quietly changed them too.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

alter table myday_duties
  add column if not exists always_available boolean not null default false;

comment on column myday_duties.always_available is
  'Render this duty on the card every day, not only on its due_days. Set for the manager''s valley checks and office stock (RULING 2026-08-10) so they can be done any day while still being EXPECTED on their due days — the grid and briefing keep using due_days. Does not affect when the duty counts as due.';

-- Valley checks + office stock: tickable any day, late completion clears the miss.
update myday_duties
   set dtype            = 'cumulative',
       always_available = true
 where duty_key in ('mgr_valley_checks', 'mgr_office_stock');

-- REPLAY SAFETY: 20260810120000's seed uses ON CONFLICT DO UPDATE and sets
-- dtype from its own VALUES list, so re-running it would have reverted these two
-- to 'point'. Its seed rows have been corrected to 'cumulative' in the same
-- change set as this file, so the two agree and either migration can be replayed
-- in any order. always_available is set only here, and nothing else writes it.

commit;
