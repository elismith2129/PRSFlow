-- STATUS PER DAY (Eli, 2026-09-18): "make one booking and have some days
-- confirmed and some tentative — move the confirmed / tentative / cancelled
-- bar to each day instead of the WO as a whole."
--
-- NULL = "same as the session" (work_orders.session_status). Every existing
-- row is null, so nothing changes on day one. The WO's status bar becomes
-- "all days": setting it writes session_status AND clears every day_status.
-- The projection splits a run on effective status, so bookings.status per
-- card stays the truth every daily surface reads. A cancelled day keeps its
-- row (history) and is zeroed at total time in computeWoTotals — never
-- rewritten on the row. Tour / Tech / Open Hrs / Lockout stay WO-level.
alter table public.studio_time_rows
  add column if not exists day_status text
    check (day_status is null or day_status in ('confirmed', 'tentative', 'cancelled'));

select count(*) as rows_with_own_status from public.studio_time_rows where day_status is not null;
