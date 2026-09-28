// ─────────────────────────────────────────────────────────────────────────────
// lib/tenants — leases, rent periods, the rent board + the Mustard sheet.
//
// LEASES ARE DATA (Eli, 2026-09-28) — reverses the 2026-09-02 "roster is
// code" ruling. What forced it: MBA's cycle is anchored on the 16th ("not
// prorated, a full month, due the middle of the month"), and a code roster
// cannot carry a cycle, a start date, or a tenant leaving. A lease is a
// recurring charge: tenant, room, amount, anchor day, start, end. The office
// edits them on the Tenants tab (owner/manager; RLS says the same).
//
// PERIODS run anchor to anchor and are keyed by the 'YYYY-MM' they START in:
//   anchor 1  → Sep 1 – Sep 30   key 2026-09   email the 25th · late from the 6th
//   anchor 16 → Sep 16 – Oct 15  key 2026-09   email the 10th · late from the 21st
// Same rules, shifted. Nothing is prorated — a period is always one full
// month's rent.
//
// STORED vs DERIVED (the billing doctrine, lib/billing.ts header):
//   · STORED — tenant_rent_months: the three human acts (sent_at, paid_at,
//     qb_at), plus `amount` FROZEN when the row is first written (a rent
//     change never re-prices an old month) and `paid_amount` (a short
//     payment is Partial, never a lie).
//   · DERIVED — open, partial, late, collected, and the whole shared-runner
//     sheet. Computed on every read; nothing to sync, nothing to drift.
//
// has_work_order — the ONE flag that separates Mustard from the rest. True:
// a normal WO exists (runners fill day cards, office approves daily, $0
// rate / 12 hrs incl. / OT priced on the WO) and the board carries his
// incidentals line + the shared-runner sheet. False: no WO, no day cards,
// nothing in Billing. The room is just blocked on the calendar.
//
// THE MUSTARD SHEET: billed runner hours as incidentals, HALF for any hour a
// BILLED ERS·A session was also running (one runner covers the building).
//   · Runner hours = studio_time_rows on his lockout WO.
//   · ERS·A occupied = studio_time_rows (studio 'A') on Encore work orders
//     that pass bookingShouldHaveWorkOrder — the SAME gate the pipeline uses.
//   · Output is HOURS ONLY (Eli: "we don't need money just the hours").
// Day-keyed on purpose (assumptions per Eli: hours entered correctly, ERSA
// sessions never overlap each other, one runner for the building).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { timeToMins, getLocalToday, toStudioLetter } from '@/lib/time'
import { bookingShouldHaveWorkOrder } from '@/lib/createWorkOrder'

// ─── Leases ──────────────────────────────────────────────────────────────────

export type Venue = 'Paramount' | 'Ameraycan' | 'Encore' | 'Track'
export const VENUES: Venue[] = ['Paramount', 'Ameraycan', 'Track', 'Encore']

export type Lease = {
  id: string
  tenant: string
  venue: Venue
  /** 'Studio B', 'South + PR1' — a label, not a calendar key. */
  roomLabel: string
  /** Monthly rent in dollars. */
  amount: number
  /** Day the period starts (1–28). 1 for everyone but MBA (16). */
  anchorDay: number
  startDate: string        // ISO date
  endDate: string | null   // null = ongoing
  /** Mustard only — a real WO exists; the board shows incidentals + sheet. */
  hasWorkOrder: boolean
  notes: string | null
  sortOrder: number
}

type LeaseRow = {
  id: string; tenant: string; venue: Venue; room_label: string; amount: number | string
  anchor_day: number; start_date: string; end_date: string | null
  has_work_order: boolean; notes: string | null; sort_order: number
}

function toLease(r: LeaseRow): Lease {
  return {
    id: r.id, tenant: r.tenant, venue: r.venue, roomLabel: r.room_label,
    amount: Number(r.amount) || 0, anchorDay: r.anchor_day, startDate: r.start_date,
    endDate: r.end_date, hasWorkOrder: r.has_work_order, notes: r.notes, sortOrder: r.sort_order,
  }
}

/** Every lease, current and past, in board order. */
export async function fetchLeases(): Promise<Lease[]> {
  const { data, error } = await supabase
    .from('leases')
    .select('id, tenant, venue, room_label, amount, anchor_day, start_date, end_date, has_work_order, notes, sort_order')
    .order('sort_order').order('tenant')
  if (!dbResult('Loading leases', error)) return []
  return (data ?? []).map(r => toLease(r as LeaseRow))
}

export type LeaseInput = {
  tenant: string; venue: Venue; roomLabel: string; amount: number; anchorDay: number
  startDate: string; endDate: string | null; hasWorkOrder: boolean; notes: string | null
}

