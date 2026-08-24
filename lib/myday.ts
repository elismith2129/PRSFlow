// ─────────────────────────────────────────────────────────────────────────────
// lib/myday — the My Day operational duties layer (docs/MYDAY-BUILD.md).
//
// Single source for the three kinds of thing My Day models (§1, "the triad"):
//
//   DUTIES     — recurring, typed point|cumulative, template in myday_duties and
//                one row per duty per day in myday_entries.
//   QUEUES     — COMPUTED from bookings/work_orders at read time. Nothing about a
//                queue is stored except the per-row step ticks (myday_queue_steps).
//   SCRATCHPAD — shift-note POSTS (myday_note_posts) — ONE post per shift:
//                session notes + studio notes submitted together, signed once,
//                like one "manager notes" email. Opener posts theirs, closer
//                posts theirs; a `shift` tag says which is which. Replaces the
//                shared per-role myday_notes scratchpad (ruling 2026-08-24;
//                the intermediate per-box myday_note_entries lived one day and
//                was dropped). myday_notes is legacy read-only history.
//
// Plus the briefing composer (§5) that fills the Flo box — template sentences
// over real numbers, NO AI. The dashboard's FLO_STATIC / MYDAY_STATIC /
// DGRID_STATIC placeholders are replaced by the outputs of this file.
//
// House rules honoured here:
//   • Every write is checked with dbResult (CLAUDE.md — the #1 audited defect).
//   • Never .maybeSingle() — it returns null on multiple matches instead of
//     erroring, which is what produced 299 duplicate WOs. Use limit(1) + [0].
//   • No local time/date/money math — lib/time.ts and lib/woTotals.ts only.
//   • Realtime is the caller's job: every fetch here must be paired with a
//     subscription on the same table(s), channels named `myday-*`.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { getLocalToday } from '@/lib/time'
import { computeWoTotals } from '@/lib/woTotals'
import { bookingShouldHaveWorkOrder } from '@/lib/createWorkOrder'

// ─── Types ───────────────────────────────────────────────────────────────────

export type MyDayRole = 'manager' | 'billing'
export type DutyCadence = 'daily' | 'weekly' | 'monthly'
export type DutyType = 'point' | 'cumulative'
export type QueueRefType = 'hold' | 'booked' | 'open_hours'

/** A {key,label} pair — used for both capture fields and sub-item checkboxes. */
export type DutyField = { key: string; label: string }

export type MyDayDuty = {
  id: string
  duty_key: string
  role: MyDayRole
  label: string
  cadence: DutyCadence
  /** Weekly: day-of-week 0=Sun…6=Sat. Monthly: day-of-month. Daily: null. */
  due_days: number[] | null
  dtype: DutyType
  captures: DutyField[]
  sub_items: DutyField[]
  sort_order: number
  is_active: boolean
  /**
   * Show on the card every day, not only on its due_days (migration
   * 20260810130000). Set for the manager's valley checks + office stock so they
   * can be ticked any day. Does NOT change when the duty is DUE — the grid and
   * the briefing still key off due_days, so skipping a week still goes red.
   */
  always_available: boolean
  /**
   * When the duty was created. Bounds the backlog scan: a duty cannot have been
   * missed on days before it existed. Without this, the morning My Day goes live
   * every cumulative duty reports a full 30-day backlog and the first briefing
   * anyone ever sees is a wall of red for work nobody was asked to do.
   */
  created_at: string | null
}

export type MyDayEntry = {
  id: string
  duty_id: string
  date: string
  completed_at: string | null
  completed_by: string | null
  captured: Record<string, number>
  sub_state: Record<string, boolean>
  covers_from: string | null
}

/** A duty joined to today's entry, with its backlog resolved. */
export type DutyView = {
  duty: MyDayDuty
  entry: MyDayEntry | null
  /** Is this duty DUE on the viewed date? Drives lateness, the grid, the briefing. */
  isDue: boolean
  /** Should it RENDER on the card? True for always_available duties on any day. */
  isShown: boolean
  done: boolean
  /**
   * Cumulative duties only: how many DUE days before the viewed date are still
   * uncovered. 0 for point duties, always (§2.3 — a point duty missed is just
   * missed, it never accrues).
   */
  backlogDays: number
  /** Earliest uncovered due-date, for the "covering N days (Mon 8/3, Tue 8/4)" line. */
  backlogFrom: string | null
  /**
   * STICKY cadences only (monthly): the due date this blew past and still
   * hasn't been done. Non-null means render it red with an ASAP treatment — it
   * is not a tally, it is a thing that needed doing and didn't happen.
   */
  overdueSince: string | null
  /** Whole days past that date. 0 when not overdue. */
  overdueDays: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * How far back a backlog scan will look. Without a cap, a duty seeded today
 * would report a backlog stretching to the epoch; with one, a genuinely
 * abandoned duty pins at 30 and stops being alarming-but-useless. Well past
 * the 3-day flag threshold that actually drives the UI (HR-SPEC §2.3).
 */
export const BACKLOG_LOOKBACK_DAYS = 30

/** HR-SPEC §2.3 — the "where are we really" signal. */
export const BACKLOG_FLAG_THRESHOLD = 3

/**
 * Cadences that STICK: they stay on the card past their due date until done,
 * and escalate rather than accumulate a backlog count (RULING 2026-08-10).
 *
 * Eli: "for the items that are monthly or quarterly, those types of things,
 * they don't happen often — we can't miss those… if they miss it the next day
 * it's red, or there's an indication: hey, this needs to happen ASAP."
 *
 * Daily and weekly duties recur often enough that "covering 2 days" is the
 * honest summary and the next occurrence comes round quickly. A monthly duty is
 * different: miss the 25th and the next chance is four weeks away, so it cannot
 * be allowed to scroll out of sight. Tenant rent invoicing is money — it must
 * nag, not tally.
 *
 * Quarterly is deliberately NOT here yet: the cadence CHECK constraint only
 * allows daily|weekly|monthly, and a real quarterly duty needs a month+day
 * due_days shape rather than day-of-month. Add both together when one exists.
 */
export const STICKY_CADENCES: DutyCadence[] = ['monthly']

/**
 * How far back a sticky duty looks for the OLDEST occurrence it still owes.
 * Just over a year, so several consecutively missed months are all found rather
 * than the scan stopping at the most recent one and understating the lateness.
 */
const STICKY_LOOKBACK_DAYS = 400

/**
 * MANUAL steps per queue — only things PRSFlo cannot determine for itself
 * (RULING 2026-08-10). Everything it can see is a derived light instead.
 *
 * What was removed and why:
 *   · Calendar — every row in these queues IS a booking, so the light could
 *     never be off. Eli confirmed the case it might have caught (closed deals
 *     not yet scheduled) is already the Holds queue.
 *   · WO — "I don't want there to be a work order button… if it's on the cal,
 *     there's a work order created." Matches CLAUDE.md: the Work Order IS the
 *     booking. A separate tick re-teaches the split we're removing.
 *   · Staff — derived from studio_time_rows.eng_name (see QueueBookingItem).
 *   · Holds lost ALL steps: "it's all happening in text and email. no need to
 *     create more work." A checkbox nobody maintains goes stale and then lies.
 */
export const QUEUE_STEPS: Record<QueueRefType, string[]> = {
  hold: [],
  booked: ['QB'],
  open_hours: [],
}

// Status-colour tokens (design spec §5). Colour is status and nothing else.
const C_HOT = 'var(--c-st-hot)'
const C_WARM = 'var(--c-st-warm)'
const C_BOOKED = 'var(--c-st-booked)'
// Driftglass — the system's neutral. The lookahead tier is not a problem and
// must not read like one: warm is lead-temp/tentative only (spec §5 ruling
// 2026-07-31), and a heads-up in orange would train people to ignore orange.
const C_NEUTRAL = 'var(--c-st-dead)'

// ─── Date helpers (thin wrappers over lib/time — no new date math) ───────────

/** Shift an ISO date by N days. Noon-anchored, matching lib/time's dateRange. */
function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Inclusive list of ISO dates walking BACKWARD from `end`, `count` long. */
function recentDates(end: string, count: number): string[] {
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) out.push(shiftDate(end, -i))
  return out
}

