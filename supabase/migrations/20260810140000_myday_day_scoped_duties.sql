-- ===========================================================================
-- MY DAY — day-dependent duties stay on their own day (RULING 2026-08-10, Eli)
--
-- REVERSES the always_available flag set an hour earlier by
-- 20260810130000_myday_anyday_duties.sql. That migration made valley checks and
-- office stock appear on the card every day so they could be ticked late; Eli
-- reviewed it and ruled the other way:
--
--   "day dependant things like stock list and valley check — I want those to
--    only show on those days. I don't want Friday's task cluttering Monday's
--    list. And I want a reminder in the Flo box the day before."
--
-- The clutter is the point. A card that always shows five items is a card people
-- keep opening (HR-SPEC §2.2 rule 2); padding Monday with Friday's work breaks
-- exactly that. The heads-up moves to the Flo briefing instead, where a
-- one-line "tomorrow" note costs nothing and can't be mistaken for today's work
-- (composeBriefing in lib/myday.ts — the LOOKAHEAD tier).
--
-- WHAT IS AND ISN'T REVERTED:
--
--   • always_available → false for both duties. They render Tue/Fri and Wed only.
--
--   • dtype STAYS 'cumulative'. This is not the same question. Cumulative is
--     what makes a missed Tuesday show up as "covering 2 days" when Friday comes
--     round, instead of being silently forgotten — it is the tracking, not the
--     scheduling. Reverting to 'point' would throw that away.
--
--   • The always_available COLUMN stays. No duty uses it now, but the mechanism
--     it encodes (a duty can be SHOWN on a day it is not DUE) is modelled in
--     lib/myday.ts as isDutyShownOn vs isDutyDueOn, and that split is worth
--     keeping — dropping and re-adding a column across three migrations in one
--     afternoon is churn, not tidiness.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

update myday_duties
   set always_available = false
 where duty_key in ('mgr_valley_checks', 'mgr_office_stock');

comment on column myday_duties.always_available is
  'Render this duty on the card every day, not only on its due_days. CURRENTLY UNUSED — set true briefly for valley checks/office stock on 2026-08-10 and reverted the same day (RULING: day-dependent duties must not clutter other days; the heads-up lives in the Flo briefing instead). Retained because lib/myday.ts models shown-vs-due on it. Does not affect when a duty counts as due.';

commit;
