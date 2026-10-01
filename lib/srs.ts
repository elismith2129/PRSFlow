// ─────────────────────────────────────────────────────────────────────────────
// SRS — Studio Referral Service payouts (Eli, 2026-10-01; mock
// docs/design-refs/srs-options.html, option A).
//
// THE LIST IS THE WORK ORDERS. Every WO with is_srs = true is on it — nothing
// has to be written for a session to appear. srs_payouts holds only what a
// person decided: a per-session % override and the paid stamp. (The old
// srs_log only got a row when SRS was ticked at booking creation, so sessions
// ticked on the WO fell off the list. Nothing reads srs_log any more.)
//
// THE FEE: pct × room charges (studio time + OT, cancelled days excluded),
// ENGINEERING EXCLUDED — the original rule. Taken from computeWoTotals().studio
// so it can never disagree with the WO. Before any WO discount (a discount is
// the studio's concession to the client, not the referrer's).
//
// THE PERCENT: studio default (app_settings 'srs_default_pct', 20) unless the
// session overrides it ("typically 20% on one offs, 10% if it's a low rate or
// an extended booking"). PAID FREEZES IT: Mark paid writes the % and the
// dollars, and changing the default afterwards never re-prices money already
// sent (CLAUDE.md: never retroactively rewrite money).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { computeWoTotals } from '@/lib/woTotals'

export const SRS_DEFAULT_PCT_FALLBACK = 20

export type SrsRow = {
  workOrderId: string
  bookingId: number | null
  woNumber: string | null
  date: string | null          // session_date
  client: string
  artist: string
  rooms: string[]              // distinct studio_time_rows.studio
  roomCharges: number          // computeWoTotals().studio
  overridePct: number | null   // srs_payouts.fee_pct
  pct: number                  // effective: paid_pct ?? override ?? default
  fee: number                  // paid_amount ?? roomCharges × pct
  paidAt: string | null
  paidOn: string | null
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const x = typeof v === 'number' ? v : parseFloat(String(v))
  return isFinite(x) ? x : null
}

export const feeFor = (roomCharges: number, pct: number) =>
  Math.round(roomCharges * pct) / 100

export async function fetchSrsDefaultPct(): Promise<number> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'srs_default_pct').limit(1)
  if (error) { dbResult('Loading the SRS default', error); return SRS_DEFAULT_PCT_FALLBACK }
  return n(data?.[0]?.value) ?? SRS_DEFAULT_PCT_FALLBACK
}

export async function setSrsDefaultPct(pct: number): Promise<boolean> {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: 'srs_default_pct', value: pct, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return dbResult('Saving the SRS default', error)
}

