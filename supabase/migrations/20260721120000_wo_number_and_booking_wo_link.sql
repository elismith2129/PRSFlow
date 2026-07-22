-- ===========================================================================
-- WO rebuild — Step 1 of docs/WO-SPEC.md
-- Run ONCE in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Two additions, both prerequisites for the unified Work Order:
--
--   1. work_orders.wo_number — a permanent, unique, human-readable id
--      ('WO-1001', 'WO-1002', ...) assigned at creation, distinct from
--      invoice_number (which is set later at billing). Backed by a Postgres
--      sequence so new WOs auto-number. Existing WOs are backfilled in
--      created_at order.
--
--   2. bookings.work_order_id — the new link direction. Today a WO points at
--      its booking (work_orders.booking_id, UNIQUE). The rebuild makes the WO
--      the spine and lets ONE WO drive MANY calendar cards (one per room-run),
--      so cards must point AT the WO. This adds that pointer. The old
--      work_orders.booking_id is LEFT IN PLACE during the transition and
--      dropped later in a separate cleanup migration (Step 9).
-- ===========================================================================

-- ── 1. WO numbers ──────────────────────────────────────────────────────────

-- Sequence for WO numbers. Starts at 1001 → first WO is 'WO-1001'.
create sequence if not exists public.wo_number_seq start with 1001;

-- Add the column WITHOUT a default first, so we control backfill ordering
-- (a volatile default would number existing rows in arbitrary physical order).
alter table public.work_orders
  add column if not exists wo_number text;

-- Backfill any existing WOs in chronological order: oldest = WO-1001.
with ordered as (
  select id, row_number() over (order by created_at, id) - 1 as rn
  from public.work_orders
  where wo_number is null
)
update public.work_orders w
set wo_number = 'WO-' || (1001 + o.rn)::text
from ordered o
where w.id = o.id;

-- Advance the sequence past the highest number used, so the next auto-number
-- continues cleanly (no collision with backfilled values).
select setval(
  'public.wo_number_seq',
  greatest(
    1001,
    coalesce((select max(substring(wo_number from 4)::int) from public.work_orders), 1000)
  )
);

-- Now attach the auto-numbering default for all future inserts.
alter table public.work_orders
  alter column wo_number set default 'WO-' || nextval('public.wo_number_seq')::text;

-- Enforce uniqueness + presence.
create unique index if not exists work_orders_wo_number_key
  on public.work_orders (wo_number);

alter table public.work_orders
  alter column wo_number set not null;

-- ── 2. New link: bookings (calendar card) → work_orders (the session) ───────

alter table public.bookings
  add column if not exists work_order_id uuid
  references public.work_orders(id) on delete cascade;

create index if not exists bookings_work_order_id_idx
  on public.bookings (work_order_id);

-- No RLS change: existing bookings / work_orders policies cover new columns.
-- No realtime change: both tables are already in the supabase_realtime
-- publication with REPLICA IDENTITY FULL.
