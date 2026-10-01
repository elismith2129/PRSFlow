-- SRS BACKFILL (Eli, 2026-10-01: "i dont see any of the past ones").
-- Older SRS sessions carry the flag on the BOOKING (bookings.is_srs) and/or a
-- row in the old srs_log, but work_orders.is_srs stayed false. The WO screen
-- already ORs the booking flag in, so it showed SRS; the new /srs list reads
-- only work_orders.is_srs, so they were invisible. Make the WO flag the truth.
-- Idempotent.

begin;

update public.work_orders w
set is_srs = true
from public.bookings b
where (b.work_order_id = w.id or w.booking_id = b.id)
  and b.is_srs
  and not w.is_srs;

update public.work_orders w
set is_srs = true
from public.srs_log l
join public.bookings b on b.id = l.booking_id
where (b.work_order_id = w.id or w.booking_id = b.id)
  and not w.is_srs;

commit;

select count(*) as srs_work_orders_now from public.work_orders where is_srs;
