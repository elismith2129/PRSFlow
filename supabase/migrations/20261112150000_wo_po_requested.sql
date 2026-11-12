-- PO REQUESTED (Lori via Eli, 2026-11-12): on the Awaiting PO tab, a way to
-- tell the invoices she has already sent out to request a PO from the ones
-- just approved and not yet chased. A manual mark, no rule: who and when.
-- Cleared by the app when a PO number lands (recordPoNumber) — the chase is
-- over. Idempotent.
alter table public.work_orders add column if not exists po_requested_at timestamptz;
alter table public.work_orders add column if not exists po_requested_by text;

select count(*) as ok from information_schema.columns
 where table_name = 'work_orders' and column_name in ('po_requested_at', 'po_requested_by');
