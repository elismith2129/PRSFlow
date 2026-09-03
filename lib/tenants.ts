// ─────────────────────────────────────────────────────────────────────────────
// lib/tenants — the Tenants rent board + the Mustard shared-runner sheet
// (Eli, 2026-09-02; mocks docs/design-refs/tenants-tab-options.html option A
// and mustard-shared-runner-options.html option A, hours only).
//
// THE ROSTER IS CODE, NOT DATA (the nadines precedent). Rooms, tenants and
// rents are the terms of real-world deals — a transcription, so a change to a
// deal is a commit, not a form submission. Most tenant rooms are not calendar
// rooms at all (PRS D/F/Treehouse, ARS C, TRK PR1–3 are not in
// STUDIO_LOCATIONS), so nothing here touches bookings for the roster.
//
// STORED vs DERIVED (the billing doctrine, lib/billing.ts header):
//   · STORED — the two human acts per tenant per month: the rent email went
//     out (sent_at, the 25th send) and the money arrived (paid_at). They live
//     in tenant_rent_months (migration 20260902120000).
//   · DERIVED — everything else: open, overdue (unpaid past the 5th),
//     collected, occupancy, and the whole shared-runner sheet. Computed on
//     every read; nothing to sync, nothing to drift.
//
// THE MUSTARD SHEET: Mustard (ERS·B lockout) is billed runner hours as
// incidentals, but one runner covers the whole building — any hour where a
// BILLED ERS·A session was also running is shared, so it bills at HALF.
//   · Mustard's runner hours = studio_time_rows on his lockout WO (typed
//     daily on the existing WO screen — no new entry surface).
//   · ERS·A occupied = studio_time_rows (studio 'A') on Encore work orders
//     that pass bookingShouldHaveWorkOrder — the SAME gate the billing
//     pipeline uses, so "anything that's billed" can never drift into a
//     second status list.
//   · Output is HOURS ONLY (Eli: "we don't need money just the hours") —
//     solo + shared → billable (solo + shared ÷ 2). Billing prices it in
//     QuickBooks; PRSFlo owns the workflow, QuickBooks owns the money.
//
// Day-keyed on purpose: rows compare within their own date, matching the
// spreadsheet this replaces. An ERS·A session dated yesterday running past
// midnight into today does not halve today's rows (assumptions per Eli:
// hours entered correctly, ERSA sessions never overlap each other, one
// runner for the building).
//
// Aging/urgency: rent unpaid on the 6th of its month goes hot. Rent months
// are calendar months — the 8:50 operational day is a runner-surface rule
// and does not apply to rent.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { timeToMins, getLocalToday, toStudioLetter } from '@/lib/time'
import { bookingShouldHaveWorkOrder } from '@/lib/createWorkOrder'

// ─── The roster (deal terms — change by commit) ──────────────────────────────

export type TenantRoom = {
  /** Stable key — tenant_rent_months.room_id. NEVER rename once stamps exist. */
  id: string
  venue: 'Paramount' | 'Ameraycan' | 'Encore' | 'Track'
  room: string
  /** null = the room takes tenants but sits empty right now. */
  tenant: string | null
  /** Monthly rent in dollars. */
  rent: number
  /** Mustard only — the shared-runner incidentals invoice (2nd–3rd). */
  incidentals?: boolean
}

/** Roster as of 2026-09-02 (Eli). Empty rooms stay listed — an empty room is
 *  a fact about the building, not a missing row. */
export const TENANT_ROOMS: TenantRoom[] = [
  { id: 'prs-d',         venue: 'Paramount', room: 'Studio D',  tenant: null,           rent: 0 },
  { id: 'prs-f',         venue: 'Paramount', room: 'Studio F',  tenant: 'Spencer Nezy', rent: 2500 },
  { id: 'prs-treehouse', venue: 'Paramount', room: 'Treehouse', tenant: 'Dada',         rent: 5500 },
  { id: 'ars-c',         venue: 'Ameraycan', room: 'Studio C',  tenant: 'Oren Yoel',    rent: 3250 },
  { id: 'trk-pr1',       venue: 'Track',     room: 'PR1',       tenant: null,           rent: 0 },
  { id: 'trk-pr2',       venue: 'Track',     room: 'PR2',       tenant: 'Bobby Raps',   rent: 2100 },
  { id: 'trk-pr3',       venue: 'Track',     room: 'PR3',       tenant: 'Sean Dorian',  rent: 1622.25 },
  { id: 'trk-north',     venue: 'Track',     room: 'North',     tenant: 'Camper',       rent: 19500 },
  { id: 'ers-b',         venue: 'Encore',    room: 'Studio B',  tenant: 'Mustard',      rent: 19500, incidentals: true },
]

/** The one shared-runner deal. Becomes an array the day a second tenant
 *  shares runners — not speculatively before. */
