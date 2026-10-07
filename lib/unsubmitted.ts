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
// Read in four places, from the same function so they can never disagree:
//   · the runner's closing checklist — Submit closing is a hard stop while
//     any of TODAY's sessions at that studio is unsubmitted (Eli: "runners
//     need to work on the closing checklist, so make the notification show
//     when they go to submit").
//   · the office dashboard — a once-a-day pop-up listing the last 14 days.
//   · the billing hub — a chip on the row (computed in lib/billing from the
//     rows it already holds; same rule, see unsubmittedDaysOf).
//   · Daily Ops — a red "WO not submitted" badge on that studio's card for
//     the night being viewed (fetchNightMissedWorkOrders, 2026-10-05). This
//     reader passes `includeCovered`: see the note on that option.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { dateRange, opsDayOf } from './time'
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
  /** The office has since closed the book on this day (work order completed, or
   *  the day reviewed/locked). Only ever true when `includeCovered` was asked for. */
  covered: boolean
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
  rows: { date: string | null; studio: string | null; status: string | null; admin_locked?: boolean | null; day_status?: string | null }[],
  before: string,
): string[] {
  const out = new Set<string>()
  for (const r of rows) {
    if (!r.date || r.date >= before) continue
    if (!(r.studio ?? '').trim()) continue // staff sub-rows follow the studio row
    if (r.admin_locked) continue
    // A day the office marked tentative or cancelled was never a night to
    // submit (2026-09-19).
    if (r.day_status === 'tentative' || r.day_status === 'cancelled') continue
    if (!SENT.has(r.status ?? 'in_progress')) out.add(r.date)
  }
  return Array.from(out).sort()
}

/**
 * Every unsubmitted (booking, day) between `from` and `to` inclusive,
 * optionally for one studio slug. Confirmed bookings only — lockouts have no
 * nightly submit (the standing rule), so they never nag.
 *
 * `includeCovered` (Daily Ops, 2026-10-05) — by default a day drops off this
 * list the moment the office covers for it (Complete WO, or reviewing the day),
 * because the two original readers are about work still OWED. Daily Ops asks a
 * different question: did the runner turn it in THAT NIGHT. The office fixing
 * it the next morning does not change the answer, and a look back at last
 * Tuesday must still show the miss. With the flag on, completed work orders and
 * locked days are kept and marked `covered`. The evidence is the row itself:
 * status still 'in_progress', or sent with `submitted_for_runner` set (the
 * office's review submitted it - migration 20261006120000).
 */
