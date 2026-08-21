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

/**
 * What the dashed comparison line is drawing.
 *
 *   null    → no comparison
 *   'prev'  → the month one year earlier, whatever month you are on
 *   '2019'  → the same month-of-year in that FIXED year
 *
 * The two modes answer different questions and both are wanted. 'prev' is
 * "are we up on last year", and it slides along with the data. A fixed year is
 * "how do we compare to 2019", which is a baseline — Eli's peak years are worth
 * measuring against directly, and asking that of a rolling offset would mean
 * counting backwards in your head every time you zoom.
 */
export type Compare = 'prev' | string | null

/** The month a given point should be compared against, or null for none. */
export function compareKey(key: string, compare: Compare): string | null {
  if (!compare) return null
  if (compare === 'prev') return priorYearKey(key)
  return compare + key.slice(4)
}

/** How the comparison should be named in the readout and the label. */
export function compareLabel(key: string, compare: Compare): string {
  if (!compare) return ''
  return compare === 'prev' ? priorYearKey(key).slice(0, 4) : compare
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
  const stRes = await supabase
    .from('studio_time_rows')
    .select('work_order_id, studio, location, date, charge, ot_charge, from_time, to_time, eng_from_time, eng_to_time, eng_hours, eng_rate, eng_role')
    .gte('date', fromISO)
    .lte('date', toISO)

  if (!dbResult('Loading studio time for financials', stRes.error)) return []

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

  return lines
}

// ─── History (pre-aggregated in Postgres) ────────────────────────────────────

// ─── Variable-grain series ───────────────────────────────────────────────────

export type Grain = 'day' | 'week' | 'month'

export const GRAINS: { key: Grain; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]

/**
 * Which grain suits a window of this many months.
 *
 * SEMANTIC ZOOM — the grain follows the zoom, the way every serious charting
 * tool does it. The thresholds are chosen so the chart lands between roughly 40
 * and 200 points: below 40 it looks blocky, above ~200 the line turns to noise
 * on a 1000-unit-wide viewBox and neighbouring days sit inside a pixel of each
 * other.
 *
 * FIRST ATTEMPT WAS FAR TOO FINE (2026-08-20). It allowed week up to 36 months
 * — around 156 points on a 1000-unit viewBox, roughly six units apart — and the
 * line became a solid field of noise with no readable shape at all. Eli, on
 * seeing it: "whatever you just did made it much worse."
 *
 * The ceiling that matters is POINTS, not periods. Past ~90 points a line stops
 * being a trend and starts being texture, so the thresholds are set to keep the
 * chart under that at every zoom:
 *
 *   ≤ 2 months   →  day    (≈ 60 points)
 *   ≤ 18 months  →  week   (≈ 78 points)
 *   beyond       →  month  (36 points at three years)
 *
 * A finer grain is always one click away — this only decides the DEFAULT, and
 * the default should be readable.
 */
export function autoGrain(months: number): Grain {
  if (months <= 2) return 'day'
  if (months <= 18) return 'week'
  return 'month'
}

/** One bucket of the main line. `bucket` is the period's START date, ISO. */
export type SeriesRow = { bucket: string; amount: number }

/**
 * A windowed, single-metric series at the requested grain.
 *
 * The window and the metric are NOT optional refinements — they are what keeps
 * the response under PostgREST's silent 1,000-row cap. Daily across nine years
 * for all four categories is 14,600 rows and would truncate to 2017 without
 * saying so, which is the exact bug migration 20260820150000 exists to prevent.
 */
export async function fetchSeries(
  scope: RoomScope, metric: Metric, grain: Grain, fromISO: string, toISO: string,
): Promise<SeriesRow[]> {
  const res = await supabase.rpc('financial_series', {
    p_scope: scope || '',
    p_metric: metric,
    p_grain: grain,
    p_from: fromISO,
    p_to: toISO,
  })
  // Absent on a database where the migration has not run yet — the live half is
  // still true, so this degrades rather than blanking the page.
  if (res.error) {
    const code = res.error.code
    if (code !== '42883' && code !== '42P01' && code !== 'PGRST202') {
      dbResult('Loading revenue series', res.error)
    }
    return []
  }
  return (res.data ?? []).map((r: { bucket: string; amount: number | string }) => ({
    bucket: String(r.bucket).slice(0, 10),
    amount: money(r.amount),
  }))
}

/**
 * The bucket one year earlier, at this grain.
 *
 * Weeks use 364 days, NOT a calendar year. 364 is exactly 52 weeks, so the
 * comparison lands on the same weekday — the retail convention, and the only
 * one that makes weekly year-over-year meaningful. A calendar year would drift
 * the comparison one or two weekdays every year and quietly compare a week
 * containing a weekend against one that does not.
 */