export const SHARED_RUNNER = {
  roomId: 'ers-b',
  venue: 'Encore',
  /** The tenant's own room (bookings.studio format — full label). */
  tenantStudio: 'Studio B',
  /** studio_time_rows letters whose billed sessions share the runner. */
  sharedLetters: ['A'],
  splitLabel: '½ vs ERS·A',
}

// ─── Month helpers ───────────────────────────────────────────────────────────

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/** Current calendar month, 'YYYY-MM'. */
export function currentMonth(): string {
  return getLocalToday().slice(0, 7)
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`
}

// ─── Rent stamps (the stored human acts) ─────────────────────────────────────

export type RentKind = 'rent' | 'incidentals'

export type RentStamp = {
  roomId: string
  month: string
  kind: RentKind
  sentAt: string | null
  paidAt: string | null
}

export function stampKey(roomId: string, month: string, kind: RentKind): string {
  return `${roomId}|${month}|${kind}`
}

/** All stamps for the given months, keyed by stampKey. */
export async function fetchRentStamps(months: string[]): Promise<Map<string, RentStamp>> {
  const out = new Map<string, RentStamp>()
  if (months.length === 0) return out
  const { data, error } = await supabase
    .from('tenant_rent_months')
    .select('room_id, month, kind, sent_at, paid_at')
    .in('month', months)
  if (!dbResult('Loading rent months', error)) return out
  for (const r of data ?? []) {
    out.set(stampKey(r.room_id, r.month, r.kind as RentKind), {
      roomId: r.room_id, month: r.month, kind: r.kind as RentKind,
      sentAt: r.sent_at ?? null, paidAt: r.paid_at ?? null,
    })
  }
  return out
}

/** Upsert one month-row's stamp fields. Requires UNIQUE (room_id, month, kind). */
async function writeStamp(
  roomId: string, month: string, kind: RentKind,
  patch: Record<string, string | null>, label: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('tenant_rent_months')
    .upsert({ room_id: roomId, month, kind, ...patch }, { onConflict: 'room_id,month,kind' })
  return dbResult(label, error)
}

/** The 25th email went out (or, for incidentals, the 2nd–3rd invoice). */
export function markRentSent(roomId: string, month: string, kind: RentKind, byId: string | null): Promise<boolean> {
  return writeStamp(roomId, month, kind,
    { sent_at: new Date().toISOString(), sent_by: byId }, 'Marking rent sent')
}

/** The money arrived. Stamps the date the board answers "paid and when" with. */
export function markRentPaid(roomId: string, month: string, kind: RentKind, byId: string | null): Promise<boolean> {
  return writeStamp(roomId, month, kind,
    { paid_at: new Date().toISOString(), paid_by: byId }, 'Marking rent paid')
}

/** Undo a misclick. Clears the stamp — the row itself stays (it's a record). */
export function undoRentSent(roomId: string, month: string, kind: RentKind): Promise<boolean> {
  return writeStamp(roomId, month, kind, { sent_at: null, sent_by: null }, 'Undoing rent sent')
}

export function undoRentPaid(roomId: string, month: string, kind: RentKind): Promise<boolean> {
  return writeStamp(roomId, month, kind, { paid_at: null, paid_by: null }, 'Undoing rent paid')
}

/** Unpaid past the 5th of its month. String compare works on ISO dates. */
export function isRentLate(stamp: RentStamp | undefined, month: string): boolean {
  if (stamp?.paidAt) return false
  return getLocalToday() >= `${month}-06`
}

// ─── The shared-runner sheet (all derived) ───────────────────────────────────

export type SharedWindow = {
  from: string
  to: string
  hours: number
  /** Session windows only — "Label — Artist" from the work order. */
  label?: string
}

export type SharedRunnerDay = {
  date: string  // ISO
  /** Mustard's typed runner windows that day. */
  runner: SharedWindow[]
  /** Billed ERS·A session windows that day. */
  sessions: SharedWindow[]
  solo: number
  shared: number
  /** ERSA ran but no runner hours typed on the tenant WO — a visible gap,
   *  never a silent zero. */
  missing: boolean
}

export type SharedRunnerMonth = {
  month: string
  days: SharedRunnerDay[]
  runnerHours: number
  solo: number
  shared: number
  /** solo + shared ÷ 2 — the figure billing prices in QuickBooks. */
  billable: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** [start, end) in minutes; overnight wraps past midnight. Null = unparseable. */
function interval(from: string | null, to: string | null): [number, number] | null {
  const f = timeToMins(from)
  let t = timeToMins(to)
  if (isNaN(f) || isNaN(t)) return null
  if (t <= f) t += 24 * 60
  return [f, t]
}

/** Merge overlapping intervals (ERSA "never overlaps" per Eli — merged anyway,
 *  so a double-booked day can never double-halve an hour). */
function merge(list: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...list].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1])
    else out.push([iv[0], iv[1]])
  }
  return out
}

function overlapMins(a: [number, number], b: [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(b[0], a[0]))
}

/**
 * One month of the Mustard sheet. Two booking-side queries, one rows query —
 * bulk, like fetchInvoices, because the whole month renders at once.
 */
export async function fetchSharedRunnerMonth(month: string): Promise<SharedRunnerMonth> {
  const empty: SharedRunnerMonth = { month, days: [], runnerHours: 0, solo: 0, shared: 0, billable: 0 }

  // Every booking at the venue, split client-side: the tenant's lockout(s)
  // vs billed sessions. The WO link is resolved through work_orders.booking_id
  // (the load-bearing direction) so pre-Step-9 rows resolve too.
  const { data: bks, error: bkErr } = await supabase
    .from('bookings')
    .select('id, status, studio, work_order_id')
    .eq('location', SHARED_RUNNER.venue)
  if (!dbResult('Loading shared-runner bookings', bkErr)) return empty

  const tenantBk = (bks ?? []).filter(b =>
    b.status === 'lockout' && b.studio === SHARED_RUNNER.tenantStudio)
  const billedBk = (bks ?? []).filter(b =>
    b.status !== 'lockout' && bookingShouldHaveWorkOrder({ status: b.status }))
  if (tenantBk.length === 0) return empty

  const bkIds = [...tenantBk, ...billedBk].map(b => b.id)
  const { data: wos, error: woErr } = await supabase
    .from('work_orders')
    .select('id, booking_id, client, label, artist')
    .in('booking_id', bkIds)
  if (!dbResult('Loading shared-runner work orders', woErr)) return empty

  const tenantBkIds = new Set(tenantBk.map(b => b.id))
  const tenantWoIds = new Set<string>()
  const sessionWoLabel = new Map<string, string>()
  for (const w of wos ?? []) {
    if (w.booking_id && tenantBkIds.has(w.booking_id)) tenantWoIds.add(w.id)
    else {
      const who = (w.label || w.client || '').trim()
      sessionWoLabel.set(w.id, w.artist ? (who ? `${who} — ${w.artist}` : w.artist) : who)
    }
  }
  // Belt and braces: bookings.work_order_id, the newer link direction.
  for (const b of tenantBk) if (b.work_order_id) tenantWoIds.add(b.work_order_id)
  if (tenantWoIds.size === 0) return empty

  const allWoIds = [...tenantWoIds, ...sessionWoLabel.keys()]
  const { data: rows, error: stErr } = await supabase
    .from('studio_time_rows')
    .select('work_order_id, studio, date, from_time, to_time')
    .in('work_order_id', allWoIds)
    .gte('date', `${month}-01`)
    .lte('date', `${month}-31`)
  if (!dbResult('Loading shared-runner hours', stErr)) return empty

  // Bucket by date.
  const byDate = new Map<string, { runner: SharedWindow[]; sessions: SharedWindow[]; sess: Array<[number, number]> }>()
  const dayOf = (d: string) => {
    let e = byDate.get(d)
    if (!e) { e = { runner: [], sessions: [], sess: [] }; byDate.set(d, e) }
    return e
  }
  for (const r of rows ?? []) {
    if (!r.date) continue
    const iv = interval(r.from_time, r.to_time)
    if (!iv) continue
    const hours = r2((iv[1] - iv[0]) / 60)
    if (tenantWoIds.has(r.work_order_id)) {
      dayOf(r.date).runner.push({ from: r.from_time!, to: r.to_time!, hours })
    } else if (SHARED_RUNNER.sharedLetters.includes(toStudioLetter(r.studio ?? ''))) {
      const e = dayOf(r.date)
      e.sessions.push({ from: r.from_time!, to: r.to_time!, hours, label: sessionWoLabel.get(r.work_order_id) || undefined })
      e.sess.push(iv)
    }
  }

  const days: SharedRunnerDay[] = [...byDate.entries()]
    .filter(([, e]) => e.runner.length > 0 || e.sessions.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => {
      const merged = merge(e.sess)
      let total = 0
      let shared = 0
      for (const w of e.runner) {
        const iv = interval(w.from, w.to)!
        total += iv[1] - iv[0]
        for (const s of merged) shared += overlapMins(iv, s)
      }
      return {
        date,
        runner: e.runner,
        sessions: e.sessions,
        solo: r2((total - shared) / 60),
        shared: r2(shared / 60),
        missing: e.runner.length === 0 && e.sessions.length > 0,
      }
    })

  const solo = r2(days.reduce((s, d) => s + d.solo, 0))
  const shared = r2(days.reduce((s, d) => s + d.shared, 0))
  return {
    month,
    days,
    runnerHours: r2(solo + shared),
    solo,
    shared,
    billable: r2(solo + shared / 2),
  }
}