export async function fetchUnsubmittedSessions(opts: { from: string; to: string; slug?: string; includeCovered?: boolean }): Promise<UnsubmittedSession[]> {
  const { data: bData, error } = await supabase
    .from('bookings')
    .select('id, location, studio, start_date, end_date, from_time, to_time, client_name, artist, label, work_order_id, wo_number, imported_at')
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
    // select('*') ON PURPOSE (2026-10-06): this read now needs
    // submitted_for_runner, and a named column that is not there yet fails the
    // whole query - which this function would read as "no rows", i.e. every
    // session in range unsubmitted. With '*' a missing column is just
    // undefined and nothing changes until the migration has run.
    ? await supabase.from('studio_time_rows').select('*').in('work_order_id', allWo).gte('date', opts.from).lte('date', opts.to)
    : { data: [] as { work_order_id: string; date: string | null; studio: string | null; status: string | null; admin_locked: boolean | null; day_status: string | null; submitted_for_runner?: boolean | null }[] }
  const rowsByWo = new Map<string, NonNullable<typeof rows>>()
  for (const r of rows ?? []) (rowsByWo.get(r.work_order_id) ?? rowsByWo.set(r.work_order_id, []).get(r.work_order_id)!).push(r)

  const out: UnsubmittedSession[] = []
  for (const { b, wo } of resolved) {
    const woCompleted = !!wo && wo.status === 'completed'
    if (woCompleted && !opts.includeCovered) continue
    for (const date of dateRange(b.start_date, b.end_date)) {
      if (date < opts.from || date > opts.to) continue
      // Imported history is not a miss (CLAUDE.md → Imported bookings: past +
      // imported = read-only history, never a work order). A WO-less card
      // whose day predates its own import came off the old WordPress calendar
      // already finished. Daily Ops pages back far enough to meet these; the
      // other readers never look that far, so this changes nothing for them.
      if (!wo && b.imported_at && date < String(b.imported_at).slice(0, 10)) continue
      const dayRows = (rowsByWo.get(wo?.id ?? '') ?? []).filter(r => r.date === date && (r.studio ?? '').trim())
      // Per-day status (2026-09-19): a day marked tentative/cancelled on the
      // WO is not a night to submit, even under a confirmed card.
      if (dayRows.length > 0 && dayRows.every(r => r.day_status === 'tentative' || r.day_status === 'cancelled')) continue
      // TWO QUESTIONS, TWO LISTS (2026-10-06).
      //   stillOwed      - not sent by anyone and not reviewed: work the office
      //                    still has to deal with (the pop-up, the runner hub).
      //   neverByRunner  - the runner did not turn it in: never sent at all, OR
      //                    sent by the office on review (submitted_for_runner).
      //                    Daily Ops' question, whatever happened afterwards.
      // Before the rescue stamp came back, status alone answered both.
      const stillOwed = dayRows.filter(r => !SENT.has(r.status ?? 'in_progress') && !r.admin_locked)
      const neverByRunner = dayRows.filter(r => !SENT.has(r.status ?? 'in_progress') || (r as { submitted_for_runner?: boolean | null }).submitted_for_runner === true)
      const unsubmitted = !wo
        || dayRows.length === 0
        || (opts.includeCovered ? neverByRunner.length > 0 : stillOwed.length > 0)
      if (!unsubmitted) continue
      const covered = woCompleted || (neverByRunner.length > 0 && stillOwed.length === 0)
      out.push({
        bookingId: b.id, workOrderId: wo?.id ?? null, woNumber: wo?.wo_number ?? b.wo_number ?? null,
        date, location: b.location, slug: studioSlugOf(b.location), room: b.studio,
        client: b.label || b.client_name || b.artist || 'Unknown',
        fromTime: b.from_time, toTime: b.to_time, closedBy: null, covered,
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

// ─── Daily Ops: the night's missed work orders, with a name ─────────────────
//
// Eli, 2026-10-05: "for the WO not submitted I need a name or initials."
// The app never assigns a runner to a session (openers, closers and floats all
// touch them), so the name is the best evidence available, in this order:
//   1. the LAST RUNNER WHO SAVED that work order during that operational day
//      (wo_activity, source 'runner') — they had it open and did not submit;
//   2. whoever filed that studio's closing checklist (`closedBy`);
//   3. nobody — the badge shows "?" rather than guessing.
// `whoSource` says which, so the badge's tooltip can be honest about it.
export type MissedWorkOrder = UnsubmittedSession & { who: string | null; whoSource: 'saved' | 'closer' | null }

export async function fetchNightMissedWorkOrders(date: string): Promise<MissedWorkOrder[]> {
  const list = await fetchUnsubmittedSessions({ from: date, to: date, includeCovered: true })
  if (list.length === 0) return []
  const ids = Array.from(new Set(list.map(o => o.workOrderId).filter(Boolean))) as string[]
  const lastSaver = new Map<string, string>()
  if (ids.length) {
    // A generous superset (the day ± a calendar day, any timezone), trimmed to
    // the operational day below — the same shape as the runner-notes read.
    const end = new Date(`${date}T12:00:00`); end.setDate(end.getDate() + 2)
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    const { data: acts } = await supabase
      .from('wo_activity')
      .select('work_order_id, actor_name, at')
      .in('work_order_id', ids)
      .eq('source', 'runner')
      .gte('at', `${date}T00:00:00-12:00`)
      .lt('at', `${endStr}T00:00:00-12:00`)
      .order('at', { ascending: true })
    for (const a of acts ?? []) {
      const name = (a.actor_name ?? '').trim()
      if (name && opsDayOf(a.at) === date) lastSaver.set(a.work_order_id, name) // ascending → last one wins
    }
  }
  return list.map(o => {
    const saved = o.workOrderId ? lastSaver.get(o.workOrderId) ?? null : null
    return { ...o, who: saved ?? o.closedBy ?? null, whoSource: saved ? 'saved' as const : o.closedBy ? 'closer' as const : null }
  })
}