export function priorBucket(iso: string, grain: Grain): string {
  if (grain === 'week') {
    const d = new Date(iso + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 364)
    return d.toISOString().slice(0, 10)
  }
  // Day and month both map cleanly onto the same date a year back. Noon UTC
  // keeps the shift away from any midnight boundary.
  return String(Number(iso.slice(0, 4)) - 1) + iso.slice(4)
}

/** Human label for a bucket at a given grain. */
export function bucketLabel(iso: string, grain: Grain): string {
  const mon = MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''
  if (grain === 'month') return mon
  return `${mon} ${Number(iso.slice(8, 10))}`
}

/** Any date shifted back one comparison period. See priorBucket for the 364. */
export function shiftBack(iso: string, grain: Grain): string {
  return priorBucket(iso, grain)
}

/**
 * The start of the bucket a date falls in.
 *
 * Week start MUST match Postgres `date_trunc('week', …)`, which is ISO — Monday.
 * If these two disagree the archive's buckets and the live ones land a day
 * apart and every week is drawn twice.
 */
export function bucketStart(iso: string, grain: Grain): string {
  if (grain === 'month') return iso.slice(0, 7) + '-01'
  if (grain === 'day') return iso.slice(0, 10)
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

function nextBucket(iso: string, grain: Grain): string {
  const d = new Date(iso + 'T12:00:00Z')
  if (grain === 'day') d.setUTCDate(d.getUTCDate() + 1)
  else if (grain === 'week') d.setUTCDate(d.getUTCDate() + 7)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

/** One point on the drawn line. */
export type DrawPoint = {
  key: string          // bucket start, ISO
  label: string
  value: number
  prior: number | null
  /** The period has not finished — data stops inside it. */
  partial: boolean
}

/**
 * The drawn line: archive + live, at one grain, with its comparison.
 *
 * Empty buckets are EMITTED, not skipped. A closed Tuesday earned nothing and
 * the chart should say so; closing the gap would draw a line straight over it
 * and turn a dark week into a smooth one.
 *
 * The caller fetches the prior window with its end already shifted back, so the
 * final prior bucket is truncated to the same portion of the period as the
 * partial one it is compared against. That is what keeps a half-finished month
 * from reporting a collapse, and it needs no day-capping here.
 */
export function buildDrawPoints(
  current: SeriesRow[],
  priorRows: SeriesRow[],
  live: FinLine[],
  metric: Metric,
  grain: Grain,
  fromISO: string,
  toISO: string,
  latestISO: string,
): DrawPoint[] {
  const hist = new Map<string, number>()
  for (const r of current) hist.set(r.bucket, (hist.get(r.bucket) ?? 0) + r.amount)

  const prior = new Map<string, number>()
  for (const r of priorRows) prior.set(r.bucket, (prior.get(r.bucket) ?? 0) + r.amount)

  // Live rows are bucketed once, across their whole span, so the same map
  // answers both the current window and the comparison window.
  const liveBuckets = new Map<string, number>()
  for (const l of live) {
    if (!l.date || (metric !== 'total' && l.category !== metric)) continue
    const b = bucketStart(l.date, grain)
    liveBuckets.set(b, (liveBuckets.get(b) ?? 0) + l.amount)
  }

  const at = (m: Map<string, number>, key: string) => (m.get(key) ?? 0) + (liveBuckets.get(key) ?? 0)

  const out: DrawPoint[] = []
  let cursor = bucketStart(fromISO, grain)
  // Guarded: ~11 years of days is under 4,100, and a bad range must not hang.
  for (let guard = 0; guard < 4200; guard++) {
    if (cursor > toISO) break
    const end = nextBucket(cursor, grain)
    const pk = priorBucket(cursor, grain)
    const priorVal = prior.has(pk) || liveBuckets.has(pk) ? at(prior, pk) : null
    out.push({
      key: cursor,
      label: bucketLabel(cursor, grain),
      value: at(hist, cursor),
      prior: priorVal,
      partial: latestISO >= cursor && latestISO < end && end > toISO.slice(0, 10),
    })
    cursor = end
  }
  return out
}

/** One month of archived revenue, already summed by the database. */
export type HistMonth = {
  month: string       // 'YYYY-MM'
  category: FinCategory
  amount: number      // whole month
  amountToDay: number // same month, summed only to the day cap
}

export type HistoryFetch = {
  months: HistMonth[]
  /** Newest day the archive holds, or '' when there is none. */
  latest: string
  rooms: { venue: string; room: string }[]
}

/**
 * The archive, rolled up by the database.
 *
 * NEVER SELECT RAW ROWS FROM `financial_history`. PostgREST caps a response at
 * 1,000 rows and does not tell you it did — a straight select against 55,601
 * rows returns 2017 and calls it success, which is precisely the bug this
 * replaced (see migration 20260820150000). The rollup is bounded by months, not
 * by row count, so it cannot silently truncate as the archive grows.
 *
 * `dayCap` narrows the second figure for partial-month comparison. It is passed
 * in rather than derived here because the newest data may be LIVE, not archived
 * — the caller knows about both halves and this function only knows one.
 */
export async function fetchHistory(scope: RoomScope, dayCap: number): Promise<HistoryFetch> {
  const [monthsRes, roomsRes, latestRes] = await Promise.all([
    supabase.rpc('financial_monthly', { p_scope: scope || '', p_day: dayCap }),
    supabase.rpc('financial_rooms'),
    supabase.rpc('financial_latest_date'),
  ])

  // The archive is optional. On a database where the migrations have not run,
  // or for a signed-in user whose role cannot see it, the live half is still
  // true — so a failure here degrades to "PRSFlo years only" rather than an
  // empty page. Only real faults are reported.
  const missing = (e: { code?: string } | null) =>
    !!e && (e.code === '42883' || e.code === '42P01' || e.code === 'PGRST202')
  if (monthsRes.error && !missing(monthsRes.error)) {
    dbResult('Loading revenue history', monthsRes.error)
  }

  const months: HistMonth[] = (monthsRes.data ?? []).map((r: {
    month: string; category: string; amount: number | string; amount_to_day: number | string
  }) => ({
    month: String(r.month),
    category: r.category as FinCategory,
    amount: money(r.amount),
    amountToDay: money(r.amount_to_day),
  }))

  return {
    months,
    latest: latestRes.data ? String(latestRes.data).slice(0, 10) : '',
    rooms: (roomsRes.data ?? []) as { venue: string; room: string }[],
  }
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

/**
 * Every venue and room for the dropdown — from BOTH halves.
 *
 * The archive's room list and the live one differ: seven rooms carry history
 * but are not in STUDIO_LOCATIONS, and a newly-added room has no history at
 * all. Either list alone would hide rooms that have money against them.
 */
export function roomOptions(
  lines: FinLine[],
  histRooms: { venue: string; room: string }[] = [],
): { venue: string; rooms: string[] }[] {
  const byVenue = new Map<string, Set<string>>()
  const add = (venue: string, room: string) => {
    if (!venue || !room) return
    const set = byVenue.get(venue) ?? new Set<string>()
    set.add(room)
    byVenue.set(venue, set)
  }
  for (const l of lines) add(l.venue, l.room)
  for (const r of histRooms) add(String(r.venue ?? '').trim(), String(r.room ?? '').trim())
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
  liveLines: FinLine[],
  hist: HistMonth[],
  metric: Metric,
  fromISO: string,
  toISO: string,
  latestISO: string,
  compare: Compare = 'prev',
): SeriesPoint[] {
  // month → { whole month, month capped at `dayCap` }. The two halves arrive in
  // different shapes — history pre-summed by Postgres, live as daily rows — and
  // are folded into one map here so nothing downstream can tell them apart.
  const byMonth = new Map<string, { full: number; toDay: number }>()
  const slot = (key: string) => {
    const s = byMonth.get(key) ?? { full: 0, toDay: 0 }
    byMonth.set(key, s)
    return s
  }

  const dayCap = latestISO ? Number(latestISO.slice(8, 10)) : 31

  for (const h of hist) {
    if (metric !== 'total' && h.category !== metric) continue
    const s = slot(h.month)
    s.full += h.amount
    s.toDay += h.amountToDay
  }

  for (const l of liveLines) {
    if (!l.date || !inMetric(l, metric)) continue
    const s = slot(l.date.slice(0, 7))
    s.full += l.amount
    if (Number(l.date.slice(8, 10)) <= dayCap) s.toDay += l.amount
  }

  // The newest month is partial only if data actually stops before the month
  // ends. A completed December is not partial just because it is last.
  const latestMonth = latestISO.slice(0, 7)

  return monthKeys(fromISO, toISO).map(key => {
    const partial = key === latestMonth && dayCap > 0 && dayCap < daysInMonth(key)
    const here = byMonth.get(key)
    const cmp = compareKey(key, compare)
    const prev = cmp ? byMonth.get(cmp) : undefined
    return {
      key,
      label: monthLabel(key),
      year: key.slice(0, 4),
      value: here ? (partial ? here.toDay : here.full) : 0,
      // The prior year is narrowed to the same day range ONLY when this month
      // is partial — that is what makes the percentage honest.
      prior: prev ? (partial ? prev.toDay : prev.full) : null,
      partial,
      throughDay: partial ? dayCap : null,
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
