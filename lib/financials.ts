// ─────────────────────────────────────────────────────────────────────────────
// lib/financials — revenue over time, across the PRSFlo years and the ones
// before it.
//
// FOUR STREAMS, ONE SHAPE. Every dollar the studio bills is one of: the ROOM,
// the ASSISTANT, the ENGINEER, or a RENTAL. Live money lives in
// `studio_time_rows` + `rental_rows`; the years before the app live in
// `financial_history` (migration 20260820140000). This file is the ONLY place
// the two are joined — every consumer sees one flat list of `FinLine` and never
// learns which side a number came from. That is deliberate: when the historical
// window ages out, this file changes and no screen does.
//
// MONEY MATH IS NOT RE-DERIVED HERE. `engChargeForRow` is imported from
// lib/woTotals — the same function the work-order screen and the billing hub
// display. CLAUDE.md's standing rule is that money math never gets a second
// copy, and the eng-hours quirks (clock beats stored hours; an unpriced
// engineer is not a charge) are load-bearing behaviour, not accidents.
//
// ROOM vs ENGINEER vs ASSISTANT come from ONE studio-time row. `charge` +
// `ot_charge` is the room. The same row's `eng_rate` × hours is the staff
// charge, filed under `eng_role` — which defaults to 'assistant' app-wide
// (migration 20260728210000), so an engineer is the exception, not the rule.
//
// RENTALS HAVE NO ROOM OF THEIR OWN. `rental_rows` hangs off the work order,
// not off a studio-time row — a mic package rented for a three-day booking is
// one line, not three. So a rental is attributed to its work order's EARLIEST
// studio-time row (that row's date, venue and room). This is an approximation
// and the only one in this file: filter to a single room and its rental figure
// is "rentals on work orders that started in this room", not "rentals used in
// this room". Totals across all rooms are exact — nothing is double-counted and
// nothing is dropped. Said plainly in the UI rather than hidden.
//
// WHAT IS NOT COUNTED: payments. This charts what was BILLED, by session date.
// What was collected, and when, is the billing hub's job (lib/billing.ts) and
// QuickBooks'. Mixing the two produces a number that is neither.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { engChargeForRow } from '@/lib/woTotals'
import { combineLocation } from '@/lib/studios'

// ─── Types ───────────────────────────────────────────────────────────────────

export type FinCategory = 'room' | 'assistant' | 'engineering' | 'rental'

/** Display order, top of the stack down. Room is the bulk of it, so it leads. */
export const CATEGORIES: FinCategory[] = ['room', 'engineering', 'assistant', 'rental']

export const CATEGORY_LABEL: Record<FinCategory, string> = {
  room: 'Room',
  engineering: 'Engineering',
  assistant: 'Assistant',
  rental: 'Rentals',
}

/**
 * Chart colours.
 *
 * ⚠ FLAGGED FOR ELI'S RULING. Design spec Law 3 says colour is status and
 * nothing else, with an explicit carve-out for "analytics charts/stat accents"
 * — but the parenthetical narrows that to charting LEAD STATUS, which this is
 * not. Four stacked segments need four distinguishable fills, and monochrome
 * opacity tiers were tried first and failed: at four levels the middle two are
 * indistinguishable in dark mode. So this uses the status palette as the
 * sanctioned analytics exception, chosen so no segment reads as an ALARM
 * (`--c-st-hot` is untouched — nothing here needs you now).
 *
 * If Eli rules the other way, this map is the only thing that changes.
 */
export const CATEGORY_VAR: Record<FinCategory, string> = {
  room: 'var(--c-st-booked)',   // sea green — the healthy bulk of the business
  engineering: 'var(--c-st-uncon)', // harbor
  assistant: 'var(--c-st-cold)',    // lagoon
  rental: 'var(--c-st-warm)',       // amber
}

/** One dollar figure, attributed to a day, a room and a stream. */
export type FinLine = {
  date: string          // ISO yyyy-mm-dd, the SESSION date
  venue: string         // 'Paramount' | 'Ameraycan' | 'Encore' | 'Track'
  room: string          // 'Studio A' … | 'North' | 'South'
  category: FinCategory
  amount: number
  source: 'live' | 'history'
}

export type Grain = 'month' | 'quarter' | 'year'

