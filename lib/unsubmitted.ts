// ─────────────────────────────────────────────────────────────────────────────
// lib/unsubmitted — session days a runner never turned in.
//
// Eli, 2026-09-17: "some runners forget to submit WOs. huge problem… this is
// like a fireable offense. unsubmitted WOs means a runner didn't even look at
// it and it's our only way to know what to collect."
//
// NOTHING NEW IS RECORDED. A runner's Submit marks that day's studio_time_rows
// status='submitted' (WorkOrderPopup.handleRunnerSubmit); rows are born
// 'in_progress'; the office's approval makes them 'approved'. So a day is
// UNSUBMITTED exactly when a confirmed booking covers it and either
//   · it has no work order at all (the worst case — nobody opened it), or
//   · the work order has no studio row dated that day, or
//   · a studio row dated that day is still 'in_progress'.
// Completed work orders are skipped: the office has already closed the book.
//
// Read in three places, from the same function so they can never disagree:
//   · the runner's closing checklist — Submit closing is a hard stop while
//     any of TODAY's sessions at that studio is unsubmitted (Eli: "runners
//     need to work on the closing checklist, so make the notification show
//     when they go to submit").
//   · the office dashboard — a once-a-day pop-up listing the last 14 days.
//   · the billing hub — a chip on the row (computed in lib/billing from the
//     rows it already holds; same rule, see unsubmittedDaysOf).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { dateRange } from './time'
import { STUDIO_SHORT } from './studios'

export type UnsubmittedSession = {
  bookingId: string
  workOrderId: string | null
  woNumber: string | null
  date: string
  /** Venue name as the booking carries it ("Encore"). */
  location: string
  /** Runner-hub slug: paramount | ameraycan | encore | track. */
  slug: string
  room: string
  client: string
  fromTime: string | null
  toTime: string | null
  /** Who submitted closing ops for that studio that day — the accountability line. Null = nobody closed out in the app. */
  closedBy: string | null
}

const SLUGS: Record<string, string> = { Paramount: 'paramount', Ameraycan: 'ameraycan', Encore: 'encore', Track: 'track' }

/** bookings.location → runner slug, tolerant of "Encore Recording Studios" / "ERS". */
export function studioSlugOf(location: string | null | undefined): string {
  const loc = String(location ?? '').toLowerCase()
  for (const [name, slug] of Object.entries(SLUGS)) {
    if (loc.includes(slug) || loc.includes(STUDIO_SHORT[name].toLowerCase())) return slug
  }
  return ''
}

const SENT = new Set(['submitted', 'approved'])

/** The dates (< before) on which any studio row of this work order is still in progress. Used by the billing hub. */
export function unsubmittedDaysOf(
  rows: { date: string | null; studio: string | null; status: string | null; admin_locked?: boolean | null }[],
  before: string,
): string[] {
  const out = new Set<string>()
  for (const r of rows) {
    if (!r.date || r.date >= before) continue
    if (!(r.studio ?? '').trim()) continue // staff sub-rows follow the studio row
    if (r.admin_locked) continue
    if (!SENT.has(r.status ?? 'in_progress')) out.add(r.date)
  }
  return Array.from(out).sort()
}

/**
 * Every unsubmitted (booking, day) between `from` and `to` inclusive,
 * optionally for one studio slug. Confirmed bookings only — lockouts have no
 * nightly submit (the standing rule), so they never nag.
 */
