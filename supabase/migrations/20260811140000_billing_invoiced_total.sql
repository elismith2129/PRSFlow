-- ===========================================================================
-- BILLING HUB — snapshot the total when the invoice is attached
-- (RULING 2026-08-11, Eli)
--
-- THE PROBLEM THIS CLOSES: PRSFlo always shows the LIVE work-order total, and
-- QuickBooks holds whatever was true when billing exported the PDF. If anyone
-- touches hours, rentals or damages after that — and billing explicitly CAN,
-- they have full control of every work order — the two silently diverge. You
-- would have an invoice out for $4,900 against a work order that now reads
-- $5,400, and nothing anywhere would say so. The client would find it first.
--
-- So the total is recorded at the moment the invoice PDF is attached. Any later
-- change is then detectable by comparing the live total to this number, and the
-- billing hub can flag the row instead of quietly disagreeing with itself.
--
-- Deliberately ONE number, not a full snapshot of the line items. The question
-- being answered is "has this changed since we invoiced it" — a boolean dressed
-- as a comparison. Reconstructing what the invoice said in detail is what the
-- attached PDF is for; it is the actual document that went to the client.
--
-- NULL means no invoice has been attached yet, which is also the correct
-- reading for every work order that predates this migration: nothing was
-- promised, so nothing can have drifted.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

alter table work_orders
  add column if not exists invoice_total numeric;

comment on column work_orders.invoice_total is
  'The work-order grand total AT THE MOMENT the QuickBooks invoice PDF was attached — i.e. what the client was actually billed. Compared against the live total (lib/woTotals.ts) to detect edits made after invoicing; the billing hub flags any row where the two differ. NULL = no invoice attached yet, so nothing can have drifted. Not a full line-item snapshot on purpose: the attached PDF is the record of what was sent.';

commit;
