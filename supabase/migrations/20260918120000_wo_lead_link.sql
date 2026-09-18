-- CLIENT CAPTURE FROM THE CALENDAR (Eli, 2026-09-18): "tie any booking made
-- straight to the cal and confirmed to a booked line in the CRM so it plays
-- into the metrics." A confirmed work order saved with no lead behind it now
-- writes ONE lead (status booked, source 'Calendar') and remembers it here so
-- a re-save never writes a second. Work orders started from a CRM lead record
-- that lead here too, so the link is one column either way.
alter table public.work_orders
  add column if not exists lead_id integer references public.leads(id) on delete set null;
create index if not exists work_orders_lead_id_idx on public.work_orders (lead_id) where lead_id is not null;

-- Who booked it, by name — the CRM row says "from calendar · Eli".
alter table public.leads
  add column if not exists created_by_name text,
  add column if not exists work_order_id uuid references public.work_orders(id) on delete set null;

select count(*) as wos_without_lead from public.work_orders where lead_id is null;
