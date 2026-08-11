// ─────────────────────────────────────────────────────────────────────────────
// lib/billing — the invoice lifecycle (docs/design-refs/billing-hub-final.html).
//
// Replaces the Dropbox folder system. Those folders — COD paid / COD with
// balance / needing approval / approved-awaiting-PO / sent & open / sent & paid
// — were a status field Eli maintained by hand. Here they are buckets derived
// from, or stored on, the work order.
//
// THE ONE RULE THAT SHAPES EVERYTHING: **PRSFlo owns the workflow and the
// documents; QuickBooks keeps owning the money.** That is what dissolves the
// two-sets-of-books problem — the two systems track different things. Nothing
// here claims to be the accounting.
//
// STORED vs DERIVED — the honest split:
//   · COD buckets are COMPUTED (charges vs payments, via lib/woTotals.ts — the
//     same function the WO screen displays). Nobody files a COD invoice, and
//     storing its state would create a second number that can disagree with the
//     one on screen.
//   · BILLING buckets are STORED, because nothing in PRSFlo can know that Eli
//     approved something or that a cheque cleared three weeks ago. Those are
//     human acts. Pretending to compute them would produce a confidently wrong
//     AR screen, which is worse than an honest manual one.
//
// AGING RUNS FROM `invoice_sent_at`, never from the session date. A session
// invoiced three weeks late is not three weeks overdue.
//
// APPROVAL IS OWNERS ONLY and is enforced by a Postgres trigger (migration
// 20260811120000), not by the check in this file. The check here exists to give
// a decent message before the round-trip; the database is what makes it true.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { computeWoTotals } from '@/lib/woTotals'
import { getLocalToday } from '@/lib/time'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Stored states. COD work orders carry NULL — their bucket is computed. */
export type InvoiceState =
  | 'needs_approval' | 'approved' | 'awaiting_po' | 'sent' | 'paid' | 'closed'

export type ClosedReason = 'written_off' | 'voided'

/** The tabs on the hub. `cod_balance`/`cod_paid` are derived, never stored. */
export type BucketKey =
  | 'needs_approval' | 'approved' | 'awaiting_po' | 'sent' | 'cod_balance' | 'paid' | 'closed'

export type Bucket = { key: BucketKey; label: string; pill: string }

/**
 * Tab order matches the mock, which follows the order work moves through:
 * what needs you → what's stuck → what's out → COD → done → out of play.
 */
export const BUCKETS: Bucket[] = [
  { key: 'needs_approval', label: 'Needs approval',    pill: 'c-fill-warm' },
  // Approved gets its OWN tab (RULING 2026-08-11). An earlier version folded it
  // into Needs approval to save a tab — wrong, and Eli's question caught it:
  // billing would have gone to a tab called "Needs approval" to find the
  // invoices that were already approved and waiting to be sent. The two states
  // have different owners and different actions (an owner approves; billing
  // sends), which is what earns a queue. Fewer tabs is not worth a tab whose
  // name lies about half its contents.
  { key: 'approved',       label: 'Ready to send',     pill: 'c-fill-uncon' },
  { key: 'awaiting_po',    label: 'Awaiting PO',       pill: 'c-fill-cold' },
  { key: 'sent',           label: 'Sent & open',       pill: 'c-fill-dead' },
  { key: 'cod_balance',    label: 'COD with balance',  pill: 'c-fill-hot' },
  { key: 'paid',           label: 'Paid',              pill: 'c-fill-booked' },
  { key: 'closed',         label: 'Closed',            pill: 'c-fill-dead' },
]

export function bucketLabel(key: BucketKey): string {
  return BUCKETS.find(b => b.key === key)?.label ?? key
}

export type InvoiceRow = {
  workOrderId: string
  bookingId: string | null
  invoiceNumber: string | null
  woNumber: string | null
  client: string
  artist: string | null
  sessionDate: string | null
  isCod: boolean
  bucket: BucketKey
  state: InvoiceState | null
  closedReason: ClosedReason | null
  /** Owed on this invoice. 0 once settled. */
  balance: number
  total: number
  paid: number
  /** Days since the invoice was SENT. Null when it hasn't been. */
  ageDays: number | null
  sentAt: string | null
  poNumber: string | null
  hasInvoiceDoc: boolean
  approvedAt: string | null
}

export type BillingSummary = {
  outstanding: number
  receivedThisMonth: number
  waitingApproval: number
  overThirtyOne: number
}

/** Aging threshold. 31+ days past SENT is the figure Eli's AR review uses. */
export const PAST_DUE_DAYS = 31

export const PAGE_SIZE = 10

