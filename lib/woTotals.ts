// ─────────────────────────────────────────────────────────────────────────────
// lib/woTotals — THE canonical work-order money math.
//
// Extracted from WorkOrderPopup.tsx (its "Derived totals" block) on 2026-08-10
// because My Day's balances queue needs the same numbers: docs/MYDAY-BUILD.md §3
// defines a balance as "studio + rentals + eng total > payments sum", and
// CLAUDE.md's standing rule is that money math never gets a second copy. Rather
// than re-derive it in lib/myday.ts, both callers now import from here.
//
// This is a behaviour-preserving extraction. The arithmetic, the fallback chain,
// and the rounding are byte-for-byte what the popup already did — including the
// two quirks below, which are deliberately preserved rather than "fixed":
//
//   1. Engineer hours prefer the CLOCK (eng_from_time/eng_to_time, falling back
//      to the row's session times) over the stored eng_hours. calcHours() only
//      returns null when the times are missing or unparseable, so eng_hours acts
//      as the fallback, not the primary. That is the existing behaviour and the
//      WO screen's totals depend on it.
//   2. A row with no resolvable engineer RATE contributes zero engineer cost even
//      if it has hours — an unpriced engineer is not a charge.
//
// Callers supply structurally-typed rows, because the two call sites hold
// different shapes for the same data: WorkOrderPopup holds form state (money as
// display strings like "$1,450"), while a straight DB read gets numerics. Every
// money field therefore accepts string | number | null and is coerced here.
// ─────────────────────────────────────────────────────────────────────────────

import { calcHours } from '@/lib/time'
import { stripCurrency } from '@/lib/format'

/** A studio-time row, reduced to only the fields that affect money. */
export type TotalsStudioRow = {
  charge?: number | string | null
  ot_charge?: number | string | null
  from_time?: string | null
  to_time?: string | null
  eng_from_time?: string | null
  eng_to_time?: string | null
  eng_hours?: number | string | null
  eng_rate?: string | null
}

/** A rental row, reduced to the charge. */
export type TotalsRentalRow = { charge?: number | string | null }

/** A payment row, reduced to the amount + card surcharge.
 *  fee_amount (2026-08-26): the 3% card surcharge portion of a Credit/Debit
 *  payment on a COD work order. The AMOUNT is what actually hit the card
 *  (base + fee); fee_amount is the fee slice of it. The fee is also a CHARGE
 *  (it joins grand), so recording a card payment moves the balance by exactly
 *  the base: +fee to grand, +amount (which contains the fee) to paid. */
export type TotalsPaymentRow = {
  amount?: number | string | null
  fee_amount?: number | string | null
}

export type WoTotalsInput = {
  studioRows: TotalsStudioRow[]
  rentalRows: TotalsRentalRow[]
  paymentRows: TotalsPaymentRow[]
  // NO FALLBACK RATE. Removed 2026-08-13 along with its last caller. It existed
  // to inherit `bookings.engineer_rate`, which is vestigial — the booking form
  // is deleted and `buildBookingProjection` never writes that column. The WO
  // screen and the runner WO page were still reading it while billing, the
  // invoice and the PDF were not, so the screens showed an engineer charge that
  // nothing downstream would ever bill (three work orders were in that state,
  // all carrying the retired $55 default).
  //
  // Staffing lives ONLY in the Studio Time table (CLAUDE.md). The row's
  // `eng_rate` is the single source; a row with no rate is not a charge. Do not
  // reintroduce an inheritance here.
}

export type WoTotals = {
  studio: number
  engineer: number
  rentals: number
  /** Σ payment fee_amount — the 3% card surcharges, which are charges. */
  cardFees: number
  /** studio + engineer + rentals + cardFees */
  grand: number
  paid: number
  /** grand − paid. Positive means the client still owes. */
  balance: number
}

/** The card surcharge rate (3%). Single source — UI helpers and fee
 *  derivation must import this, never restate 0.03/1.03 locally. */
export const CARD_FEE_RATE = 0.03

/** House rate law (Eli, 2026-08-26): the day rate is ALWAYS 10× the hourly
 *  rate ($750/day ⇄ $75/hr), and the day-row OT rate is the hourly equivalent
 *  (day ÷ 10). Single source — every conversion imports this; never restate
 *  10 or 0.10 locally. Special deals are typed AFTER converting, not encoded
 *  as exceptions here. */
export const DAY_HOUR_RATIO = 10

/** The fee slice of a card-charged total: charged − charged/1.03, in cents.
 *  Derives the fee FROM the charged amount so a runner can type exactly what
 *  the terminal charged and the base+fee split is always internally exact. */
export function cardFeeOfCharged(charged: number): number {
  if (!(charged > 0)) return 0
  return parseFloat((charged - charged / (1 + CARD_FEE_RATE)).toFixed(2))
}

/** What to charge on a card so the client's BASE obligation is `base`:
 *  base × 1.03, in cents. This is the number staff reads to the terminal. */
export function cardTotalForBase(base: number): number {
  if (!(base > 0)) return 0
  return parseFloat((base * (1 + CARD_FEE_RATE)).toFixed(2))
}

/** Money coercion: accepts 1450, "1450", "$1,450.00", null. Non-numeric → 0. */
function money(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return isFinite(v) ? v : 0
  return stripCurrency(v) ?? 0
}

/** A rate string → number. "$120/hr" → 120. Unparseable or zero → 0. */
function rate(v: string | null | undefined): number {
  if (!v) return 0
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

/**
 * Engineer cost for a single studio-time row.
 *
 * Exported because the WO screen shows a per-row engineer charge alongside the
 * total, and that per-row number must come from the same function as the sum —
 * a separate inline copy is exactly how the two used to disagree.
 */
export function engChargeForRow(row: TotalsStudioRow): number {
  const r = rate(row.eng_rate || '')
  if (!r) return 0
  const clocked = calcHours(
    row.eng_from_time || row.from_time || '',
    row.eng_to_time || row.to_time || '',
  )
  const hours = clocked ?? money(row.eng_hours)
  if (!(hours > 0)) return 0
  return parseFloat((hours * r).toFixed(2))
}

/** The six numbers on a work order. Pure — no I/O, safe to call in a loop. */
export function computeWoTotals(input: WoTotalsInput): WoTotals {
  const { studioRows, rentalRows, paymentRows } = input

  const studio = studioRows.reduce(
    (s, r) => s + money(r.charge) + money(r.ot_charge),
    0,
  )
  const engineer = studioRows.reduce(
    (s, r) => s + engChargeForRow(r),
    0,
  )
  const rentals = rentalRows.reduce((s, r) => s + money(r.charge), 0)
  const paid = paymentRows.reduce((s, p) => s + money(p.amount), 0)
  const cardFees = paymentRows.reduce((s, p) => s + money(p.fee_amount), 0)

  const grand = studio + engineer + rentals + cardFees

  return { studio, engineer, rentals, cardFees, grand, paid, balance: grand - paid }
}
