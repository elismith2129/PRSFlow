// ─────────────────────────────────────────────────────────────────────────────
// lib/woActivity — the work order's history (Eli, 2026-09-01; mock
// docs/design-refs/wo-history-options.html, options A + C).
//
// What the paper copy had: the original stayed legible under the pen marks.
// What this restores: ONE append-only `wo_activity` row per save event (who ·
// when · which fields, from → to), and the CREATION SNAPSHOT as entry zero —
// the original WO stored whole, never reconstructed from diffs.
//
// WHY TS DIFFS, NOT DB TRIGGERS: since the Aug 16 rebuild there is one editor
// (WorkOrderPopup, admin + runner mode) and one save path
// (save_work_order_atomic), and the popup already holds a pristine baseline of
// every row for Cancel-revert. Diffing baseline-vs-payload here keeps the house
// law (all values computed in TS; RPCs and the DB stay dumb) and produces
// entries already shaped for reading — a trigger would log raw column churn
// that still needed translating, and would put diff logic in SQL.
//
// THE COST OF THAT CHOICE, stated plainly: a write path that bypasses the
// logged sites writes no history. Today those sites are: WO save (the popup),
// WO create (createWorkOrderForBooking), runner Submit. Direct field writes
// elsewhere (e.g. daily-ops Approve flipping row status) are not logged yet —
// add the call where the write lives, never a second diff engine.
//
// Failure is soft everywhere: history must never block or fail a save, so
// logWoActivity reports through dbResult and returns; it is fire-and-forget at
// every call site.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { toStudioLetter } from '@/lib/time'
import { STUDIO_SHORT } from '@/lib/studios'

// ─── Types ───────────────────────────────────────────────────────────────────

/** One field movement inside an entry. `day` tags per-day changes ("2026-08-28"). */
export type WoChange = { what: string; day?: string | null; from?: string; to?: string }

/**
 * The ladder, in house convention (Eli, 2026-09-01): runner SUBMITS the day,
 * admin REVIEWS it (the per-row lock), owner APPROVES the invoice — or
 * REJECTS it with a note, and billing RESUBMITS once fixed.
 */
export type WoActivityKind = 'created' | 'saved' | 'submitted' | 'reviewed' | 'approved' | 'rejected' | 'resubmitted'
export type WoActivitySource = 'office' | 'runner' | 'system'

/** The Original card / compare view reads this — key fields only, stored whole. */
export type WoSnapshotRow = {
  date: string
  studio: string
  location: string
  from_time: string
  to_time: string
  rate: string
  rate_daily: string
  row_rate_type: string
  eng_name: string
  eng_role: string
  eng_rate: string
}
export type WoSnapshot = {
  client: string
  label: string
  artist: string
  ordered_by: string
  payment_status: string
  session_type: string
  rows: WoSnapshotRow[]
}

export type WoActivityEntry = {
  id: string
  work_order_id: string
  at: string
  actor_name: string
  source: WoActivitySource
  kind: WoActivityKind
  after_invoice: boolean
  changes: WoChange[] | null
  snapshot: WoSnapshot | null
}

// Structural row shape — both the popup's StRow state and the seed payloads
// satisfy it. Everything optional so a caller never has to pad.
export type WoAuditRow = {
  id?: string
  date?: string | null
  studio?: string | null
  location?: string | null
  from_time?: string | null
  to_time?: string | null
  rate?: string | number | null
  rate_daily?: string | number | null
  row_rate_type?: string | null
  ot_rate?: string | number | null
  ot_hours?: string | number | null
  eng_name?: string | null
  eng_role?: string | null
  eng_rate?: string | null
  eng_from_time?: string | null
  eng_to_time?: string | null
  actual_from_time?: string | null
  actual_to_time?: string | null
  session_info?: string | null
}

// ─── Formatting (shared by the diff and the viewer) ──────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-08-28" → "Aug 28". Bad input comes back unchanged. */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return `${MONTHS[m - 1]} ${day}`
}

/** "PRS A" / "ERS B" — never a bare letter (ruling 2026-08-13). */
function roomLabel(location: string | null | undefined, studio: string | null | undefined): string {
  const letter = toStudioLetter(studio ?? '')
  const loc = (location ?? '').trim()
  const short = loc ? (STUDIO_SHORT[loc] ?? loc) : ''
  return [short, letter].filter(Boolean).join(' ')
}

function money(v: string | number | null | undefined): string {
  const s = (v ?? '').toString().trim()
  if (!s) return ''
  return s.startsWith('$') ? s : `$${s}`
}

function rateLabel(r: WoAuditRow): string {
  const daily = r.row_rate_type === 'day'
  const raw = ((daily ? r.rate_daily : r.rate) ?? '').toString().trim()
  if (!raw) return ''
  return daily ? `Day ${money(raw)}` : `${money(raw)}/hr`
}

const norm = (v: unknown): string => (v ?? '').toString().trim()