export async function fetchSrsRows(defaultPct: number): Promise<SrsRow[]> {
  const { data: wos, error } = await supabase
    .from('work_orders')
    .select('id, booking_id, wo_number, client, artist, session_date, invoice_state')
    .eq('is_srs', true)
    .order('session_date', { ascending: false })
  if (!dbResult('Loading SRS sessions', error)) return []
  const ids = (wos ?? []).map(w => w.id as string)
  if (ids.length === 0) return []

  const [st, pay] = await Promise.all([
    supabase.from('studio_time_rows')
      .select('work_order_id, studio, charge, ot_charge, from_time, to_time, eng_from_time, eng_to_time, eng_hours, eng_rate, day_status')
      .in('work_order_id', ids),
    supabase.from('srs_payouts')
      .select('work_order_id, fee_pct, paid_at, paid_on, paid_pct, paid_amount')
      .in('work_order_id', ids),
  ])
  if (!dbResult('Loading SRS room charges', st.error)) return []
  if (!dbResult('Loading SRS payouts', pay.error)) return []

  const rowsBy = new Map<string, any[]>()
  for (const r of st.data ?? []) {
    const k = r.work_order_id as string
    if (!rowsBy.has(k)) rowsBy.set(k, [])
    rowsBy.get(k)!.push(r)
  }
  const payBy = new Map<string, any>((pay.data ?? []).map(p => [p.work_order_id as string, p]))

  const out: SrsRow[] = []
  for (const w of wos ?? []) {
    const rows = rowsBy.get(w.id) ?? []
    const p = payBy.get(w.id)
    const roomCharges = computeWoTotals({ studioRows: rows, rentalRows: [], paymentRows: [] }).studio
    const paidAt = (p?.paid_at as string | null) ?? null
    const overridePct = n(p?.fee_pct)
    const pct = (paidAt ? n(p?.paid_pct) : null) ?? overridePct ?? defaultPct
    const fee = (paidAt ? n(p?.paid_amount) : null) ?? feeFor(roomCharges, pct)
    // A written-off WO earned nothing, so nothing is owed on it — unless it
    // was already paid, which stays on the record.
    if (!paidAt && (w.invoice_state === 'closed' || !(fee > 0))) continue
    out.push({
      workOrderId: w.id,
      bookingId: (w.booking_id as number | null) ?? null,
      woNumber: (w.wo_number as string | null) ?? null,
      date: (w.session_date as string | null) ?? null,
      client: (w.client as string) || '',
      artist: (w.artist as string) || '',
      rooms: Array.from(new Set(rows.map(r => r.studio as string).filter(Boolean))),
      roomCharges, overridePct, pct, fee, paidAt,
      paidOn: (p?.paid_on as string | null) ?? null,
    })
  }
  return out
}

export async function setSrsPct(workOrderId: string, pct: number | null): Promise<boolean> {
  const { error } = await supabase.from('srs_payouts')
    .upsert({ work_order_id: workOrderId, fee_pct: pct, updated_at: new Date().toISOString() }, { onConflict: 'work_order_id' })
  return dbResult('Saving the SRS percent', error)
}

export async function markSrsPaid(row: SrsRow, onDate: string, byId: string | null): Promise<boolean> {
  const { error } = await supabase.from('srs_payouts').upsert({
    work_order_id: row.workOrderId,
    paid_at: new Date().toISOString(),
    paid_on: onDate,
    paid_pct: row.pct,
    paid_amount: row.fee,
    paid_by: byId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'work_order_id' })
  return dbResult('Marking SRS paid', error)
}

export async function undoSrsPaid(workOrderId: string): Promise<boolean> {
  const { error } = await supabase.from('srs_payouts')
    .update({ paid_at: null, paid_on: null, paid_pct: null, paid_amount: null, paid_by: null, updated_at: new Date().toISOString() })
    .eq('work_order_id', workOrderId)
  return dbResult('Undoing SRS paid', error)
}

// ── History (Eli's spreadsheet log, Dec 2023 → Jun 2026) ─────────────────────
// Sessions from before PRSFlo, entered as recorded (migration
// 20261001140000_srs_history). No work order, nothing to derive — amount, %
// and paid are the log's own. Read-only on the page.

export type SrsHistoryRow = {
  id: string
  date: string
  dateLabel: string | null
  client: string
  invoiceNumber: string | null
  roomCharges: number | null
  pct: number | null
  fee: number
  paid: boolean
  paidOn: string | null
  note: string | null
}

export async function fetchSrsHistory(): Promise<SrsHistoryRow[]> {
  const { data, error } = await supabase
    .from('srs_history')
    .select('id, session_date, date_label, client, invoice_number, room_charges, pct, fee, paid, paid_on, note')
    .order('session_date', { ascending: false })
  // Before the migration runs the table doesn't exist — the page still works.
  if (error) { if (!/srs_history/.test(error.message || '')) dbResult('Loading SRS history', error); return [] }
  return (data ?? []).map(r => ({
    id: r.id as string,
    date: r.session_date as string,
    dateLabel: (r.date_label as string | null) ?? null,
    client: r.client as string,
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    roomCharges: n(r.room_charges),
    pct: n(r.pct),
    fee: n(r.fee) ?? 0,
    paid: !!r.paid,
    paidOn: (r.paid_on as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  }))
}
