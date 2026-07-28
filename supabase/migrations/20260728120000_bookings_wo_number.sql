-- ===========================================================================
-- WO rebuild — Step 7: WO number on the calendar card.
-- Run ONCE in the Supabase SQL editor. Idempotent, additive only.
--
-- Denormalizes the work order's wo_number onto the booking card (the card is a
-- projection of the WO — see docs/WO-SPEC.md §4), so every calendar view can
-- show "WO-1042" with a plain select, no join. Written by the WO projection on
-- save and by createWorkOrderForBooking on create; backfilled here for existing
-- cards.
-- ===========================================================================

alter table public.bookings
  add column if not exists wo_number text;

-- Backfill from the linked work order.
update public.bookings b
set wo_number = w.wo_number
from public.work_orders w
where b.work_order_id = w.id and b.wo_number is null;