// ─── WO-level diff ───────────────────────────────────────────────────────────

/**
 * The session-level fields worth a history line, with their display names.
 * `presence` fields log THAT they changed, not the text (notes are long).
 */
const WO_FIELDS: Array<{ key: string; label: string; presence?: boolean; bool?: boolean }> = [
  { key: 'client', label: 'Client' },
  { key: 'label', label: 'Label' },
  { key: 'artist', label: 'Artist' },
  { key: 'ordered_by', label: 'Ordered by' },
  { key: 'payment_status', label: 'Payment' },
  { key: 'session_status', label: 'Session status' },
  { key: 'session_type', label: 'Session type' },
  { key: 'invoice_number', label: 'Invoice #' },
  { key: 'po_number', label: 'PO' },
  { key: 'no_po_needed', label: 'No PO needed', bool: true },
  { key: 'is_srs', label: 'SRS', bool: true },
  { key: 'cod_method', label: 'COD method' },
  { key: 'food_budget', label: 'Food budget', bool: true },
  { key: 'food_amount', label: 'Food amount' },
  { key: 'session_notes', label: 'Session notes', presence: true },
  { key: 'booking_notes', label: 'Booking notes', presence: true },
  { key: 'needs_attention_notes', label: 'Needs-attention note', presence: true },
]

/** Pick the audit-tracked WO fields off any WO-shaped object (state or payload). */
export function woAuditView(wo: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of WO_FIELDS) {
    const v = wo[f.key]
    out[f.key] = f.bool ? (v ? 'Yes' : 'No') : norm(v)
  }
  return out
}

function diffWoFields(before: Record<string, string> | null, after: Record<string, string>): WoChange[] {
  if (!before) return []
  const out: WoChange[] = []
  for (const f of WO_FIELDS) {
    const a = before[f.key] ?? ''
    const b = after[f.key] ?? ''
    if (a === b) continue
    if (f.presence) out.push({ what: f.label, from: '', to: 'edited' })
    else out.push({ what: f.label, from: a || '—', to: b || '—' })
  }
  return out
}

// ─── Row-level diff ──────────────────────────────────────────────────────────

/** One row's short description, for Day added / Day removed lines. */
function describeRow(r: WoAuditRow): string {
  if ((r.studio ?? '') === '') {
    const role = r.eng_role === 'engineer' ? 'Engineer' : 'Assistant'
    return [role, norm(r.eng_name) || 'TBD'].join(' · ')
  }
  return [roomLabel(r.location, r.studio), [norm(r.from_time), norm(r.to_time)].filter(Boolean).join(' – '), rateLabel(r)]
    .filter(Boolean).join(' · ')
}

function diffRowPair(a: WoAuditRow, b: WoAuditRow): WoChange[] {
  const day = norm(b.date) || norm(a.date) || null
  const out: WoChange[] = []
  const push = (what: string, from: string, to: string) => {
    if (from !== to) out.push({ what, day, from: from || '—', to: to || '—' })
  }
  push('Studio', roomLabel(a.location, a.studio), roomLabel(b.location, b.studio))
  push('Date', fmtDay(norm(a.date)), fmtDay(norm(b.date)))
  push('Start', norm(a.from_time), norm(b.from_time))
  push('End', norm(a.to_time), norm(b.to_time))
  push('Rate', rateLabel(a), rateLabel(b))
  push('OT rate', money(a.ot_rate), money(b.ot_rate))
  push('OT hours', norm(a.ot_hours) && `${norm(a.ot_hours)}h`, norm(b.ot_hours) && `${norm(b.ot_hours)}h`)
  const roleB = b.eng_role === 'engineer' ? 'Engineer' : 'Assistant'
  push(roleB, norm(a.eng_name), norm(b.eng_name))
  push(`${roleB} rate`, money(a.eng_rate), money(b.eng_rate))
  push('Staff start', norm(a.eng_from_time), norm(b.eng_from_time))
  push('Staff end', norm(a.eng_to_time), norm(b.eng_to_time))
  // Actual vs billed (2026-09-01): the internal arrival record is history-
  // worthy too — who recorded it and whether it was later changed.
  push('Arrived (actual)', norm(a.actual_from_time), norm(b.actual_from_time))
  push('Left (actual)', norm(a.actual_to_time), norm(b.actual_to_time))
  push('Session info', norm(a.session_info), norm(b.session_info))
  return out
}

/**
 * The whole diff for one save: WO fields + rows matched by id + added rows +
 * deleted rows. Empty array = a no-op save; the caller writes nothing.
 */