/** "2026-08-10" → "Mon 8/10", for the backlog scope line. */
export function shortDayLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  return `${dow} ${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * Is `duty` due on ISO date `iso`?
 *
 * `due_days` is day-of-week for weekly (0=Sun…6=Sat, matching BOTH JS getDay()
 * and Postgres extract(dow) — they agree, which is why the migration stores it
 * that way) and day-of-month for monthly. Daily duties are due every day.
 */
export function isDutyDueOn(duty: MyDayDuty, iso: string): boolean {
  if (!duty.is_active) return false
  if (duty.cadence === 'daily') return true
  const d = new Date(iso + 'T12:00:00')
  const days = duty.due_days ?? []
  if (duty.cadence === 'weekly') return days.includes(d.getDay())
  return days.includes(d.getDate())
}

/**
 * Should this duty RENDER on the card for `iso`?
 *
 * Deliberately separate from isDutyDueOn. "Due" is a compliance question — it
 * drives the grid, the backlog and the briefing. "Shown" is a UI question. The
 * valley checks are shown every day but only DUE on Tue and Fri, so Fernando can
 * do them whenever while a skipped week still goes red.
 *
 * Render the card with this; judge lateness with isDutyDueOn.
 */
export function isDutyShownOn(duty: MyDayDuty, iso: string): boolean {
  if (!duty.is_active) return false
  return duty.always_available || isDutyDueOn(duty, iso)
}

/**
 * Did this duty exist on `iso`?
 *
 * Used by every RETROSPECTIVE judgement — was it missed, is there a backlog, is
 * that grid square red — and by none of the forward-looking ones, where a duty
 * created this morning is legitimately due this morning. Without it, the day My
 * Day ships everyone is retroactively guilty of work that didn't exist yet.
 */
export function dutyExistedOn(duty: MyDayDuty, iso: string): boolean {
  if (!duty.created_at) return true
  return duty.created_at.slice(0, 10) <= iso
}

// ─── Duty fetching ───────────────────────────────────────────────────────────

/** Row → typed duty. jsonb comes back parsed; guard shape anyway. */
function toDuty(r: any): MyDayDuty {
  return {
    id: r.id,
    duty_key: r.duty_key,
    role: r.role,
    label: r.label,
    cadence: r.cadence,
    due_days: Array.isArray(r.due_days) ? r.due_days : null,
    dtype: r.dtype,
    captures: Array.isArray(r.captures) ? r.captures : [],
    sub_items: Array.isArray(r.sub_items) ? r.sub_items : [],
    sort_order: r.sort_order ?? 0,
    is_active: r.is_active !== false,
    always_available: r.always_available === true,
    created_at: r.created_at ?? null,
  }
}

function toEntry(r: any): MyDayEntry {
  return {
    id: r.id,
    duty_id: r.duty_id,
    date: r.date,
    completed_at: r.completed_at ?? null,
    completed_by: r.completed_by ?? null,
    captured: r.captured && typeof r.captured === 'object' ? r.captured : {},
    sub_state: r.sub_state && typeof r.sub_state === 'object' ? r.sub_state : {},
    covers_from: r.covers_from ?? null,
  }
}

/** Active duty template for a role (or every role when `role` is omitted). */
export async function fetchDuties(role?: MyDayRole): Promise<MyDayDuty[]> {
  let q = supabase
    .from('myday_duties')
    .select('*')
    .eq('is_active', true)
    .order('role')
    .order('sort_order')
  if (role) q = q.eq('role', role)

  const { data, error } = await q
  if (!dbResult('Loading My Day duties', error)) return []
  return (data ?? []).map(toDuty)
}

/** Entries for the given duties over an inclusive ISO date window. */
export async function fetchEntries(
  dutyIds: string[],
  fromDate: string,
  toDate: string,
): Promise<MyDayEntry[]> {
  if (dutyIds.length === 0) return []
  const { data, error } = await supabase
    .from('myday_entries')
    .select('*')
    .in('duty_id', dutyIds)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: false })
  if (!dbResult('Loading My Day entries', error)) return []
  return (data ?? []).map(toEntry)
}

// ─── Backlog ─────────────────────────────────────────────────────────────────

/**
 * Uncovered due-days strictly BEFORE `asOf` for one cumulative duty.
 *
 * Today is excluded on purpose — a duty you haven't done yet at 9am is not late,
 * and a card that opens already accusing you of a backlog is a card people stop
 * opening (HR-SPEC §2.2 rule 2).
 *
 * Derived, never stored (MYDAY-BUILD §4): a stored counter goes stale the moment
 * a day passes without anyone opening the app.
 */
export function computeBacklog(
  duty: MyDayDuty,
  entries: MyDayEntry[],
  asOf: string,
): { days: number; from: string | null; dates: string[] } {
  if (duty.dtype !== 'cumulative') return { days: 0, from: null, dates: [] }

  // Sticky cadences are tracked by computeOverdueSince, not by a tally. Two
  // reasons: the 30-day scan below can only ever reach one prior occurrence of a
  // monthly duty, so the count would be arbitrary; and "covering 2 days" is the
  // wrong sentence for something that needed doing on the 25th and didn't
  // happen. Those escalate instead (RULING 2026-08-10).
  if (STICKY_CADENCES.includes(duty.cadence)) return { days: 0, from: null, dates: [] }

  const mine = entries.filter(e => e.duty_id === duty.id && e.completed_at)
  // A completion on date D covering back to `covers_from` clears [covers_from..D].
  const covered = new Set<string>()
  for (const e of mine) {
    const start = e.covers_from || e.date
    let cur = start
    // Guard against a malformed covers_from in the future relative to its date.
    if (cur > e.date) cur = e.date
    while (cur <= e.date) {
      covered.add(cur)
      cur = shiftDate(cur, 1)
    }
  }

  // A duty cannot be late for days that predate it. On the morning My Day ships,
  // this is the difference between "nothing due yet" and every cumulative duty
  // claiming a month of misses.
  const bornOn = duty.created_at ? duty.created_at.slice(0, 10) : null

  const dates: string[] = []
  for (let i = 1; i <= BACKLOG_LOOKBACK_DAYS; i++) {
    const d = shiftDate(asOf, -i)
    if (bornOn && d < bornOn) break
    if (!isDutyDueOn(duty, d)) continue
    if (covered.has(d)) break // hit the last time it was done — stop scanning
    dates.push(d)
  }
  dates.reverse()
  return { days: dates.length, from: dates[0] ?? null, dates }
}

/**
 * For a STICKY duty (monthly), the due date it blew past and still hasn't done.
 * Null when it's not sticky, not yet due, or already done.
 *
 * "Done" is any completion dated on or after that due date — a monthly duty
 * finished three days late still counts as finished, it just stayed red until
 * someone did it.
 */
export function computeOverdueSince(
  duty: MyDayDuty,
  entries: MyDayEntry[],
  asOf: string,
): string | null {
  if (!STICKY_CADENCES.includes(duty.cadence)) return null
  const bornOn = duty.created_at ? duty.created_at.slice(0, 10) : null

  // Last time it was done at all. A completion clears that occurrence and every
  // earlier one — you don't retroactively invoice three separate Augusts.
  const lastDone = entries
    .filter(e => e.duty_id === duty.id && e.completed_at)
    .map(e => e.date)
    .sort()
    .pop() ?? null

  // The OLDEST due date still owed, not the most recent. If both August and
  // September were missed, this reports August — so "36 days late" is the
  // number shown rather than a comfortable-looking "5 days". Understating the
  // lateness on a duty that only comes round monthly is how it stays missed.
  // Strictly before today: due today is due, not late.
  for (let i = STICKY_LOOKBACK_DAYS; i >= 1; i--) {
    const d = shiftDate(asOf, -i)
    if (bornOn && d < bornOn) continue
    if (lastDone && d <= lastDone) continue
    if (isDutyDueOn(duty, d)) return d
  }
  return null
}

/** Whole days a sticky duty has been overdue. 0 when it isn't. */
export function overdueDays(overdueSince: string | null, asOf: string): number {
  if (!overdueSince) return 0
  return Math.round(
    (new Date(asOf + 'T12:00:00').getTime() -
      new Date(overdueSince + 'T12:00:00').getTime()) / 86400000,
  )
}

/** Duties + their entry for `date`, with backlog resolved. Ready to render. */
export function buildDutyViews(
  duties: MyDayDuty[],
  entries: MyDayEntry[],
  date: string,
): DutyView[] {
  return duties.map(duty => {
    const entry = entries.find(e => e.duty_id === duty.id && e.date === date) ?? null
    const bl = computeBacklog(duty, entries, date)
    const overdueSince = computeOverdueSince(duty, entries, date)
    return {
      duty,
      entry,
      isDue: isDutyDueOn(duty, date),
      // A sticky duty that was missed STAYS on the card. This is the whole
      // point: a monthly item that scrolled away on the 26th would not be seen
      // again until the following month.
      isShown: isDutyShownOn(duty, date) || overdueSince !== null,
      done: !!entry?.completed_at,
      backlogDays: bl.days,
      backlogFrom: bl.from,
      overdueSince,
      overdueDays: overdueDays(overdueSince, date),
    }
  })
}

/** "covering 2 days (Mon 8/3, Tue 8/4)" — the scope line from HR-SPEC §2.3. */
export function backlogScopeLabel(duty: MyDayDuty, entries: MyDayEntry[], asOf: string): string | null {
  const bl = computeBacklog(duty, entries, asOf)
  if (bl.days === 0) return null
  return `covering ${bl.days + 1} days (${bl.dates.map(shortDayLabel).join(', ')})`
}

/**
 * Progress pill: "3 of 5", counting only the duties actually DUE on `date`.
 *
 * Not `isShown`: an always_available duty rendered on an off-day is an optional
 * extra, and counting it would mean the card could never reach "complete" and
 * collapse (HR-SPEC §2.6) on a day when valley checks weren't expected anyway.
 * Overdue always_available duties surface through the backlog callout instead.
 */
export function progressLabel(views: DutyView[]): string {
  const due = views.filter(v => v.isDue)
  return `${due.filter(v => v.done).length} of ${due.length}`
}

// ─── Duty writes ─────────────────────────────────────────────────────────────

/**
 * Mark a duty done for a date, recording captured numbers and who did it.
 *
 * `completedBy` is the acting user's user_profiles.id — NOT inferred from whose
 * card it is. HR-SPEC §5.6: any manager can work another's card when someone is
 * out, and the history has to show who actually did it.
 *
 * Cumulative duties record `covers_from` so the backlog they cleared is visible
 * afterwards. Upsert on (duty_id, date) so re-completing corrects rather than
 * duplicating.
 */
export async function completeDuty(opts: {
  duty: MyDayDuty
  date: string
  completedBy: string | null
  captured?: Record<string, number>
  subState?: Record<string, boolean>
  /** Pass the same entries used to render, so covers_from matches the shown scope. */
  entries?: MyDayEntry[]
}): Promise<boolean> {
  const { duty, date, completedBy, captured, subState, entries } = opts

  let coversFrom: string | null = null
  if (duty.dtype === 'cumulative') {
    const bl = computeBacklog(duty, entries ?? [], date)
    coversFrom = bl.from ?? date
  }

  const { error } = await supabase.from('myday_entries').upsert(
    {
      duty_id: duty.id,
      date,
      completed_at: new Date().toISOString(),
      completed_by: completedBy,
      captured: captured ?? {},
      sub_state: subState ?? {},
      covers_from: coversFrom,
    },
    { onConflict: 'duty_id,date' },
  )
  return dbResult('Completing duty', error)
}

/** Untick a duty. The row stays — history is permanent (HR-SPEC §2.2 rule 4). */
export async function uncompleteDuty(dutyId: string, date: string): Promise<boolean> {
  const { error } = await supabase
    .from('myday_entries')
    .update({ completed_at: null, completed_by: null, covers_from: null })
    .eq('duty_id', dutyId)
    .eq('date', date)
  return dbResult('Reopening duty', error)
}

/** Tick/untick one sub-item without completing the parent duty. */
export async function setDutySubState(
  duty: MyDayDuty,
  date: string,
  subState: Record<string, boolean>,
): Promise<boolean> {
  const { error } = await supabase
    .from('myday_entries')
    .upsert({ duty_id: duty.id, date, sub_state: subState }, { onConflict: 'duty_id,date' })
  return dbResult('Saving duty checklist', error)
}

/** Correct the captured numbers on an already-completed duty. */
export async function setDutyCaptured(
  dutyId: string,
  date: string,
  captured: Record<string, number>,
): Promise<boolean> {
  const { error } = await supabase
    .from('myday_entries')
    .upsert({ duty_id: dutyId, date, captured }, { onConflict: 'duty_id,date' })
  return dbResult('Saving duty numbers', error)
}

// ─── Queues (computed — §3) ──────────────────────────────────────────────────

export type NeedsWoItem = {
  bookingId: string
  date: string
  location: string
  studio: string
  client: string
  artist: string | null
}

export type BalanceItem = {
  workOrderId: string
  bookingId: string | null
  invoiceNumber: string | null
  client: string
  artist: string | null
  sessionDate: string | null
  total: number
  paid: number
  balance: number
}

export type QueueBookingItem = {
  bookingId: string
  date: string
  location: string
  studio: string
  client: string
  artist: string | null
  steps: Record<string, boolean>
  /**
   * Is anyone actually on this session? DERIVED (RULING 2026-08-10) — a light,
   * never a checkbox, because the app can see the answer and nobody should be
   * able to tick it falsely.
   *
   * Read from `studio_time_rows.eng_name`, NOT `bookings.engineer_name`. Per
   * CLAUDE.md staffing lives ONLY in the Studio Time table; the booking columns
   * are a projection written back out of it, so they can be stale or seeded
   * while no real name is on any line.
   */
  staffed: boolean
}

/**
 * Which of these bookings have a real name on a studio-time row.
 *
 * Two hops, because studio_time_rows key off the work order rather than the
 * booking: bookings → work_orders.booking_id → studio_time_rows.work_order_id.
 */
async function fetchStaffedBookingIds(bookingIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (bookingIds.length === 0) return out

  const { data: wos, error: woErr } = await supabase
    .from('work_orders')
    .select('id, booking_id')
    .in('booking_id', bookingIds)
  if (!dbResult('Loading work orders for staffing', woErr)) return out
  if (!wos || wos.length === 0) return out

  const { data: rows, error } = await supabase
    .from('studio_time_rows')
    .select('work_order_id, eng_name')
    .in('work_order_id', wos.map(w => w.id))
  if (!dbResult('Loading staffing', error)) return out

  const staffedWoIds = new Set(
    (rows ?? []).filter(r => (r.eng_name ?? '').trim() !== '').map(r => r.work_order_id),
  )
  for (const w of wos) {
    if (w.booking_id && staffedWoIds.has(w.id)) out.add(w.booking_id)
  }
  return out
}

export type BillingBrief = {
  balancesOutstanding: number
  balancesCount: number
  paymentsReceived: number
  /** Phase 1: typed by billing into the COD duty's captures. Null when untyped. */
  codOutstanding: number | null
  pastDue31: number | null
  periodLabel: string
}

/**
 * The manager's read-only peek at billing (RULING 2026-08-10).
 *
 * Eli oversees the billing period but "I don't want his world cluttered with
 * billing stuff" — so this is four numbers and no actions. It is NOT a summary
 * for the billing role: for them it isn't a summary, it's the job, and they
 * already have the queues.
 *
 * ⚠ `paymentsReceived` counts payments RECORDED IN PRSFLO. Anything zeroed
 * straight into QuickBooks never touches payment_rows and will not appear here.
 * Until the QBO integration lands (docs/AR-SCOPING.md) treat it as a floor, not
 * a total, and label it as such wherever it is displayed.
 */
export async function fetchBillingBrief(today = getLocalToday()): Promise<BillingBrief> {
  const monthStart = today.slice(0, 8) + '01'

  const balances = await fetchBalancesQueue()

  const { data: pays, error } = await supabase
    .from('payment_rows')
    .select('amount, recorded_at')
    .gte('recorded_at', monthStart)
  dbResult('Loading payments received', error)

  const paymentsReceived = (pays ?? []).reduce((s, p) => {
    const n = typeof p.amount === 'number' ? p.amount : stripCurrencyish(p.amount)
    return s + n
  }, 0)

  // COD figures are typed by billing on their card until QBO can compute them.
  const duties = await fetchDuties('billing')
  const entries = await fetchEntries(
    duties.map(d => d.id),
    shiftDate(today, -BACKLOG_LOOKBACK_DAYS),
    today,
  )

  const d = new Date(today + 'T12:00:00')
  return {
    balancesOutstanding: balances.reduce((s, b) => s + b.balance, 0),
    balancesCount: balances.length,
    paymentsReceived,
    codOutstanding: latestCapture(duties, entries, 'bil_cod_followup', 'cod_outstanding', today),
    pastDue31: latestCapture(duties, entries, 'bil_cod_followup', 'past_due_31', today),
    periodLabel: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  }
}

/** Money coercion for the one place that reads payment_rows directly. */
function stripCurrencyish(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = parseFloat(String(v).replace(/[$,]/g, ''))
  return isNaN(n) ? 0 : n
}

/**
 * Sessions that should have a work order and don't (§3).
 *
 * Uses the SAME gate as WO creation (bookingShouldHaveWorkOrder) rather than a
 * hand-written status filter, so this queue can never disagree with what the app
 * actually creates. Filtering happens client-side for exactly that reason —
 * the gate is a TS function, and duplicating its status list into a .in() here
 * is how the two would drift.
 */
export async function fetchNeedsWoQueue(opts?: {
  fromDate?: string
  toDate?: string
}): Promise<NeedsWoItem[]> {
  const today = getLocalToday()
  const from = opts?.fromDate ?? shiftDate(today, -30)
  const to = opts?.toDate ?? shiftDate(today, 14)

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, status, start_date, location, studio, client_name, label, artist, work_order_id')
    .gte('start_date', from)
    .lte('start_date', to)
    .order('start_date')
  if (!dbResult('Loading sessions needing work orders', error)) return []

  const candidates = (bookings ?? []).filter(b => bookingShouldHaveWorkOrder(b as any))
  if (candidates.length === 0) return []

  // bookings.work_order_id is the fast path, but it is written by the WO on save
  // and can lag a WO created by another route — so confirm against work_orders
  // rather than trusting the denormalised column alone.
  const { data: wos, error: woErr } = await supabase
    .from('work_orders')
    .select('booking_id')
    .in('booking_id', candidates.map(b => b.id))
  if (!dbResult('Checking existing work orders', woErr)) return []

  const haveWo = new Set((wos ?? []).map(w => w.booking_id))

  return candidates
    .filter(b => !haveWo.has(b.id))
    .map(b => ({
      bookingId: b.id,
      date: b.start_date,
      location: b.location ?? '',
      studio: b.studio ?? '',
      client: b.label || b.client_name || 'Unknown',
      artist: b.artist ?? null,
    }))
}

/**
 * Work orders where the money owed exceeds the money taken (§3).
 *
 * Totals come from lib/woTotals — the same function the WO screen displays — so
 * a balance here and a Balance Due there can never disagree.
 */
export async function fetchBalancesQueue(opts?: {
  fromDate?: string
  toDate?: string
}): Promise<BalanceItem[]> {
  const today = getLocalToday()
  const from = opts?.fromDate ?? shiftDate(today, -90)
  const to = opts?.toDate ?? today

  const { data: wos, error } = await supabase
    .from('work_orders')
    .select('id, booking_id, invoice_number, client, label, artist, session_date')
    .gte('session_date', from)
    .lte('session_date', to)
  if (!dbResult('Loading work orders for balances', error)) return []
  if (!wos || wos.length === 0) return []

  const ids = wos.map(w => w.id)

  // Three bulk reads rather than per-WO queries — this runs on dashboard load.
  const [st, rent, pay] = await Promise.all([
    supabase
      .from('studio_time_rows')
      .select('work_order_id, charge, ot_charge, from_time, to_time, eng_from_time, eng_to_time, eng_hours, eng_rate')
      .in('work_order_id', ids),
    supabase.from('rental_rows').select('work_order_id, charge').in('work_order_id', ids),
    supabase.from('payment_rows').select('work_order_id, amount').in('work_order_id', ids),
  ])
  if (!dbResult('Loading work-order line items', st.error || rent.error || pay.error)) return []

  const group = <T extends { work_order_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>()
    for (const r of rows ?? []) {
      const arr = m.get(r.work_order_id)
      if (arr) arr.push(r)
      else m.set(r.work_order_id, [r])
    }
    return m
  }
  const stBy = group(st.data as any[])
  const rentBy = group(rent.data as any[])
  const payBy = group(pay.data as any[])

  const out: BalanceItem[] = []
  for (const w of wos) {
    const totals = computeWoTotals({
      studioRows: stBy.get(w.id) ?? [],
      rentalRows: rentBy.get(w.id) ?? [],
      paymentRows: payBy.get(w.id) ?? [],
    })
    // A WO with no line items at all is unbilled, not outstanding — skip it, or
    // every freshly-created WO would land in the collections queue on day one.
    if (totals.grand <= 0) continue
    if (totals.balance <= 0) continue
    out.push({
      workOrderId: w.id,
      bookingId: w.booking_id ?? null,
      invoiceNumber: w.invoice_number ?? null,
      client: (w as any).label || w.client || 'Unknown',
      artist: w.artist ?? null,
      sessionDate: w.session_date ?? null,
      total: totals.grand,
      paid: totals.paid,
      balance: totals.balance,
    })
  }
  return out.sort((a, b) => b.balance - a.balance)
}

/** Bookings in a given status, with their step ticks attached. */
async function fetchBookingQueue(
  refType: QueueRefType,
  statuses: string[],
  window: { from: string; to: string },
): Promise<QueueBookingItem[]> {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, status, start_date, location, studio, client_name, label, artist')
    .in('status', statuses)
    .gte('start_date', window.from)
    .lte('start_date', window.to)
    .order('start_date')
  if (!dbResult('Loading My Day queue', error)) return []
  if (!bookings || bookings.length === 0) return []

  const ids = bookings.map(b => b.id)
  const [steps, staffed] = await Promise.all([
    fetchQueueSteps(refType, ids),
    fetchStaffedBookingIds(ids),
  ])

  return bookings.map(b => ({
    bookingId: b.id,
    date: b.start_date,
    location: b.location ?? '',
    studio: b.studio ?? '',
    client: b.label || b.client_name || 'Unknown',
    artist: b.artist ?? null,
    steps: steps.get(b.id) ?? {},
    staffed: staffed.has(b.id),
  }))
}

/** Tentative bookings — the holds queue. Steps: Email · Calendar · QB · Staff. */
export function fetchHoldsQueue(opts?: { fromDate?: string; toDate?: string }) {
  const today = getLocalToday()
  return fetchBookingQueue('hold', ['tentative'], {
    from: opts?.fromDate ?? today,
    to: opts?.toDate ?? shiftDate(today, 60),
  })
}

/** Recently confirmed bookings — the booked pipeline. Steps: Calendar · QB · WO. */
export function fetchBookedQueue(opts?: { fromDate?: string; toDate?: string }) {
  const today = getLocalToday()
  return fetchBookingQueue('booked', ['confirmed'], {
    from: opts?.fromDate ?? shiftDate(today, -7),
    to: opts?.toDate ?? shiftDate(today, 30),
  })
}

/** Open-hours blocks. Steps: Log · Calendar. */
export function fetchOpenHoursQueue(opts?: { fromDate?: string; toDate?: string }) {
  const today = getLocalToday()
  return fetchBookingQueue('open_hours', ['open_hours'], {
    from: opts?.fromDate ?? shiftDate(today, -7),
    to: opts?.toDate ?? shiftDate(today, 30),
  })
}

// ─── Queue steps ─────────────────────────────────────────────────────────────

/** Ticked steps per booking id: Map<bookingId, { Email: true, ... }>. */
export async function fetchQueueSteps(
  refType: QueueRefType,
  refIds: string[],
): Promise<Map<string, Record<string, boolean>>> {
  const out = new Map<string, Record<string, boolean>>()
  if (refIds.length === 0) return out

  const { data, error } = await supabase
    .from('myday_queue_steps')
    .select('ref_id, step, checked_at')
    .eq('ref_type', refType)
    .in('ref_id', refIds)
  if (!dbResult('Loading queue steps', error)) return out

  for (const r of data ?? []) {
    const rec = out.get(r.ref_id) ?? {}
    rec[r.step] = !!r.checked_at
    out.set(r.ref_id, rec)
  }
  return out
}

/** Tick or untick one step on one queue row. */
export async function setQueueStep(opts: {
  refType: QueueRefType
  refId: string
  step: string
  checked: boolean
  checkedBy: string | null
}): Promise<boolean> {
  const { refType, refId, step, checked, checkedBy } = opts
  const { error } = await supabase.from('myday_queue_steps').upsert(
    {
      ref_type: refType,
      ref_id: refId,
      step,
      checked_at: checked ? new Date().toISOString() : null,
      checked_by: checked ? checkedBy : null,
    },
    { onConflict: 'ref_type,ref_id,step' },
  )
  return dbResult('Saving queue step', error)
}

// ─── Shift notes (one POST per shift, 2026-08-24 v2) ─────────────────────────
//
// A post is one SUBMISSION: session notes + studio notes together, signed once
// — like one "manager notes" email. Explicit submit, no debounced autosave:
// two managers (opener + closer) work the same day, and the old shared-box
// upsert meant the last debounce silently overwrote the other person's text.
// An appended post has no clobber window at all. `role` is the card the post
// was made from. `shift` (opening/closing) is UNWRITTEN as of the same day's
// third ruling — "the time submitted really dictates what it is"; old posts
// may still carry a value, which the UI no longer renders.

export type NoteShift = 'opening' | 'closing'

export type MyDayNotePost = {
  id: string
  role: MyDayRole
  date: string
  shift: NoteShift | null
  session_notes: string
  studio_notes: string
  created_by: string | null
  created_at: string
  /** Embedded author row (PostgREST join on the created_by FK). */
  author: { display_name: string | null; initials: string | null } | null
}

const NOTE_POST_SELECT =
  'id, role, date, shift, session_notes, studio_notes, created_by, created_at, author:user_profiles(display_name, initials)'

/** All posts for one date, BOTH roles — the day everybody references. */
export async function fetchNotePosts(date: string): Promise<MyDayNotePost[]> {
  const { data, error } = await supabase
    .from('myday_note_posts')
    .select(NOTE_POST_SELECT)
    .eq('date', date)
    .order('created_at', { ascending: true })
  if (!dbResult('Loading shift notes', error)) return []
  return (data ?? []) as unknown as MyDayNotePost[]
}

/**
 * The log: every post through `through` (INCLUSIVE — today's submitted posts
 * live here and nowhere else, ruling 2026-08-24: a second copy above the
 * composer read as duplication), newest day first, posts within a day in
 * submit order. Caller groups by date. `days` bounds the window.
 */
export async function fetchNoteLog(through: string, days = 30): Promise<MyDayNotePost[]> {
  const from = shiftDate(through, -days)
  const { data, error } = await supabase
    .from('myday_note_posts')
    .select(NOTE_POST_SELECT)
    .lte('date', through)
    .gte('date', from)
    .order('date', { ascending: false })
    .order('created_at', { ascending: true })
  if (!dbResult('Loading notes log', error)) return []
  return (data ?? []) as unknown as MyDayNotePost[]
}

/** Both boxes empty = nothing to post (returns false, no write).
    No opener/closer tag (Eli 2026-08-24, third ruling of the day: "the time
    submitted really dictates what it is") — the `shift` column survives in
    the table, unwritten, like `always_available` before it. */
export async function addNotePost(args: {
  role: MyDayRole
  date: string
  sessionNotes: string
  studioNotes: string
  createdBy: string
}): Promise<boolean> {
  const session = args.sessionNotes.trim()
  const studio = args.studioNotes.trim()
  if (!session && !studio) return false
  const { error } = await supabase.from('myday_note_posts').insert({
    role: args.role,
    date: args.date,
    session_notes: session,
    studio_notes: studio,
    created_by: args.createdBy,
  })
  return dbResult('Saving shift notes', error)
}

/**
 * Author-only edit (RLS enforces created_by = caller): a submitted post stays
 * the author's to reopen and finish — "always make the notes editable by the
 * person who submitted them" (Eli, 2026-08-24). Submitting is signing, not
 * sealing — same ruling as the runner WO's "submitted is a signal, not a seal".
 */
export async function updateNotePost(args: {
  id: string
  sessionNotes: string
  studioNotes: string
}): Promise<boolean> {
  const session = args.sessionNotes.trim()
  const studio = args.studioNotes.trim()
  if (!session && !studio) return false
  const { error } = await supabase.from('myday_note_posts').update({
    session_notes: session,
    studio_notes: studio,
  }).eq('id', args.id)
  return dbResult('Updating shift notes', error)
}

/** RLS scopes this to the author's own posts (owner may delete any). */
export async function deleteNotePost(id: string): Promise<boolean> {
  const { error } = await supabase.from('myday_note_posts').delete().eq('id', id)
  return dbResult('Deleting shift notes', error)
}

// ─── 14-day staff grid (§6.2) ────────────────────────────────────────────────

/** One row of the grid. `days` is oldest→newest, 'g' | 'r' | 'n'. */
export type GridRow = { role: MyDayRole; who: string; days: string; backlog?: string }

/**
 * Per-role completion history for the grid.
 *
 * 'g' all due duties done · 'r' one or more missed · 'n' nothing was due.
 *
 * TODAY is never 'r'. A day in progress is not a failure, and marking it red at
 * 9am would make the grid cry wolf every morning; it turns 'g' when the card is
 * cleared and stays 'n' until then.
 */
export async function fetchStaffGrid(days = 14): Promise<GridRow[]> {
  const today = getLocalToday()
  const window = recentDates(today, days)
  const from = window[0]

  const duties = await fetchDuties()
  if (duties.length === 0) return []
  const entries = await fetchEntries(duties.map(d => d.id), from, today)

  // Display names for the two role cards. Falls back to the role label when a
  // seat is vacant — billing is a ROLE (Aaron is leaving; the card outlives him).
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('display_name, role')
    .in('role', ['manager', 'billing'])
    .is('deleted_at', null)
  dbResult('Loading staff names', error)

  const nameFor = (role: MyDayRole) =>
    (profiles ?? []).find(p => p.role === role)?.display_name ||
    (role === 'manager' ? 'Manager' : 'Billing')

  const roles: MyDayRole[] = ['manager', 'billing']
  return roles.map(role => {
    const mine = duties.filter(d => d.role === role)
    const days = window
      .map(date => {
        // dutyExistedOn: the grid looks 14 days back, so without it the two
        // weeks before My Day launched would render as solid red.
        const due = mine.filter(d => dutyExistedOn(d, date) && isDutyDueOn(d, date))
        if (due.length === 0) return 'n'
        const allDone = due.every(d =>
          entries.some(e => e.duty_id === d.id && e.date === date && e.completed_at),
        )
        if (allDone) return 'g'
        return date === today ? 'n' : 'r'
      })
      .join('')

    const worst = Math.max(
      0,
      ...mine.map(d => computeBacklog(d, entries, today).days),
    )
    return {
      role,
      who: nameFor(role),
      days,
      backlog: worst >= BACKLOG_FLAG_THRESHOLD ? `${worst}d` : undefined,
    }
  })
}

// ─── Briefing composer (§5) ──────────────────────────────────────────────────

export type FloBullet = { color: string; alert?: boolean; text: string }
export type Briefing = { bullets: FloBullet[]; synopsis: string }

export type BriefingInput = {
  /** Whose briefing: an owner sees across both roles, a manager sees their own. */
  viewer: MyDayRole | 'owner'
  duties: MyDayDuty[]
  entries: MyDayEntry[]
  needsWo: NeedsWoItem[]
  balances: BalanceItem[]
  today: string
  /** display_name per role, for "Fernando cleared…" rather than "Manager cleared…". */
  names?: Partial<Record<MyDayRole, string>>
}

const money0 = (n: number) =>
  `$${Math.round(n).toLocaleString('en-US')}`

/**
 * Compose the Flo briefing from real numbers. Template sentences, NO AI — the
 * §2.8 askClaude version is a later phase; this must be right and cheap first.
 *
 * Order is fixed (§5): RED (something slipped) → AMBER (pressure building) →
 * GREEN (what went well). Leading with the good news is how a briefing becomes
 * something people skim past.
 */
export function composeBriefing(input: BriefingInput): Briefing {
  const { viewer, duties, entries, needsWo, balances, today, names } = input
  const yesterday = shiftDate(today, -1)

  const roles: MyDayRole[] =
    viewer === 'owner' ? ['manager', 'billing'] : [viewer]
  const nameFor = (r: MyDayRole) =>
    names?.[r] || (r === 'manager' ? 'The manager' : 'Billing')

  const bullets: FloBullet[] = []
  const redTexts: string[] = []
  // Duty ids already shouted about in the RED tier. Tracked by ID, not by
  // matching label text — red lines run their labels through lowerFirst, so a
  // substring check against the original label silently never matched and the
  // lookahead repeated everything the alert had just said.
  const redDutyIds = new Set<string>()

  // ── RED — backlogs at/over the flag threshold, then yesterday's misses ──
  for (const role of roles) {
    const mine = duties.filter(d => d.role === role)

    const flagged = mine
      .map(d => ({ duty: d, bl: computeBacklog(d, entries, today) }))
      .filter(x => x.bl.days >= BACKLOG_FLAG_THRESHOLD)
      .sort((a, b) => b.bl.days - a.bl.days)

    for (const f of flagged) {
      const t = `${nameFor(role)} missed ${lowerFirst(f.duty.label)} — covering ${f.bl.days + 1} days`
      redTexts.push(t)
      redDutyIds.add(f.duty.id)
      bullets.push({ color: C_HOT, alert: true, text: t })
    }

    // Sticky duties that blew their date — loudest thing on the board. These
    // recur monthly, so "missed" means nothing happens for another four weeks
    // unless someone acts. Listed before backlogs for that reason.
    for (const d of mine) {
      const since = computeOverdueSince(d, entries, today)
      if (!since) continue
      const days = overdueDays(since, today)
      const t = `${nameFor(role)}: ${d.label} was due ${shortDayLabel(since)} — ${days} day${days === 1 ? '' : 's'} late, needs doing ASAP`
      redTexts.push(t)
      redDutyIds.add(d.id)
      bullets.push({ color: C_HOT, alert: true, text: t })
    }

    // Missed yesterday, but not yet a backlog — still red, less loud.
    const flaggedIds = new Set(flagged.map(f => f.duty.id))
    const missed = mine.filter(
      d =>
        !flaggedIds.has(d.id) &&
        dutyExistedOn(d, yesterday) &&
        isDutyDueOn(d, yesterday) &&
        !entries.some(e => e.duty_id === d.id && e.date === yesterday && e.completed_at),
    )
    for (const m of missed) redDutyIds.add(m.id)
    if (missed.length === 1) {
      const t = `${nameFor(role)} missed ${lowerFirst(missed[0].label)} yesterday`
      redTexts.push(t)
      bullets.push({ color: C_HOT, alert: true, text: t })
    } else if (missed.length > 1) {
      const t = `${nameFor(role)} missed ${missed.length} duties yesterday`
      redTexts.push(t)
      bullets.push({ color: C_HOT, alert: true, text: t })
    }
  }

  // ── AMBER — queue pressure ──
  if (needsWo.length > 0) {
    bullets.push({
      color: C_WARM,
      text: `${needsWo.length} session${needsWo.length === 1 ? '' : 's'} missing work orders`,
    })
  }
  if (balances.length > 0) {
    const sum = balances.reduce((s, b) => s + b.balance, 0)
    bullets.push({
      color: C_WARM,
      text: `${balances.length} balance${balances.length === 1 ? '' : 's'} outstanding · ${money0(sum)}`,
    })
  }
  // COD outstanding, as typed into yesterday's capture (Phase 1 — HR-SPEC §4).
  const cod = latestCapture(duties, entries, 'bil_cod_followup', 'cod_outstanding', today)
  if (cod != null && cod > 0) {
    const pastDue = latestCapture(duties, entries, 'bil_cod_followup', 'past_due_31', today)
    const tail = pastDue != null && pastDue > 0
      ? ` · ${pastDue} over 31 days`
      : ' · nothing over 31 days'
    bullets.push({ color: C_WARM, text: `COD outstanding: ${cod} account${cod === 1 ? '' : 's'}${tail}` })
  }

  // ── GREEN — cleared yesterday ──
  for (const role of roles) {
    const mine = duties.filter(d => d.role === role)
    const due = mine.filter(d => dutyExistedOn(d, yesterday) && isDutyDueOn(d, yesterday))
    if (due.length === 0) continue
    const allDone = due.every(d =>
      entries.some(e => e.duty_id === d.id && e.date === yesterday && e.completed_at),
    )
    if (allDone) {
      bullets.push({
        color: C_BOOKED,
        text:
          due.length === 1
            ? `${nameFor(role)} cleared their one duty yesterday`
            : `${nameFor(role)} cleared all ${due.length} duties yesterday`,
      })
    }
  }

  // ── LOOKAHEAD — "tomorrow" heads-up (RULING 2026-08-10) ──
  //
  // Day-dependent duties (valley checks Tue/Fri, office stock Wed, tenant rent
  // on the 25th) appear on the card ONLY on their own day, so Friday's work
  // never clutters Monday's list. The cost of that is no warning — you meet the
  // duty the morning it's due. This tier buys the warning back for one line in
  // the briefing, which is the one place a "not today" item can sit without
  // being mistaken for today's work.
  //
  // Daily duties are deliberately excluded: "tomorrow: ADP timecards" every
  // single morning is precisely the noise this ruling exists to prevent.
  const tomorrow = shiftDate(today, 1)
  const lookahead: string[] = []
  for (const role of roles) {
    for (const d of duties.filter(x => x.role === role)) {
      if (d.cadence === 'daily') continue
      if (!isDutyDueOn(d, tomorrow)) continue
      // Already shouting about it as a backlog — don't also whisper about it.
      if (redDutyIds.has(d.id)) continue
      lookahead.push(roles.length > 1 ? `${d.label} (${nameFor(role)})` : d.label)
    }
  }
  if (lookahead.length > 0) {
    bullets.push({ color: C_NEUTRAL, text: `Tomorrow: ${lookahead.join(' · ')}` })
  }

  // ── Synopsis — one line, template-based ──
  let synopsis: string
  // Counted, not `bullets.length === 0`: a green "cleared everything" line or a
  // lookahead heads-up must still read as All clear. Only genuine pressure
  // (the amber tier) downgrades it.
  const amberCount = bullets.filter(b => b.color === C_WARM).length
  if (redTexts.length === 0 && amberCount === 0) {
    synopsis = 'All clear.'
  } else if (redTexts.length === 0) {
    synopsis = 'Nothing slipped — a few things are building, none urgent.'
  } else if (redTexts.length === 1) {
    // NOT lowerFirst'd — a red line starts with a person's name, and lowercasing
    // it produced "one thing needs you: fernando missed…".
    synopsis = `Quiet day — one thing needs you: ${redTexts[0]}.`
  } else {
    synopsis = `${redTexts.length} things need you today — start with the longest backlog.`
  }

  return { bullets, synopsis }
}

/** Most recent value of one capture field, looking back over the window. */
function latestCapture(
  duties: MyDayDuty[],
  entries: MyDayEntry[],
  dutyKey: string,
  field: string,
  asOf: string,
): number | null {
  const duty = duties.find(d => d.duty_key === dutyKey)
  if (!duty) return null
  const rows = entries
    .filter(e => e.duty_id === duty.id && e.completed_at && e.date <= asOf)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  for (const r of rows) {
    const v = r.captured?.[field]
    if (typeof v === 'number') return v
  }
  return null
}

/** "Review timecards" → "review timecards", for mid-sentence use. */
function lowerFirst(s: string): string {
  if (!s) return s
  // Leave acronyms alone: "ADP runner timecards" must not become "aDP …".
  if (s.length > 1 && s[0] === s[0].toUpperCase() && s[1] === s[1].toUpperCase()) return s
  return s[0].toLowerCase() + s.slice(1)
}

// ─── One-shot dashboard loader ───────────────────────────────────────────────

export type MyDayDashboard = {
  views: DutyView[]
  progress: string
  briefing: Briefing
  needsWo: NeedsWoItem[]
  balances: BalanceItem[]
  entries: MyDayEntry[]
  duties: MyDayDuty[]
}

/**
 * Everything the dashboard card + Flo box need, in one call.
 *
 * `role` is the card being shown (an owner using the view-as toggle passes the
 * role they're viewing); `viewer` decides the briefing's scope.
 */
export async function loadMyDayDashboard(opts: {
  role: MyDayRole
  viewer: MyDayRole | 'owner'
  date?: string
  names?: Partial<Record<MyDayRole, string>>
}): Promise<MyDayDashboard> {
  const date = opts.date ?? getLocalToday()

  // All duties, not just this role's — the owner's briefing spans both cards.
  const duties = await fetchDuties()
  const entries = await fetchEntries(
    duties.map(d => d.id),
    shiftDate(date, -BACKLOG_LOOKBACK_DAYS),
    date,
  )
  const [needsWo, balances] = await Promise.all([
    fetchNeedsWoQueue(),
    fetchBalancesQueue(),
  ])

  const roleDuties = duties.filter(d => d.role === opts.role)
  const views = buildDutyViews(roleDuties, entries, date)

  return {
    views,
    progress: progressLabel(views),
    briefing: composeBriefing({
      viewer: opts.viewer,
      duties,
      entries,
      needsWo,
      balances,
      today: date,
      names: opts.names,
    }),
    needsWo,
    balances,
    entries,
    duties,
  }
}
