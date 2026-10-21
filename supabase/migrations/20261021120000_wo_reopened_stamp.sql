-- REOPENED STAMP (Eli, 2026-10-21, v1.45.1): "a visible tag on the WO in the
-- billing hub when it's reopened from under needs approval… it stays under
-- needs approval with no outer change."
--
-- Reopen (WorkOrderPopup.handleComplete) sets the work order back to OPEN but
-- only pulls it out of billing from Needs invoice. With an invoice already on
-- file the row stays at Needs approval and looks like every other row.
--
-- Written, not derived: "open + invoice on file" cannot tell a reopen from an
-- invoice attached before Complete (a legal path). handleComplete is the one
-- reopen path, so it is the one writer; the next Complete clears both.
-- Idempotent.

alter table public.work_orders
  add column if not exists reopened_at      timestamptz,
  add column if not exists reopened_by_name text;

select count(*) filter (where reopened_at is not null) as reopened_now from public.work_orders;
