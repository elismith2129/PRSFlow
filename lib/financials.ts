// ─────────────────────────────────────────────────────────────────────────────
// lib/financials — revenue over time, across the PRSFlo years and the ones
// before it.
//
// FOUR STREAMS, ONE SHAPE. Every dollar the studio bills is one of: the ROOM,
// the ASSISTANT, the ENGINEER, or a RENTAL. Live money lives in
// `studio_time_rows` + `rental_rows`; the years before the app live in
// `financial_history` (migration 20260820140000). This file is the ONLY place
// the two are joined — every consumer sees one flat list of `FinLine` and never
// learns which side a number came from. When the historical window ages out,
// this file changes and no screen does.
//
// ONE LINE, SWAPPABLE SUBJECT (RULING 2026-08-20). The first build stacked the
// four streams and put a table under it. Eli, on seeing it: "I don't really
// need to see engineering against the room or rentals against the engineering."
// He is right, and the stack was actively harmful — at these scales room
// revenue is 85% of the total, so engineering and rentals were crushed flat
// against the axis and their year-to-year movement, which is the thing he
// actually wants to read, was invisible. So the chart draws ONE series and the
// metric switches which one. Each gets its own scale and is legible alone.
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
// studio-time row. Filter to a single room and its rental figure means "rentals
// on work orders that started in this room". Totals across all rooms are exact.
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

/** What the single line is currently drawing. */
export type Metric = 'total' | FinCategory

export const METRICS: { key: Metric; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'room', label: 'Room' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'assistant', label: 'Assistant' },
  { key: 'rental', label: 'Rentals' },
]

/** One dollar figure, attributed to a day, a room and a stream. */
export type FinLine = {
  date: string          // ISO yyyy-mm-dd, the SESSION date
  venue: string         // 'Paramount' | 'Ameraycan' | 'Encore' | 'Track'
  room: string          // 'Studio A' … | 'North' | 'South'
  category: FinCategory
  amount: number
  source: 'live' | 'history'
}

/**
 * One month on the chart.
 *
 * `prior` is the SAME MONTH a year earlier — except on a partial month, where
 * it is the same DAY RANGE a year earlier. See buildSeries.
 */