export function diffWoForSave(args: {
  woBefore: Record<string, string> | null
  woAfter: Record<string, string>
  rowsBefore: WoAuditRow[]
  rowsAfter: WoAuditRow[]
  rowsDeleted: WoAuditRow[]
}): WoChange[] {
  const out: WoChange[] = [...diffWoFields(args.woBefore, args.woAfter)]
  const beforeById = new Map(args.rowsBefore.map(r => [r.id, r]))
  for (const b of args.rowsAfter) {
    const a = b.id != null ? beforeById.get(b.id) : undefined
    if (a) out.push(...diffRowPair(a, b))
    else out.push({
      what: (b.studio ?? '') === '' ? 'Staff line added' : 'Day added',
      day: norm(b.date) || null,
      to: describeRow(b),
    })
  }
  for (const d of args.rowsDeleted) {
    out.push({
      what: (d.studio ?? '') === '' ? 'Staff line removed' : 'Day removed',
      day: norm(d.date) || null,
      from: describeRow(d),
    })
  }
  return out
}

// ─── Snapshot (the paper original) ───────────────────────────────────────────

export function buildWoSnapshot(
  wo: Record<string, unknown>,
  rows: WoAuditRow[],
  fallbackLocation?: string | null,
): WoSnapshot {
  return {
    client: norm(wo.client),
    label: norm(wo.label),
    artist: norm(wo.artist),
    ordered_by: norm(wo.ordered_by),
    payment_status: norm(wo.payment_status),
    session_type: norm(wo.session_type),
    rows: rows
      .filter(r => (r.studio ?? '') !== '' || norm(r.eng_name))
      .map(r => ({
        date: norm(r.date),
        studio: toStudioLetter(norm(r.studio)),
        location: norm(r.location) || norm(fallbackLocation),
        from_time: norm(r.from_time),
        to_time: norm(r.to_time),
        rate: norm(r.rate),
        rate_daily: norm(r.rate_daily),
        row_rate_type: norm(r.row_rate_type),
        eng_name: norm(r.eng_name),
        eng_role: norm(r.eng_role),
        eng_rate: norm(r.eng_rate),
      })),
  }
}

/**
 * The compare view's six lines, computed identically for the snapshot and for
 * "now" so C's tinting is an honest string comparison.
 */
export type WoCompareSummary = { client: string; dates: string; studios: string; times: string; rate: string; staff: string }
export function summarizeForCompare(s: WoSnapshot): WoCompareSummary {
  const rows = s.rows.filter(r => r.studio !== '')
  const dates = Array.from(new Set(rows.map(r => r.date).filter(Boolean))).sort()
  const uniq = (vals: string[]) => Array.from(new Set(vals.filter(Boolean)))
  const staff = uniq(s.rows.map(r => {
    if (!r.eng_name && r.studio === '') return ''
    const nm = r.eng_name || (r.studio !== '' ? '' : 'TBD')
    if (!nm) return ''
    const role = r.eng_role === 'engineer' ? 'Eng' : 'Asst'
    return `${nm} (${role}${r.eng_rate ? ` · ${money(r.eng_rate)}/hr` : ''})`
  }))
  return {
    client: [s.label || s.client, s.artist].filter(Boolean).join(' — ') || '—',
    dates: dates.length
      ? (dates.length === 1 ? fmtDay(dates[0]) : `${fmtDay(dates[0])}–${fmtDay(dates[dates.length - 1])}`)
      : '—',
    studios: uniq(rows.map(r => roomLabel(r.location, r.studio))).join(' · ') || '—',
    times: uniq(rows.map(r => [r.from_time, r.to_time].filter(Boolean).join(' – '))).join(' · ') || '—',
    rate: uniq(rows.map(r => rateLabel(r as WoAuditRow))).join(' · ') || '—',
    staff: staff.join(' · ') || (s.rows.some(r => r.studio === '' || r.eng_name) ? 'TBD' : '—'),
  }
}

// ─── Read / write ────────────────────────────────────────────────────────────

/** Fire-and-forget: history must never fail a save. dbResult reports quietly-ish. */
export async function logWoActivity(e: {
  workOrderId: string
  actorId: string | null
  actorName: string
  source: WoActivitySource
  kind: WoActivityKind
  afterInvoice?: boolean
  changes: WoChange[] | null
  snapshot?: WoSnapshot | null
}): Promise<void> {
  const { error } = await supabase.from('wo_activity').insert({
    work_order_id: e.workOrderId,
    actor_id: e.actorId,
    actor_name: e.actorName,
    source: e.source,
    kind: e.kind,
    after_invoice: e.afterInvoice ?? false,
    changes: e.changes,
    snapshot: e.snapshot ?? null,
  })
  // Full dbResult, not { silent } — this is a one-shot write, and a silent
  // caller would owe its own UI for the failure (the standing rule). A red
  // "NOT saved" toast for a lost history line is honest and rare.
  dbResult('Recording work-order history', error)
}

export async function fetchWoActivity(workOrderId: string): Promise<WoActivityEntry[]> {
  const { data, error } = await supabase
    .from('wo_activity')
    .select('*')
    .eq('work_order_id', workOrderId)
    .order('at', { ascending: false })
  if (!dbResult('Loading work-order history', error)) return []
  return (data ?? []) as WoActivityEntry[]
}
