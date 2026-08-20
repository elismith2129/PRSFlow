-- ===========================================================================
-- BILLING HUB — the missing stage before approval (RULING 2026-08-11, Eli)
--
-- Follow-up to 20260811120000, which is already applied.
--
-- WHAT I GOT WRONG: the first migration sent a completed work order straight to
-- `needs_approval`. Eli described the real workflow and it has a whole stage in
-- front of that:
--
--   1. Session ends. The runner fills in the work order. It sits OPEN.
--   2. Billing reviews it the next morning and hits COMPLETE WORK ORDER. That
--      is the gate, and it applies to COD and Billing alike.
--   3. Billing goes to QuickBooks, updates the invoice (it already exists as an
--      ESTIMATE raised at the top of the session) and exports a PDF.
--   4. Billing drops that PDF onto the work order in PRSFlo, which staples the
--      two together. THAT DROP is what routes it onward:
--         · Billing client → needs_approval (Eli's queue)
--         · COD           → its computed bucket (balance owed, or paid)
--
-- So "Needs approval" means WAITING ON ELI, and it cannot be reached until
-- billing has reviewed the work and the invoice is attached. The old behaviour
-- would have put unreviewed, un-invoiced sessions straight into Eli's queue.
--
-- This migration adds the intermediate state. `needs_invoice` = completed and
-- reviewed, waiting on the QuickBooks invoice.
--
-- COD USES IT TOO. Eli: completing "starts the billing process regardless of
-- COD or billing". A COD work order sits in needs_invoice until its invoice is
-- dropped on, then returns to invoice_state NULL so its bucket goes back to
-- being COMPUTED from charges vs payments — which is still the only honest
-- source for whether COD money actually arrived.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

-- Widen the state machine. Constraints cannot be altered in place, so the old
-- one is dropped and replaced; `if exists` keeps a re-run clean.
alter table work_orders drop constraint if exists work_orders_invoice_state_ck;

alter table work_orders add constraint work_orders_invoice_state_ck check (
  invoice_state is null or invoice_state in (
    'needs_invoice',   -- completed + reviewed by billing, waiting on the QB invoice
    'needs_approval',  -- invoice attached; waiting on an owner. BILLING CLIENTS ONLY
    'approved',        -- owner signed off; ready to send
    'awaiting_po',     -- approved, but this client requires a PO we don't have
    'sent',            -- invoice is out; aging runs from invoice_sent_at
    'paid',            -- settled
    'closed'           -- written off or voided; out of every pipeline
  )
);

comment on column work_orders.invoice_state is
  'Invoice lifecycle. needs_invoice → (drop the QuickBooks PDF) → needs_approval → approved → [awaiting_po] → sent → paid, plus closed. COD work orders pass through needs_invoice too, then return to NULL so their bucket is COMPUTED from charges vs payments (lib/woTotals.ts) — the only honest source for whether COD money arrived. NULL also means "not yet in the pipeline": a work order still being filled in during the session. NOT related to work_orders.status (open|completed) or approved_at/admin_approved (daily-ops sign-off).';

commit;
