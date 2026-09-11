-- ─────────────────────────────────────────────────────────────────────────────
-- Concord — whole-building blanket rate, rebuilt as ONE work order.
-- One-off repair, 2026-09-10. NOT a migration: it names specific live rows.
--
-- WHAT HAPPENED. The session was booked as separate work orders per room.
-- Staff deleted them to recreate them and got as far as four empty shells
-- (WO-1156..1159, all dated 2026-09-10, every field blank — no room, no venue,
-- no times, no rate). Deleting a WO is not a clean slate: bookings.work_order_id
-- is ON DELETE CASCADE, so the calendar cards went with them, and wo_activity
-- cascaded too — which is why the originals could not be read back.
--
-- WHAT IT SHOULD BE (Eli, 2026-09-10, confirming docs/design-refs/
-- wo-blanket-rate-options.html): two days, Sep 2-3, ALL FIVE Paramount rooms,
-- 10:00 AM - 10:00 PM, blanket $6,670/day = $13,340.
--
-- ── THE ALLOCATION ──────────────────────────────────────────────────────────
-- Pro-rata by RACK rate, per ruling 2 (an even split would make Studio X look
-- exactly as valuable as Studio C forever, in every per-room report).
--
--   rack total 1950 + 1750 + 1550 + 1250 + 750 = 7,250
--   factor     6,670 / 7,250 = 0.92 exactly  ("im just a good salesman")
--
--   Studio C  1950 x .92 = 1,794.00   x2 days = 3,588.00
--   Studio A  1750 x .92 = 1,610.00   x2 days = 3,220.00
--   Studio B  1550 x .92 = 1,426.00   x2 days = 2,852.00
--   Studio X  1250 x .92 = 1,150.00   x2 days = 2,300.00
--   Studio E   750 x .92 =   690.00   x2 days = 1,380.00
--                          --------            ---------
--                          6,670.00 ✓          13,340.00 ✓
--
-- Every share lands on a whole dollar with ZERO remainder, so the invariant
-- (shares sum to the blanket amount, to the penny) holds without anyone
-- rounding anything.
--
-- ── WHY THE SHARE GOES IN rate_daily, NOT JUST charge ───────────────────────
-- The mock's landmine: for a bundled row `charge` is the allocated number, NOT
-- rate x hours, so any path that recomputes a charge silently wipes the
-- allocation and the WO quietly re-totals to rack ($7,250/day). The bundle
-- feature that would mark these rows does not exist yet.
--
-- Writing the share into `rate_daily` AS WELL makes the recompute IDEMPOTENT:
-- a day row's charge is derived as parseFloat(rate_daily), so recomputing
-- reproduces the same number instead of destroying it. That is the whole
-- reason these are day rows and not hourly ones.
--
-- ⚠ DO NOT "FIX" THESE RATES. rate_daily is the allocated share, not the room's
--   rack rate. They are supposed to look low. The blanket deal is recorded in
--   the work order's session notes so the next person reads it before editing.
--
-- ── OVERTIME ───────────────────────────────────────────────────────────────
-- ot_rate is RACK / 10 (DAY_HOUR_RATIO), per ruling 5: "OT is rack." The
-- blanket was struck on BOOKED time and does not follow the client into the
-- overrun — Studio B's hour over is $155, never $142.60. No OT on this session
-- (ot_hours '0'), but the rate is set so a later overrun prices correctly.
--
-- DATES CORRECTED 2026-09-10 (Eli: "change the concord dates to 2-3 instead of
-- 3-4, same everything just slid over 1 day"). This file now reads as the
-- session actually is. The live rows were moved by a follow-up statement, not
-- by re-running this — re-running it would duplicate the work order's rows.
--
-- Run as ONE block. It is a transaction: all of it lands or none of it does.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Retire the three surplus empty shells ────────────────────────────────
-- Their booking cards cascade away with them. That is intended: every one is
-- blank-roomed, and a booking with no studio matches no calendar column, so
-- they are rendering nowhere already. WO-1156 is KEPT as the single work order.
delete from work_orders where wo_number in ('WO-1157', 'WO-1158', 'WO-1159');

-- ── 2. Clear WO-1156's own empty row ────────────────────────────────────────
delete from studio_time_rows
where work_order_id = (select id from work_orders where wo_number = 'WO-1156');

-- ── 3. The work order carries the deal in writing ───────────────────────────
-- Not decoration. Five rooms priced below rack with nothing on the document
-- saying why is exactly how someone "corrects" them back to rack next month.
update work_orders
set session_notes = trim(coalesce(session_notes, '') || E'\n' ||
  'WHOLE-BUILDING BLANKET RATE — $6,670/day x 2 days (Sep 2-3) = $13,340. ' ||
  'All five Paramount rooms. The per-room day rates below are ALLOCATED SHARES ' ||
  'of the blanket rate, pro-rata by rack (factor 0.92) — they are not the rooms'' ' ||
  'rack rates and must not be "corrected" to them. Client-facing invoice shows ONE ' ||
  'line: "Paramount — whole building (Studios A, B, C, E, X) · 2 days @ $6,670/day". ' ||
  'Overtime, if any, prices off RACK (room rate ÷ 10), not off the share.')
where wo_number = 'WO-1156';

-- ── 4. The primary booking card ─────────────────────────────────────────────
-- location MUST be set: the projection resolves room labels through the venue,
-- and a blank venue is how WO-1140 produced cards that saved fine and appeared
-- in no calendar column. studio is the LABEL form here ('Studio C'), per the
-- studio-name rule — rows store the LETTER, cards store the LABEL.
update bookings
set start_date = '2026-09-02',
    end_date   = '2026-09-03',
    location   = 'Paramount',
    studio     = 'Studio C',
    from_time  = '10:00 AM',
    to_time    = '10:00 PM'
where id = '82a839dd-b066-4839-9a9a-a2d1aa967328';

-- ── 5. Ten studio-time rows: five rooms x two days ──────────────────────────
-- studio stores the LETTER, location the venue name. Columns left unspecified
-- take their DB defaults on purpose (eng_visible true, eng_role 'assistant',
-- status 'in_progress') so each day's card shows its empty staff slot.
-- ⚠ THE MONEY COLUMNS ARE NUMERIC LITERALS, NOT QUOTED STRINGS. First attempt
--   quoted them and Postgres rejected it: `ot_rate is of type numeric but
--   expression is of type text`. The TS type says `ot_rate: string` — the live
--   column is numeric, and CLAUDE.md's "money fields stored as text" is only
--   true of SOME of them. Unquoted numerics are correct EITHER WAY: numeric to
--   numeric is exact, and numeric to text is a legal assignment cast. Do not
--   "tidy" these back into quotes.
insert into studio_time_rows
  (work_order_id, studio, location, date, from_time, to_time,
   total_hours, row_rate_type, rate_daily, charge, ot_rate, ot_hours, sort_order)
select w.id, v.studio, 'Paramount', v.date, '10:00 AM', '10:00 PM',
       12, 'day', v.share, v.share, v.ot, 0, v.ord
from work_orders w,
(values
  ('C', '2026-09-02', 1794, 195, 0),
  ('C', '2026-09-03', 1794, 195, 1),
  ('A', '2026-09-02', 1610, 175, 2),
  ('A', '2026-09-03', 1610, 175, 3),
  ('B', '2026-09-02', 1426, 155, 4),
  ('B', '2026-09-03', 1426, 155, 5),
  ('X', '2026-09-02', 1150, 125, 6),
  ('X', '2026-09-03', 1150, 125, 7),
  ('E', '2026-09-02',  690,  75, 8),
  ('E', '2026-09-03',  690,  75, 9)
) as v(studio, date, share, ot, ord)
where w.wo_number = 'WO-1156';

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect 10 rows and studio_total = 13340.00. If it reads 14500, the shares
-- were overwritten with rack rates somewhere and the allocation is gone.
select count(*) as rows_written,
       sum(charge) as studio_total,
       count(distinct studio) as rooms,
       min(date) as first_day, max(date) as last_day
from studio_time_rows
where work_order_id = (select id from work_orders where wo_number = 'WO-1156');