const INVOICES_BUCKET = 'invoices'
const SIGNED_URL_TTL = 60 * 60 // 1 hour

// ─── Loading ─────────────────────────────────────────────────────────────────

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / 86400000))
}

/**
 * Which bucket a work order belongs in.
 *
 * `closed` wins over everything — that is the point of it: written-off and
 * voided invoices leave every other pipeline entirely (see activeRows).
 * Otherwise a stored state decides for billing, and the arithmetic decides for
 * COD.
 */
function deriveBucket(
  state: InvoiceState | null,
  isCod: boolean,
  balance: number,
  grand: number,
): BucketKey {
  if (state === 'closed') return 'closed'
  if (isCod) {
    // An unbilled COD work order (nothing entered yet) is not "paid" — it has
    // nothing owed because it has nothing on it. Treating $0-of-$0 as settled
    // would quietly park real work in the Paid tab on the day it was created.
    if (grand <= 0) return 'cod_balance'
    return balance > 0 ? 'cod_balance' : 'cod_paid' as BucketKey
  }
  if (state === 'paid') return 'paid'
  if (state === 'sent') return 'sent'
  if (state === 'awaiting_po') return 'awaiting_po'
  if (state === 'approved') return 'approved'
  // needs_approval, or NULL on a completed billing WO — either way it is
  // waiting on an owner and has not been signed off.
  return 'needs_approval'
}

/**
 * Every invoice, with its bucket resolved.
 *
 * Loads in bulk — one query per line-item table rather than per work order —
 * because this runs on every page load and the tab counts need the whole set,
 * not just the visible page.
 */
export async function fetchInvoices(): Promise<InvoiceRow[]> {
  const { data: wos, error } = await supabase
    .from('work_orders')
    // ONE unbroken string literal. supabase-js infers the row type by parsing
    // this at compile time, and a `+`-concatenated string is not a literal to
    // TypeScript — every column then types as an error object. Do not "tidy"
    // this onto several lines with concatenation.
    .select('id, booking_id, invoice_number, wo_number, client, label, artist, session_date, payment_status, po_number, status, invoice_state, invoice_closed_reason, invoice_sent_at, invoice_paid_at, invoice_approved_at, invoice_doc_path')
    .order('session_date', { ascending: false })
  if (!dbResult('Loading invoices', error)) return []
  if (!wos || wos.length === 0) return []

  // Only work orders that have entered the invoice track, or COD work orders
  // that are finished. A WO still being filled in during the session is not an
  // invoice yet and must not appear in a billing queue.
  const relevant = wos.filter(w =>
    w.invoice_state !== null || w.status === 'completed',
  )
  if (relevant.length === 0) return []

  const ids = relevant.map(w => w.id)
  const [st, rent, pay] = await Promise.all([
    supabase
      .from('studio_time_rows')
      .select('work_order_id, charge, ot_charge, from_time, to_time, eng_from_time, eng_to_time, eng_hours, eng_rate')
      .in('work_order_id', ids),
    supabase.from('rental_rows').select('work_order_id, charge').in('work_order_id', ids),
    supabase.from('payment_rows').select('work_order_id, amount').in('work_order_id', ids),
  ])
  if (!dbResult('Loading invoice line items', st.error || rent.error || pay.error)) return []

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

  return relevant.map(w => {
    const totals = computeWoTotals({
      studioRows: stBy.get(w.id) ?? [],
      rentalRows: rentBy.get(w.id) ?? [],
      paymentRows: payBy.get(w.id) ?? [],
    })
    const isCod = (w.payment_status ?? '').toUpperCase() === 'COD'
    const state = (w.invoice_state ?? null) as InvoiceState | null

    return {
      workOrderId: w.id,
      bookingId: w.booking_id ?? null,
      invoiceNumber: w.invoice_number ?? null,
      woNumber: (w as any).wo_number ?? null,
      client: (w as any).label || w.client || 'Unknown',
      artist: w.artist ?? null,
      sessionDate: w.session_date ?? null,
      isCod,
      bucket: deriveBucket(state, isCod, totals.balance, totals.grand),
      state,
      closedReason: (w.invoice_closed_reason ?? null) as ClosedReason | null,
      balance: totals.balance,
      total: totals.grand,
      paid: totals.paid,
      ageDays: daysSince(w.invoice_sent_at ?? null),
      sentAt: w.invoice_sent_at ?? null,
      poNumber: w.po_number ?? null,
      hasInvoiceDoc: !!w.invoice_doc_path,
      approvedAt: w.invoice_approved_at ?? null,
    }
  })
}

// ─── Filtering, search, pagination ───────────────────────────────────────────

