-- ---------------------------------------------------------------------------
-- 3% card surcharge on COD work orders (Eli, 2026-08-26).
--
-- One nullable column on payment_rows. For a Credit Card / Debit Card payment
-- on a COD work order, `amount` is what actually hit the card and `fee_amount`
-- is the 3% surcharge slice inside it (amount − amount/1.03, cents-rounded —
-- see lib/woTotals cardFeeOfCharged). The fee is a CHARGE: computeWoTotals
-- adds Σ fee_amount to the grand total, so a card payment moves the balance by
-- exactly its base. NULL/0 = no fee (non-card type, billing WO, or waived by
-- staff — the fee is removable per payment).
--
-- The WO screen shows "If paying by card (incl. 3%)" under Balance Due —
-- balance × 1.03 — which is the number a runner reads to the terminal. No desk
-- math; PRSFlo is the source of truth. This also covers à-la-carte OT, which
-- the old manual +3% habit missed, because the balance already contains OT.
-- ---------------------------------------------------------------------------

alter table public.payment_rows
  add column if not exists fee_amount numeric;

comment on column public.payment_rows.fee_amount is
  'The 3% card surcharge slice of amount (COD + Credit/Debit only). amount = what hit the card, fee_amount = the fee inside it. NULL/0 = no fee (non-card, billing WO, or waived).';
