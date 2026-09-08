// ─────────────────────────────────────────────────────────────────────────────
// lib/payments — THE list of ways money reaches Paramount.
//
// There were two lists (2026-09-08): the WO's payment-row types (Cash, Zelle,
// Credit Card, Debit Card, Check, Other) and the client's COD methods (Cash,
// Credit Card, Zelle, Check, Venmo). They disagreed in both directions — a
// client could be flagged to pay by Venmo, which no payment row could then
// record; and no client could be flagged for a Debit Card. Ruling: every method
// is available everywhere, so this is one list with one home.
//
// Neither `payment_rows.type` nor `bookings.cod_method` has a CHECK constraint,
// so adding a method here is the whole change — no migration.
// ─────────────────────────────────────────────────────────────────────────────

export const PAYMENT_METHODS = [
  'Cash',
  'Zelle',
  'Venmo',
  'Wire',
  'ACH',
  'Credit Card',
  'Debit Card',
  'Check',
  'Other',
]

/**
 * The methods that carry the 3% card surcharge (see CARD_FEE_RATE in
 * lib/woTotals.ts).
 *
 * ⚠ Bank transfers and cash apps are deliberately absent. The surcharge exists
 * to recover card-processing cost; a wire, an ACH or a Zelle costs nothing per
 * dollar. Adding a method here silently starts billing clients 3% on it, so
 * only ever add something that is genuinely run through a card processor.
 */
export const CARD_PAYMENT_METHODS = ['Credit Card', 'Debit Card']
