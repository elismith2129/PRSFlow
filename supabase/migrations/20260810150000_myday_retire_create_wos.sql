-- ===========================================================================
-- MY DAY — retire "Create WOs for today's confirmed sessions" (RULING 2026-08-10)
--
-- The billing duty list was transcribed from the PRS Billing Coordinator
-- Procedures doc, which describes the CURRENT paper-and-QuickBooks systems.
-- Eli, reviewing it: "things like create work orders or make sure there are
-- work orders is no longer real, as those are automatically created."
--
-- He's right, and the app already proves it: since 2026-06-30 a work order is
-- created at booking-save by lib/createWorkOrder.ts, gated on
-- bookingShouldHaveWorkOrder() and made idempotent by UNIQUE (booking_id).
-- Nobody creates one by hand. A daily duty to do it is a duty to do nothing,
-- and a checkbox that is always already true teaches people to tick without
-- looking — the exact habit HR-SPEC §2.2 is built to avoid.
--
-- RETIRED, NOT DELETED: is_active = false. Any myday_entries recorded against
-- it stay attached and keep their history (HR-SPEC §2.2 rule 4 — a completion
-- record is permanent). fetchDuties() filters on is_active, so it simply stops
-- appearing. Deleting the row would cascade those entries away.
--
-- The needs-a-work-order QUEUE is NOT retired. It stays as an exception report:
-- Tech / Tour / Open Hours sessions are excluded from WO creation by design, and
-- a creation can still fail. The difference is that it is now something to
-- notice when it is non-empty, not a list anyone works through daily.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

update myday_duties
   set is_active = false
 where duty_key = 'bil_create_wos';

-- The base seed (20260810120000) no longer inserts this duty, so a fresh
-- database never creates it and this statement no-ops there. On the live
-- database the row exists and is retired here. Either path ends up correct.
-- Note the base seed's ON CONFLICT DO UPDATE deliberately does not touch
-- is_active, so replaying it cannot resurrect a retired duty.

commit;