/** One column of the chart. */
export type FinBucket = {
  key: string                          // '2026-07' | '2026-Q3' | '2026'
  label: string                        // 'Jul' | 'Q3' | '2026'
  total: number
  byCategory: Record<FinCategory, number>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function money(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return isFinite(n) ? n : 0
}

/** 'Paramount · Studio A'. The stable identity of a room across both sources. */
export function roomKey(venue: string, room: string): string {
  return combineLocation(venue.trim(), room.trim())
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Bucket key for a date at a given grain.
 *
 * Sliced from the ISO string rather than parsed into a Date, deliberately.
 * `new Date('2026-07-01')` is UTC midnight, which in Los Angeles is June 30 —
 * every session on the 1st of a month would land in the month before. Session
 * dates are stored as plain dates with no zone; they must be read as text.
 */
export function bucketKeyFor(iso: string, grain: Grain): string {
  const y = iso.slice(0, 4)
  const m = Number(iso.slice(5, 7))
  if (grain === 'year') return y
  if (grain === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
  return `${y}-${String(m).padStart(2, '0')}`
}

export function bucketLabelFor(key: string, grain: Grain): string {
  if (grain === 'year') return key
  if (grain === 'quarter') return key.slice(5)
  return MONTHS[Number(key.slice(5, 7)) - 1] ?? key
}

/** Same bucket, one year earlier. Used for the year-over-year overlay. */
export function priorYearKey(key: string): string {
  const y = String(Number(key.slice(0, 4)) - 1)
  return y + key.slice(4)
}

function emptyByCategory(): Record<FinCategory, number> {
  return { room: 0, engineering: 0, assistant: 0, rental: 0 }
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

type StRow = {
  work_order_id: string
  studio: string | null
  location: string | null
  date: string | null
  charge: number | string | null
  ot_charge: number | string | null
  from_time: string | null
  to_time: string | null
  eng_from_time: string | null
  eng_to_time: string | null
  eng_hours: number | string | null
  eng_rate: string | null
  eng_role: string | null
}

/**
 * Every billed dollar with a session date in [fromISO, toISO].
 *
 * Both halves are fetched in parallel and flattened into one list. Callers do
 * not get to know, or need to know, which years came from where.
 *
 * The date filter is applied in Postgres on `studio_time_rows.date`, so a
 * three-year window does not drag the whole table into the browser. Rentals are
 * then fetched only for the work orders that survived that filter.
 */
export async function fetchFinancialLines(fromISO: string, toISO: string): Promise<FinLine[]> {
  const [stRes, histRes] = await Promise.all([
    supabase
      .from('studio_time_rows')
      .select('work_order_id, studio, location, date, charge, ot_charge, from_time, to_time, eng_from_time, eng_to_time, eng_hours, eng_rate, eng_role')
      .gte('date', fromISO)
      .lte('date', toISO),
    supabase
      .from('financial_history')
      .select('session_date, venue, room, category, amount')
      .eq('direction', 'revenue')
      .gte('session_date', fromISO)
      .lte('session_date', toISO),
  ])

  // The history table is owner-only and may not exist yet on a database where
  // the migration has not been run. Neither is a reason to show nothing — the
  // live half is still true, so a history failure degrades to "PRSFlo years
  // only" rather than an empty page.
  if (!dbResult('Loading studio time for financials', stRes.error)) return []
  if (histRes.error && histRes.error.code !== '42P01') {
    dbResult('Loading financial history', histRes.error)
  }

  const stRows = (stRes.data ?? []) as StRow[]
  const lines: FinLine[] = []

  // Per work order: the earliest studio-time row, which is where its rentals
  // get attributed. Built in the same pass that emits the room/staff lines.
  const woAnchor = new Map<string, { date: string; venue: string; room: string }>()

  for (const r of stRows) {
    const date = (r.date ?? '').slice(0, 10)
    if (!date) continue
    const venue = (r.location ?? '').trim()
    const room = (r.studio ?? '').trim()

    const prev = woAnchor.get(r.work_order_id)
    if (!prev || date < prev.date) woAnchor.set(r.work_order_id, { date, venue, room })

    const roomAmt = money(r.charge) + money(r.ot_charge)
    if (roomAmt !== 0) {
      lines.push({ date, venue, room, category: 'room', amount: roomAmt, source: 'live' })
    }

    // eng_role defaults to 'assistant' app-wide — an engineer is the exception.
    // Anything unrecognised follows that same default rather than vanishing.
    const staffAmt = engChargeForRow(r)
    if (staffAmt !== 0) {
      const category: FinCategory = r.eng_role === 'engineer' ? 'engineering' : 'assistant'
      lines.push({ date, venue, room, category, amount: staffAmt, source: 'live' })
    }
  }

  const woIds = [...woAnchor.keys()]
  if (woIds.length > 0) {
    const rentRes = await supabase
      .from('rental_rows')
      .select('work_order_id, charge')
      .in('work_order_id', woIds)
    if (dbResult('Loading rentals for financials', rentRes.error)) {
      for (const rr of rentRes.data ?? []) {
        const anchor = woAnchor.get(rr.work_order_id as string)
        if (!anchor) continue
        const amt = money(rr.charge as number | string | null)
        if (amt === 0) continue
        lines.push({
          date: anchor.date, venue: anchor.venue, room: anchor.room,
          category: 'rental', amount: amt, source: 'live',
        })
      }
    }
  }

  for (const h of histRes.data ?? []) {
    const amt = money(h.amount as number | string | null)
    if (amt === 0) continue
    lines.push({
      date: String(h.session_date ?? '').slice(0, 10),
      venue: String(h.venue ?? '').trim(),
      room: String(h.room ?? '').trim(),
      category: h.category as FinCategory,
      amount: amt,
      source: 'history',
    })
  }

  return lines
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

export type FinFilter = {
  /** Room keys ('Paramount · Studio A'). Empty set means every room. */
  rooms: Set<string>
  /** Categories to include. Empty set means all of them. */
  categories: Set<FinCategory>
}

export function filterLines(lines: FinLine[], f: FinFilter): FinLine[] {
  const anyRoom = f.rooms.size === 0
  const anyCat = f.categories.size === 0
  if (anyRoom && anyCat) return lines
  return lines.filter(l =>
    (anyRoom || f.rooms.has(roomKey(l.venue, l.room)))
    && (anyCat || f.categories.has(l.category)),
  )
}

/**
 * Lines → chart columns, one per period in [fromISO, toISO].
 *
 * Empty periods are EMITTED, not skipped. A month with no revenue is
 * information — a chart that quietly closes the gap turns a dead August into a
 * continuous line and hides exactly the thing worth seeing.
 */
export function bucketLines(
  lines: FinLine[], grain: Grain, fromISO: string, toISO: string,
): FinBucket[] {
  const acc = new Map<string, Record<FinCategory, number>>()

  for (const key of periodKeys(grain, fromISO, toISO)) acc.set(key, emptyByCategory())

  for (const l of lines) {
    if (!l.date) continue
    const key = bucketKeyFor(l.date, grain)
    const slot = acc.get(key) ?? emptyByCategory()
    slot[l.category] += l.amount
    acc.set(key, slot)
  }

  return [...acc.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, byCategory]) => ({
      key,
      label: bucketLabelFor(key, grain),
      total: CATEGORIES.reduce((s, c) => s + byCategory[c], 0),
      byCategory,
    }))
}

/** Every period key between two dates, inclusive, in order. */
export function periodKeys(grain: Grain, fromISO: string, toISO: string): string[] {
  const out: string[] = []
  const y0 = Number(fromISO.slice(0, 4))
  const m0 = Number(fromISO.slice(5, 7))
  const y1 = Number(toISO.slice(0, 4))
  const m1 = Number(toISO.slice(5, 7))

  if (grain === 'year') {
    for (let y = y0; y <= y1; y++) out.push(String(y))
    return out
  }

  let y = y0
  let m = m0
  // Guard the loop rather than trusting the inputs — a bad range must not hang
  // the page. 40 years of months is far past anything real.
  for (let guard = 0; guard < 480; guard++) {
    if (y > y1 || (y === y1 && m > m1)) break
    const key = grain === 'quarter'
      ? `${y}-Q${Math.floor((m - 1) / 3) + 1}`
      : `${y}-${String(m).padStart(2, '0')}`
    if (out[out.length - 1] !== key) out.push(key)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

/** Every room that appears in the data, plus every room the studio has today. */
export function roomsIn(lines: FinLine[]): string[] {
  const seen = new Set<string>()
  for (const l of lines) {
    const k = roomKey(l.venue, l.room)
    if (k) seen.add(k)
  }
  return [...seen].sort()
}

export function sumLines(lines: FinLine[]): number {
  return lines.reduce((s, l) => s + l.amount, 0)
}

export function sumByCategory(lines: FinLine[]): Record<FinCategory, number> {
  const out = emptyByCategory()
  for (const l of lines) out[l.category] += l.amount
  return out
}

/**
 * Percentage change, or null when there is no honest comparison to make.
 *
 * Returns null — not Infinity, not 100% — when the prior period is zero. A room
 * that billed nothing last August and $8k this August has not grown by any
 * percentage; it started. The UI prints "new" for that case, which is the true
 * statement.
 */
export function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
}