export type SeriesPoint = {
  key: string           // '2026-08'
  label: string         // 'Aug'
  year: string          // '2026'
  value: number
  prior: number | null
  /** True when this month has not finished — the data stops mid-month. */
  partial: boolean
  /** On a partial month, the last day with data. Null otherwise. */
  throughDay: number | null
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

export function monthLabel(key: string): string {
  return MONTHS[Number(key.slice(5, 7)) - 1] ?? key
}

/**
 * Last day of a month, from its key.
 *
 * `new Date(y, m, 0)` is a LOCAL date and this only ever reads .getDate(), so
 * the timezone trap that makes ISO date strings dangerous does not apply — the
 * day-count of a month is the same everywhere.
 */
function daysInMonth(key: string): number {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate()
}

/** '2026-08' → '2025-08'. */
export function priorYearKey(key: string): string {
  return String(Number(key.slice(0, 4)) - 1) + key.slice(4)
}

/** Every month key between two dates, inclusive, in order. */
export function monthKeys(fromISO: string, toISO: string): string[] {
  const out: string[] = []
  let y = Number(fromISO.slice(0, 4))
  let m = Number(fromISO.slice(5, 7))
  const y1 = Number(toISO.slice(0, 4))
  const m1 = Number(toISO.slice(5, 7))
  // Guarded rather than trusting the inputs — a bad range must not hang the page.
  for (let guard = 0; guard < 600; guard++) {
    if (y > y1 || (y === y1 && m > m1)) break
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
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
 * Both halves are fetched in parallel and flattened into one list. The date
 * filter is applied in Postgres so a ten-year window does not drag the whole
 * table into the browser; rentals are then fetched only for the work orders
 * that survived it.
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

// ─── Filter ──────────────────────────────────────────────────────────────────

/**
 * The room selector's value. '' is everything; 'venue:Encore' is a whole
 * building; anything else is one room key.
 */
export type RoomScope = string

export function scopeMatches(scope: RoomScope, l: FinLine): boolean {
  if (!scope) return true
  if (scope.startsWith('venue:')) return l.venue === scope.slice(6)
  return roomKey(l.venue, l.room) === scope
}

export function scopeLabel(scope: RoomScope): string {
  if (!scope) return 'All rooms'
  if (scope.startsWith('venue:')) return scope.slice(6) + ' — all rooms'
  return scope.replace(' · ', ' ')
}

/** Every venue and room present in the data, for the dropdown. */
export function roomOptions(lines: FinLine[]): { venue: string; rooms: string[] }[] {
  const byVenue = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.venue || !l.room) continue
    const set = byVenue.get(l.venue) ?? new Set<string>()
    set.add(l.room)
    byVenue.set(l.venue, set)
  }
  return [...byVenue.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([venue, rooms]) => ({ venue, rooms: [...rooms].sort() }))
}

// ─── Series ──────────────────────────────────────────────────────────────────

function inMetric(l: FinLine, metric: Metric): boolean {
  return metric === 'total' ? true : l.category === metric
}

/**
 * Lines → one point per month, with its year-over-year comparison.
 *
 * THE PARTIAL MONTH IS THE WHOLE POINT OF KEEPING DAILY DATA.
 *
 * The current month is not finished. Charting $119,686 of a half-finished
 * August against all 31 days of August 2025 reports a 60% collapse that did not
 * happen — and that false cliff is what the first build showed. Because every
 * row carries a real date, the comparison can be narrowed instead: an August
 * that has run to the 18th is compared against August 1–18 of the previous
 * year. Same window, honest answer.
 *
 * No projection, no run-rate. Those invent a number, and a forecast drawn in the
 * same ink as measured data is worse than an obvious gap.
 *
 * Empty months are EMITTED, not skipped — a month with no revenue is
 * information, and a chart that closes the gap hides exactly the thing worth
 * seeing.
 */
export function buildSeries(
  lines: FinLine[],
  metric: Metric,
  fromISO: string,
  toISO: string,
): SeriesPoint[] {
  // month → day-of-month → amount. Bucketing once keeps the day-range lookups
  // that the partial month needs from being a scan per month.
  const byMonth = new Map<string, Map<number, number>>()
  let latest = ''

  for (const l of lines) {
    if (!l.date || !inMetric(l, metric)) continue
    if (l.date > latest) latest = l.date
    const key = l.date.slice(0, 7)
    const day = Number(l.date.slice(8, 10))
    const days = byMonth.get(key) ?? new Map<number, number>()
    days.set(day, (days.get(day) ?? 0) + l.amount)
    byMonth.set(key, days)
  }

  const sumMonth = (key: string, throughDay: number | null): number | null => {
    const days = byMonth.get(key)
    if (!days) return null
    let total = 0
    for (const [day, amt] of days) {
      if (throughDay === null || day <= throughDay) total += amt
    }
    return total
  }

  // The newest month is partial only if data actually stops before the month
  // ends. A completed December is not partial just because it is last.
  const latestMonth = latest.slice(0, 7)
  const latestDay = latest ? Number(latest.slice(8, 10)) : 0

  return monthKeys(fromISO, toISO).map(key => {
    const partial = key === latestMonth && latestDay > 0 && latestDay < daysInMonth(key)
    const throughDay = partial ? latestDay : null
    return {
      key,
      label: monthLabel(key),
      year: key.slice(0, 4),
      value: sumMonth(key, throughDay) ?? 0,
      // The prior year is narrowed to the same day range ONLY when this month
      // is partial — that is what makes the percentage honest.
      prior: sumMonth(priorYearKey(key), throughDay),
      partial,
      throughDay,
    }
  })
}

/**
 * Percentage change, or null when there is no honest comparison to make.
 *
 * Returns null — not Infinity, not 100% — when the prior period is zero. A room
 * that billed nothing last August and $8k this August has not grown by any
 * percentage; it started. The UI prints "new" for that, which is the true
 * statement.
 */
export function pctChange(current: number, prior: number | null): number | null {
  if (prior === null || prior === 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
}
