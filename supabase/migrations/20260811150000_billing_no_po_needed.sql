-- ===========================================================================
-- BILLING — "No PO needed" lives on the WORK ORDER (RULING 2026-08-11, Eli)
--
-- Replaces the per-client `clients.requires_po` approach from 20260811120000,
-- which solved the same problem worse.
--
-- Eli: "if it's a billing WO, the billing coordinator will be putting the PO on
-- the WO in the PO section. If that is filled in, then it doesn't get awaiting
-- PO. For billing invoices that don't require POs — a few clients are like this
-- — let's add a No PO needed button on the WO."
--
-- So the rule becomes, entirely from the work order:
--
--   AWAITING PO  =  billing client
--                   AND approved
--                   AND po_number is empty
--                   AND no_po_needed is false
--
-- Better than the per-client flag for two reasons. It needs no client-level
-- setting to be maintained and kept true, and it is correct for the case the
-- client flag gets wrong — a client who normally requires a PO but waived it on
-- one job. The exception belongs on the job.
--
-- `clients.requires_po` is left in place but is NO LONGER READ. Dropping a
-- column added hours earlier is churn, and the concept may return as a default
-- that pre-ticks this box. Its comment records that it is dormant.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

alter table work_orders
  add column if not exists no_po_needed boolean not null default false;

comment on column work_orders.no_po_needed is
  'This billing package can be sent without a PO number. Set on the WORK ORDER, not the client, so a client who normally requires a PO can waive it on one job. Awaiting PO = billing + approved + po_number empty + this false.';

comment on column clients.requires_po is
  'DORMANT as of 2026-08-11 — nothing reads this. The PO requirement moved to the work order (work_orders.no_po_needed), because the exception is per-job, not per-client. Kept in case it returns as a default that pre-ticks that box.';

commit;
