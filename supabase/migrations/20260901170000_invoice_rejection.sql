-- ─────────────────────────────────────────────────────────────────────────────
-- Owner rejection of an invoice package (Eli, 2026-09-01: "did not approve,
-- with a comment box. this gets flagged for another review for the admin").
--
-- The pipeline: owner reviews the B&W package in the hub's package window →
-- Approve, or Don't approve + a required note. A rejection stamps these three
-- columns; the row leaves the owner's approvals queue and grows a hot
-- RETURNED chip carrying the note; billing/admin fixes the work order (the
-- digital side, right in the same window) and presses "Send for approval",
-- which clears the stamps and puts it back in the owner's queue. Approving
-- clears them too (approving IS accepting the fix).
--
-- Stored, not derived — a rejection is a human act (the STORED vs DERIVED
-- doctrine in lib/billing.ts).
--
-- Also widens wo_activity's kind ladder with 'rejected' / 'resubmitted' so the
-- WO history shows the loop. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.work_orders add column if not exists invoice_rejected_at timestamptz;
alter table public.work_orders add column if not exists invoice_rejected_by uuid;
alter table public.work_orders add column if not exists invoice_reject_note text;

alter table public.wo_activity drop constraint if exists wo_activity_kind_check;
alter table public.wo_activity add constraint wo_activity_kind_check
  check (kind in ('created', 'saved', 'submitted', 'reviewed', 'approved', 'rejected', 'resubmitted'));