function toRow(v: LeaseInput) {
  return {
    tenant: v.tenant.trim(), venue: v.venue, room_label: v.roomLabel.trim(), amount: v.amount,
    anchor_day: v.anchorDay, start_date: v.startDate, end_date: v.endDate,
    has_work_order: v.hasWorkOrder, notes: v.notes?.trim() || null,
  }
}

export async function createLease(v: LeaseInput): Promise<boolean> {
  const { error } = await supabase.from('leases').insert(toRow(v))
  return dbResult('Adding tenant', error)
}

export async function updateLease(id: string, v: LeaseInput): Promise<boolean> {
  const { error } = await supabase.from('leases').update(toRow(v)).eq('id', id)
  return dbResult('Saving tenant', error)
}

/** Only for a lease entered by mistake — RLS refuses once it has stamped
 *  months. A tenant who leaves gets an end date instead. */
export async function deleteLease(id: string): Promise<boolean> {
  const { error } = await supabase.from('leases').delete().eq('id', id)
  return dbResult('Removing tenant', error)
}

// ─── Month + period helpers ──────────────────────────────────────────────────

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_SHORT = MONTH_NAMES.map(m => m.slice(0, 3))

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

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (isoDate: string, n: number) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  return iso(new Date(y, m - 1, d + n))
}
const shortDay = (isoDate: string) => {
  const [, m, d] = isoDate.split('-').map(Number)
  return `${MONTH_SHORT[m - 1]} ${d}`
}

export type RentPeriod = {
  /** 'YYYY-MM' — the month the period starts in; the stamp key. */
  month: string
  start: string   // ISO
  end: string     // ISO, inclusive
  /** The rent email should be out by here (6 days before the start). */
  sendBy: string
  /** Unpaid from here on is late (6th for a 1st-anchored lease). */
  lateFrom: string
  /** 'Sep 1 – 30' or 'Sep 16 – Oct 15'. */
  label: string
  days: number
}

/** The lease's period that starts in `month`. */
export function periodFor(lease: Pick<Lease, 'anchorDay'>, month: string): RentPeriod {
  const [y, m] = month.split('-').map(Number)
  const start = iso(new Date(y, m - 1, lease.anchorDay))
  const end = addDays(iso(new Date(y, m, lease.anchorDay)), -1)
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  const label = sameMonth
    ? `${shortDay(start)} – ${end.split('-')[2].replace(/^0/, '')}`
    : `${shortDay(start)} – ${shortDay(end)}`
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1
  return { month, start, end, sendBy: addDays(start, -6), lateFrom: addDays(start, 5), label, days }
}

/** Is the lease in force for any part of this period? */
export function leaseActiveIn(lease: Lease, p: RentPeriod): boolean {
  if (lease.startDate > p.end) return false
  if (lease.endDate && lease.endDate < p.start) return false
  return true
}

/** Leases with a period in `month`, board order. */
export function leasesForMonth(leases: Lease[], month: string): Lease[] {
  return leases.filter(l => leaseActiveIn(l, periodFor(l, month)))
}

// ─── Rent stamps (the stored human acts + the frozen amount) ─────────────────

export type RentKind = 'rent' | 'incidentals'
export type RentStamp = {
  leaseId: string
  month: string
  kind: RentKind
  sentAt: string | null
  paidAt: string | null
  /** Payment entered in QuickBooks — the ladder's last rung, manual for now. */
  qbAt: string | null
  /** Frozen when the row was first written. Null on incidentals (hours, not money). */
  amount: number | null
  paidAmount: number | null
}

export function stampKey(leaseId: string, month: string, kind: RentKind): string {
  return `${leaseId}|${month}|${kind}`
}

/** All stamps for the given months, keyed by stampKey. */
export async function fetchRentStamps(months: string[]): Promise<Map<string, RentStamp>> {
  const out = new Map<string, RentStamp>()
  if (months.length === 0) return out
  const { data, error } = await supabase
    .from('tenant_rent_months')
    .select('lease_id, month, kind, sent_at, paid_at, qb_at, amount, paid_amount')
    .in('month', months)
    .not('lease_id', 'is', null)
  if (!dbResult('Loading rent months', error)) return out
  for (const r of data ?? []) {
    out.set(stampKey(r.lease_id, r.month, r.kind as RentKind), {
      leaseId: r.lease_id, month: r.month, kind: r.kind as RentKind,
      sentAt: r.sent_at ?? null, paidAt: r.paid_at ?? null, qbAt: r.qb_at ?? null,
      amount: r.amount == null ? null : Number(r.amount),
      paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
    })
  }
  return out
}

/** Every rent row for one lease, newest first — the ledger. */
export async function fetchLeaseLedger(leaseId: string): Promise<RentStamp[]> {
  const { data, error } = await supabase
    .from('tenant_rent_months')
    .select('lease_id, month, kind, sent_at, paid_at, qb_at, amount, paid_amount')
    .eq('lease_id', leaseId).eq('kind', 'rent')
    .order('month', { ascending: false })
  if (!dbResult('Loading ledger', error)) return []
  return (data ?? []).map(r => ({
    leaseId: r.lease_id, month: r.month, kind: r.kind as RentKind,
    sentAt: r.sent_at ?? null, paidAt: r.paid_at ?? null, qbAt: r.qb_at ?? null,
    amount: r.amount == null ? null : Number(r.amount),
    paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
  }))
}