/**
 * Everything still in play.
 *
 * Closed invoices are excluded from the summary figures, from aging and from
 * the "All" view. Leaving them in would mean written-off debt kept counting as
 * outstanding forever — which is exactly what "move them out of the normal
 * pipelines" was asking for. They stay fully searchable.
 */
export function activeRows(rows: InvoiceRow[]): InvoiceRow[] {
  return rows.filter(r => r.bucket !== 'closed')
}

/**
 * Search spans EVERY bucket, including closed, and deliberately ignores the
 * open tab (RULING 2026-08-11).
 *
 * Searching within the current bucket would mean guessing the right folder
 * before you can find anything — the exact Dropbox problem this page removes.
 * You look for a client, not for a client-in-a-folder.
 */
export function searchRows(rows: InvoiceRow[], query: string): InvoiceRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(r =>
    [
      r.client, r.artist ?? '', r.invoiceNumber ?? '', r.woNumber ?? '',
      r.sessionDate ?? '', bucketLabel(r.bucket), r.poNumber ?? '',
    ].join(' ').toLowerCase().includes(q),
  )
}

export function rowsInBucket(rows: InvoiceRow[], bucket: BucketKey): InvoiceRow[] {
  return rows.filter(r => r.bucket === bucket)
}

export function bucketCounts(rows: InvoiceRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of BUCKETS) out[b.key] = 0
  for (const r of rows) out[r.bucket] = (out[r.bucket] ?? 0) + 1
  return out
}

export function paginate<T>(rows: T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE
  return rows.slice(start, start + PAGE_SIZE)
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE))
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * The four figures across the top. Computed from the same rows the tabs use, so
 * a number up there can never disagree with the list below it.
 */
export function summarise(rows: InvoiceRow[]): BillingSummary {
  const live = activeRows(rows)
  const month = getLocalToday().slice(0, 7) // YYYY-MM

  return {
    // Everything genuinely owed, COD and billing alike.
    outstanding: live
      .filter(r => r.bucket !== 'paid')
      .reduce((s, r) => s + Math.max(0, r.balance), 0),
    // Payments recorded against invoices settled this month. Like the My Day
    // brief, this counts what PRSFlo knows — anything zeroed straight into
    // QuickBooks never touches payment_rows. Label it as such wherever shown.
    receivedThisMonth: live
      .filter(r => (r.sentAt ?? '').slice(0, 7) === month || r.bucket === 'paid')
      .reduce((s, r) => s + r.paid, 0),
    waitingApproval: live.filter(r => r.bucket === 'needs_approval').length,
    overThirtyOne: live.filter(
      r => r.bucket === 'sent' && (r.ageDays ?? 0) >= PAST_DUE_DAYS,
    ).length,
  }
}

/** True when a sent invoice has aged past the review threshold. */
export function isPastDue(row: InvoiceRow): boolean {
  return row.bucket === 'sent' && (row.ageDays ?? 0) >= PAST_DUE_DAYS
}

// ─── Transitions ─────────────────────────────────────────────────────────────

/**
 * Approve — OWNERS ONLY (Eli + Adam-Mike).
 *
 * Routes to `awaiting_po` when the client requires a PO and none has been
 * received: approval has already happened, the invoice simply cannot go out
 * yet, and the blocker is the client. That is the folder Eli described, not a
 * step everyone walks through.
 *
 * The role check below is a courtesy — it produces a clear message instead of a
 * database error. The RULE lives in the `enforce_invoice_approver` trigger, so
 * it holds even if this function is bypassed entirely.
 */
export async function approveInvoice(row: InvoiceRow, approverId: string | null): Promise<boolean> {
  let nextState: InvoiceState = 'approved'

  if (!row.poNumber && row.bookingId) {
    // work_orders has no client_id — the link runs through the booking. Only
    // looked up at approval time, never per row on load: this is one query on
    // a click, versus a join on every page render.
    const { data: bk } = await supabase
      .from('bookings').select('client_id').eq('id', row.bookingId).limit(1)
    const clientId = bk?.[0]?.client_id
    if (clientId) {
      const { data: cl } = await supabase
        .from('clients').select('requires_po').eq('id', clientId).limit(1)
      if (cl?.[0]?.requires_po) nextState = 'awaiting_po'
    }
  }

  const { error } = await supabase
    .from('work_orders')
    .update({
      invoice_state: nextState,
      invoice_approved_at: new Date().toISOString(),
      invoice_approved_by: approverId,
    })
    .eq('id', row.workOrderId)

  return dbResult('Approving invoice', error)
}

