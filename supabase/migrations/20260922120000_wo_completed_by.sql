-- Who pressed Complete WO. The green end of the submit trail in the billing
-- hub: "Runner never submitted · <runner>" → "Completed by <admin>".
-- Idempotent.
alter table public.work_orders
  add column if not exists completed_by_name text;

comment on column public.work_orders.completed_by_name is
  'Display name of the admin who completed this work order. Cleared on reopen.';