/** Upsert one period-row's fields. Requires UNIQUE (lease_id, month, kind).
 *  `amount` is written only on rent rows and only if the row has none yet —
 *  the freeze: the first act on a period fixes what that period was worth. */
async function writeStamp(
  lease: Lease, month: string, kind: RentKind,
  patch: Record<string, string | number | null>, label: string,
): Promise<boolean> {
  const { data: existing, error: rErr } = await supabase
    .from('tenant_rent_months')
    .select('id, amount')
    .eq('lease_id', lease.id).eq('month', month).eq('kind', kind)
    .order('created_at').limit(1)
  if (!dbResult(label, rErr)) return false
  const row = existing?.[0]
  const freeze = kind === 'rent' && (!row || row.amount == null) ? { amount: lease.amount } : {}
  const { error } = await supabase
    .from('tenant_rent_months')
    .upsert({ lease_id: lease.id, month, kind, ...freeze, ...patch }, { onConflict: 'lease_id,month,kind' })
  return dbResult(label, error)
}

/** The rent email went out (or, for incidentals, the 2nd–3rd invoice). */
export function markRentSent(lease: Lease, month: string, kind: RentKind, byId: string | null): Promise<boolean> {
  return writeStamp(lease, month, kind,
    { sent_at: new Date().toISOString(), sent_by: byId }, 'Marking rent sent')
}

/** The money arrived. `paid` defaults to the period's amount (paid in full);
 *  anything less is a Partial and the row stays open for the rest. */
export function markRentPaid(lease: Lease, month: string, kind: RentKind, byId: string | null, paid?: number): Promise<boolean> {
  const patch: Record<string, string | number | null> = { paid_by: byId }
  if (kind === 'rent') {
    const amt = paid ?? lease.amount
    patch.paid_amount = amt
    // paid_at means "settled" — a partial payment leaves it null so the
    // ladder keeps offering Mark paid for the balance.
    patch.paid_at = amt >= lease.amount - 0.005 ? new Date().toISOString() : null
  } else {
    patch.paid_at = new Date().toISOString()
  }
  return writeStamp(lease, month, kind, patch, 'Marking rent paid')
}

/** The payment was entered in QuickBooks — the last rung. Manual for now;
 *  the QBO integration (docs/AR-SCOPING.md) would stamp this itself. */
export function markRentQb(lease: Lease, month: string, kind: RentKind, byId: string | null): Promise<boolean> {
  return writeStamp(lease, month, kind,
    { qb_at: new Date().toISOString(), qb_by: byId }, 'Marking payment in QuickBooks')
}

/** Undo a misclick. Clears the stamp — the row itself stays (it's a record). */
export function undoRentSent(lease: Lease, month: string, kind: RentKind): Promise<boolean> {
  return writeStamp(lease, month, kind, { sent_at: null, sent_by: null }, 'Undoing rent sent')
}

export function undoRentPaid(lease: Lease, month: string, kind: RentKind): Promise<boolean> {
  return writeStamp(lease, month, kind, { paid_at: null, paid_by: null, paid_amount: null }, 'Undoing rent paid')
}

export function undoRentQb(lease: Lease, month: string, kind: RentKind): Promise<boolean> {
  return writeStamp(lease, month, kind, { qb_at: null, qb_by: null }, 'Undoing QuickBooks mark')
}

/** Partial: some money in, not all. */
export function isRentPartial(stamp: RentStamp | undefined): boolean {
  if (!stamp || stamp.paidAt) return false
  return (stamp.paidAmount ?? 0) > 0
}

/** Unsettled past the period's lateFrom (the 6th for a 1st-anchored lease). */
export function isRentLate(stamp: RentStamp | undefined, p: RentPeriod): boolean {
  if (stamp?.paidAt) return false
  return getLocalToday() >= p.lateFrom
}

/** Rent straight-lined across the period's days — Financials' tenant
 *  stream. One period's worth; the caller sums across months. */
export function rentPerDay(lease: Lease, p: RentPeriod): number {
  return p.days > 0 ? lease.amount / p.days : 0
}

// ─── The one shared-runner deal ──────────────────────────────────────────────
/** Which room shares runners with which — deal terms; becomes data the day a
 *  second tenant shares runners, not speculatively before. */
export const SHARED_RUNNER = {
  venue: 'Encore',
  /** The tenant's own room (bookings.studio format — full label). */
  tenantStudio: 'Studio B',
  /** studio_time_rows letters whose billed sessions share the runner. */
  sharedLetters: ['A'],
  splitLabel: '½ vs ERS·A',
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