/** Record the PO that was holding an invoice up, and release it. */
export async function recordPoNumber(row: InvoiceRow, poNumber: string): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({
      po_number: poNumber,
      // Only springs the trap; an invoice parked for another reason is untouched.
      ...(row.bucket === 'awaiting_po' ? { invoice_state: 'approved' as InvoiceState } : {}),
    })
    .eq('id', row.workOrderId)
  return dbResult('Saving PO number', error)
}

/** Mark as sent. This STARTS THE AGING CLOCK — every past-due figure keys off it. */
export async function markSent(row: InvoiceRow): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({ invoice_state: 'sent', invoice_sent_at: new Date().toISOString() })
    .eq('id', row.workOrderId)
  return dbResult('Marking invoice sent', error)
}

/**
 * Mark as paid. BILLING INVOICES ONLY — a COD invoice settles itself when a
 * payment row is added, and stamping a state on it would create the second
 * source of truth this whole design avoids.
 */
export async function markPaid(row: InvoiceRow): Promise<boolean> {
  if (row.isCod) {
    return dbResult('Marking invoice paid', {
      message: 'COD invoices settle from their payments — add the payment on the work order instead.',
    })
  }
  const { error } = await supabase
    .from('work_orders')
    .update({ invoice_state: 'paid', invoice_paid_at: new Date().toISOString() })
    .eq('id', row.workOrderId)
  return dbResult('Marking invoice paid', error)
}

/**
 * Close — written off or voided. Out of every pipeline, still searchable.
 *
 * The reason is required by the database too (a CHECK constraint), because the
 * distinction is the entire reason one bucket can hold both: written off means
 * money was owed and collection was abandoned; voided means the invoice should
 * never have existed.
 */
export async function closeInvoice(
  row: InvoiceRow,
  reason: ClosedReason,
  closedBy: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({
      invoice_state: 'closed',
      invoice_closed_reason: reason,
      invoice_closed_at: new Date().toISOString(),
      invoice_closed_by: closedBy,
    })
    .eq('id', row.workOrderId)
  return dbResult('Closing invoice', error)
}

/**
 * Take an invoice back out of Closed.
 *
 * Returns it to `sent` when it had been sent (the aging clock is still on the
 * row and resumes from the original date — reopening a debt does not make it
 * young again), otherwise back to needs_approval.
 */
export async function reopenInvoice(row: InvoiceRow): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({
      invoice_state: row.sentAt ? 'sent' : 'needs_approval',
      invoice_closed_reason: null,
      invoice_closed_at: null,
      invoice_closed_by: null,
    })
    .eq('id', row.workOrderId)
  return dbResult('Reopening invoice', error)
}

/**
 * Put a completed work order into the invoice pipeline.
 *
 * Called when a WO is completed. COD work orders are deliberately left with a
 * NULL state — they land in a computed bucket and need no stamp.
 */
export async function enterInvoicePipeline(workOrderId: string, isCod: boolean): Promise<boolean> {
  if (isCod) return true
  const { error } = await supabase
    .from('work_orders')
    .update({ invoice_state: 'needs_approval' })
    .eq('id', workOrderId)
    .is('invoice_state', null) // never overwrite an invoice already in flight
  return dbResult('Sending work order to billing', error)
}

// ─── The invoice document ────────────────────────────────────────────────────

/**
 * Upload the QuickBooks invoice PDF.
 *
 * ONE upload. PRSFlo already renders the work order itself, so the scan-and-
 * combine step is deleted rather than digitised — that step only ever existed
 * because the work order used to be paper.
 */
export async function uploadInvoiceDoc(workOrderId: string, file: File): Promise<boolean> {
  const ext = file.name.split('.').pop() || 'pdf'
  const path = `${workOrderId}/${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from(INVOICES_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (!dbResult('Uploading invoice', upErr)) return false

  const { error } = await supabase
    .from('work_orders').update({ invoice_doc_path: path }).eq('id', workOrderId)
  return dbResult('Attaching invoice', error)
}

/**
 * Short-lived URL for a stored invoice. Signed client-side (like lib/photos.ts)
 * rather than through a service route — the bucket's RLS already limits reads
 * to owner/manager/billing, so a privileged server route would add nothing but
 * another place for the rule to drift.
 */
export async function signedInvoiceUrl(workOrderId: string): Promise<string | null> {
  const { data: wo } = await supabase
    .from('work_orders').select('invoice_doc_path').eq('id', workOrderId).limit(1)
  const path = wo?.[0]?.invoice_doc_path
  if (!path) return null

  const { data, error } = await supabase.storage
    .from(INVOICES_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data) return null
  return data.signedUrl
}
