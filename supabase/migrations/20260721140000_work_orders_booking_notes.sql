-- ===========================================================================
-- WO rebuild — Booking Notes on the Work Order.
-- Run ONCE in the Supabase SQL editor. Idempotent, additive only.
--
-- Internal, operations-only notes ABOUT THE BOOKING (arrival, payment,
-- previous experience, special handling, etc.). Never sent to the client.
--
-- Distinct from the other note surfaces:
--   • session_notes         — client-facing; prints on the invoice/PDF.
--   • flags                 — operations flag system (separate feature).
--   • needs_attention_notes — runner "needs attention" workflow (with photos).
--   • booking_notes (this)  — office notes about the booking; never printed.
-- ===========================================================================

alter table public.work_orders
  add column if not exists booking_notes text;
