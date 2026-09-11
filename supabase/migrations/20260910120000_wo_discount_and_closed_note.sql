-- ─────────────────────────────────────────────────────────────────────────────
-- Cancellation kill fees + a reason on Closed (Eli, 2026-09-10).
--
-- "When I mark a session as cancelled, I still need that to populate in the
-- billing hub as a normal WO that needs review, invoice, PO and such. We still
-- charge for these. But often times we do a 50% kill fee."
-- Plus: "need a drop down + free text for closed invoices so we can put a
-- message in there."
--
-- Design + rejected alternatives: docs/design-refs/wo-cancellation-discount-
-- options.html (Option A ruled).
--
-- ── 1. THE DISCOUNT ─────────────────────────────────────────────────────────
--
-- ⚠ WHY THIS IS NOT A PAYMENT ROW. Eli's first instinct was to put the
--   discount in payments. It cannot go there: payment_rows are money RECEIVED
--   (computeWoTotals does paid = Σ amount, balance = grand − paid), so a
--   discount entered as a payment makes the work order read as PAID when no
--   money arrived — a $3,000 kill fee showing a zero balance in AR while the
--   client still owes every penny. That is the exact failure the 2026-08-11
--   cancelled-invoice ruling exists to prevent. A discount reduces what is
--   OWED, so it belongs on the charge side.
--
-- ⚠ AND WHY IT IS NOT BAKED INTO studio_time_rows.charge. Same landmine as the
--   blanket rate (docs/design-refs/wo-blanket-rate-options.html): a derived
--   value stomped by a recompute. Rows keep their full BOOKED value and the
--   discount is applied once, at total time — which also means the work order
--   can always answer "what was this session worth before we discounted it",
--   the first question anyone asks about a kill fee.
--
-- Applies to the WHOLE work order — studio, engineering and rentals alike
-- (Eli's ruling; not studio-only). Card fees are untouched: they attach to each
-- PAYMENT, not to the invoice, because clients pay in increments and OT lands
-- after the fact.
--
--   grand   = studio + engineer + rentals − discount + Σ payment fees
--   balance = grand − paid
--
-- NO DEFAULT VALUE, deliberately. A 50% pre-fill on cancelled sessions was
-- considered and REJECTED by Eli: "no we will do it because we have 100%
-- billed sometimes." A default that silently halves a session somebody meant
-- to bill in full is worse than typing two characters.
--
-- ── 2. THE CLOSED REASON ────────────────────────────────────────────────────
--
-- invoice_closed_reason already exists (migration 20260811120000) but held only
-- 'written_off' | 'voided', and nothing could say WHY. The CHECK is widened and
-- a free-text note added, mirroring invoice_reject_note (20260901170000) — the
-- app's existing shape for "a decision plus the sentence explaining it".
--
-- The two legacy values stay legal. Existing closed rows are not rewritten:
-- 'voided' is a true statement about them, and guessing which flavour of void
-- an old row meant would be inventing history.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Discount ────────────────────────────────────────────────────────────────
alter table public.work_orders
  add column if not exists discount_kind  text,
  add column if not exists discount_value numeric,
  add column if not exists discount_label text;

do $fn$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_orders_discount_kind_ck') then
    alter table public.work_orders add constraint work_orders_discount_kind_ck check (
      discount_kind is null or discount_kind in ('pct', 'amt')
    );
  end if;

  -- A percentage over 100 is a typo every time, and a negative discount is a
  -- surcharge wearing a disguise — if we ever want one it gets its own field
  -- and its own argument, not a minus sign nobody notices on an invoice.
  if not exists (select 1 from pg_constraint where conname = 'work_orders_discount_value_ck') then
    alter table public.work_orders add constraint work_orders_discount_value_ck check (
      discount_value is null
      or (discount_value >= 0 and (discount_kind <> 'pct' or discount_value <= 100))
    );
  end if;
end
$fn$;

comment on column public.work_orders.discount_kind is
  'pct | amt | null. How discount_value is read. Applies to the WHOLE work order (studio + engineer + rentals), never to card fees — those attach to each payment.';
comment on column public.work_orders.discount_value is
  'The number. Percent (0-100) when discount_kind=pct, dollars when amt. NEVER baked into studio_time_rows.charge — rows keep their full booked value and this is applied at total time.';
comment on column public.work_orders.discount_label is
  'What the invoice calls it, e.g. "Cancellation - 50% kill fee". Shown to the client.';

-- ── Closed reason + note ────────────────────────────────────────────────────
alter table public.work_orders
  add column if not exists invoice_closed_note text;

do $fn$
begin
  alter table public.work_orders drop constraint if exists work_orders_invoice_closed_reason_ck;
  alter table public.work_orders add constraint work_orders_invoice_closed_reason_ck check (
    invoice_closed_reason is null
    or invoice_closed_reason in (
      -- Legacy, still written by nothing but true of existing rows.
      'written_off', 'voided',
      -- The list Eli approved 2026-09-10.
      'written_off_bad_debt', 'written_off_goodwill',
      'voided_cancelled', 'voided_duplicate', 'voided_error',
      'settled_adjusted', 'other'
    )
  );
end
$fn$;

comment on column public.work_orders.invoice_closed_note is
  'Free text on a closed invoice — why, in a sentence, for someone who was not there. Required when invoice_closed_reason = other. Mirrors invoice_reject_note.';