export async function fetchUnsubmittedSessions(opts: { from: string; to: string; slug?: string }): Promise<UnsubmittedSession[]> {
  const { data: bData, error } = await supabase
    .from('bookings')
    .select('id, location, studio, start_date, end_date, from_time, to_time, client_name, artist, label, work_order_id, wo_number')
    .lte('start_date', opts.to)
    .gte('end_date', opts.from)
    .eq('status', 'confirmed')
    .order('start_date', { ascending: true })
  if (error || !bData) return []
  const bookings = bData.filter(b => !opts.slug || studioSlugOf(b.location) === opts.slug)
  if (bookings.length === 0) return []

  // Resolve each card's work order: its own forward link first, then the
  // reverse link (first-wins by created_at) for pre-rebuild rows — the same
  // two hops the runner hub uses.
  const woIds = Array.from(new Set(bookings.map(b => b.work_order_id).filter(Boolean))) as string[]
  const bookingIds = bookings.map(b => b.id)
  const [byId, byBooking] = await Promise.all([
    woIds.length
      ? supabase.from('work_orders').select('id, status, wo_number').in('id', woIds)
      : Promise.resolve({ data: [] as { id: string; status: string; wo_number: string | null }[] }),
    supabase.from('work_orders').select('id, status, wo_number, booking_id, created_at').in('booking_id', bookingIds).order('created_at', { ascending: true }),
  ])
  const woById = new Map<string, { id: string; status: string; wo_number: string | null }>()
  for (const w of byId.data ?? []) woById.set(w.id, w)
  const woByBooking = new Map<string, { id: string; status: string; wo_number: string | null }>()
  for (const w of byBooking.data ?? []) if (w.booking_id && !woByBooking.has(w.booking_id)) woByBooking.set(w.booking_id, w)

  const resolved = bookings.map(b => ({ b, wo: (b.work_order_id ? woById.get(b.work_order_id) : undefined) ?? woByBooking.get(b.id) ?? null }))
  const allWo = Array.from(new Set(resolved.map(r => r.wo?.id).filter(Boolean))) as string[]
  const { data: rows } = allWo.length
    ? await supabase.from('studio_time_rows').select('work_order_id, date, studio, status, admin_locked').in('work_order_id', allWo).gte('date', opts.from).lte('date', opts.to)
    : { data: [] as { work_order_id: string; date: string | null; studio: string | null; status: string | null; admin_locked: boolean | null }[] }
  const rowsByWo = new Map<string, NonNullable<typeof rows>>()
  for (const r of rows ?? []) (rowsByWo.get(r.work_order_id) ?? rowsByWo.set(r.work_order_id, []).get(r.work_order_id)!).push(r)

  const out: UnsubmittedSession[] = []
  for (const { b, wo } of resolved) {
    if (wo && wo.status === 'completed') continue
    for (const date of dateRange(b.start_date, b.end_date)) {
      if (date < opts.from || date > opts.to) continue
      const dayRows = (rowsByWo.get(wo?.id ?? '') ?? []).filter(r => r.date === date && (r.studio ?? '').trim())
      const unsubmitted = !wo
        || dayRows.length === 0
        || dayRows.some(r => !r.admin_locked && !SENT.has(r.status ?? 'in_progress'))
      if (!unsubmitted) continue
      out.push({
        bookingId: b.id, workOrderId: wo?.id ?? null, woNumber: wo?.wo_number ?? b.wo_number ?? null,
        date, location: b.location, slug: studioSlugOf(b.location), room: b.studio,
        client: b.label || b.client_name || b.artist || 'Unknown',
        fromTime: b.from_time, toTime: b.to_time, closedBy: null,
      })
    }
  }
  if (out.length === 0) return out

  // Who closed that studio that night (daily_ops_submissions is keyed on the
  // runner slug + calendar date; the checklist writes category
  // 'closing_checklist', older rows say 'closing').
  const dates = Array.from(new Set(out.map(o => o.date)))
  const { data: ops } = await supabase.from('daily_ops_submissions').select('studio, date, category, staff_name').in('date', dates).in('category', ['closing_checklist', 'closing'])
  const closer = new Map<string, string>()
  for (const o of ops ?? []) if (o.staff_name) closer.set(`${o.studio}|${o.date}`, o.staff_name)
  for (const o of out) o.closedBy = closer.get(`${o.slug}|${o.date}`) ?? null
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug))
}
