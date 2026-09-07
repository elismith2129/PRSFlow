// ─────────────────────────────────────────────────────────────────────────────
// lib/home.ts — data layer for the Noir dashboard
// (design: docs/design-refs/dashboard-anchor-noir.html, option A1 — LOCKED
//  2026-09-06; built on feature/dashboard-noir).
//
// Four fetchers, all derived from machinery that already exists so the
// dashboard can never disagree with the page it links to:
//
//   · fetchLandedToday   — "what clients did we land?" NAMES, never money
//                          (Eli's ruling). Bookings CREATED today, confirmed,
//                          native (imported_at NULL), deduped by work_order_id
//                          because bookings rows are projection cards and a
//                          multi-room run is one deal, not three.
//   · fetchNewInquiries  — the red block's names: Web Inquiry leads still
//                          uncontacted, newest first.
//   · fetchBillingPulse  — the money box's "where billing is at": review →
//                          approval → send, computed over fetchInvoices() with
//                          billingStage()/approvalQueue() — the SAME derivations
//                          as the billing page and the Rail badge.
//   · fetchHoldsWeek     — holds to check, next 7 days. A parameterised
//                          fetchHoldsQueue — one queue, one derivation.
//
// House rules honoured here:
//   · NULL ON FAILURE, NOT [] (the 2026-09-02 "my checkboxes cleared" lesson)
//     — an empty array is an answer, a failed fetch is not. Callers keep
//     their previous state on null.
//   · Realtime is the caller's job. The dashboard pairs these with channels it
//     already owns: leadsVersion (WebInquiryProvider) re-runs fetchNewInquiries,
//     useWoInvoicesVersion re-runs fetchBillingPulse, and the page's bookings
//     channel re-runs fetchLandedToday + fetchHoldsWeek.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import { dbResult } from './db'
import { getLocalToday } from './time'
import { fetchInvoices, activeRows, approvalQueue, billingStage } from './billing'
import { fetchHoldsQueue, type QueueBookingItem } from './myday'

// ─── Landed today ────────────────────────────────────────────────────────────

export type LandedItem = {
  bookingId: string
  workOrderId: string | null
  /** Display name — label if present, else the client. The chip text. */
  client: string
  artist: string | null
  startDate: string | null
  endDate: string | null
  location: string
  studio: string
}

/**
 * Deals closed TODAY: bookings created since local midnight, confirmed, and
 * native (`imported_at` NULL — imported history is provenance, not a win).
 * Tentative rows are deliberately excluded: a hold taken today is in the air,
 * not landed — it shows in the holds list instead.
 *
 * Bookings are projection cards (one per consecutive-same-room run, all
 * sharing `work_order_id`), so a three-room booking is three rows and ONE
 * deal — dedupe on work_order_id, keeping the earliest-starting card.
 */
export async function fetchLandedToday(): Promise<LandedItem[] | null> {
  const midnight = new Date(getLocalToday() + 'T00:00:00').toISOString()
  const { data, error } = await supabase
    .from('bookings')
    .select('id, work_order_id, client_name, label, artist, start_date, end_date, location, studio, created_at, imported_at')
    .gte('created_at', midnight)
    .eq('status', 'confirmed')
    .is('imported_at', null)
    .order('start_date', { ascending: true })
  if (!dbResult('Loading today’s landed sessions', error)) return null

  const seen = new Set<string>()
  const out: LandedItem[] = []
  for (const b of data ?? []) {
    const key = b.work_order_id || b.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      bookingId: b.id,
      workOrderId: b.work_order_id ?? null,
      client: b.label || b.client_name || 'Unknown',
      artist: b.artist ?? null,
      startDate: b.start_date ?? null,
      endDate: b.end_date ?? null,
      location: b.location ?? '',
      studio: b.studio ?? '',
    })
  }
  return out
}

// ─── New inquiries ───────────────────────────────────────────────────────────

export type InquiryLead = {
  id: number
  /** "First Last", falling back to email/phone so the block never shows blank. */
  name: string
  createdAt: string | null
}

/**
 * The red block's names: Web Inquiry leads nobody has touched yet. Same
 * predicate as WebInquiryProvider's unacked set (`source='Web Inquiry'` +
 * `status='uncontacted'`) so the count and the names always agree.
 */
export async function fetchNewInquiries(): Promise<InquiryLead[] | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, fname, lname, email, phone, created_at')
    .eq('source', 'Web Inquiry')
    .eq('status', 'uncontacted')
    .order('created_at', { ascending: false })
    .limit(6)
  if (!dbResult('Loading new inquiries', error)) return null
  return (data ?? []).map(l => ({
    id: l.id,
    name: [l.fname, l.lname].filter(Boolean).join(' ').trim() || l.email || l.phone || 'Unknown',
    createdAt: l.created_at ?? null,
  }))
}

// ─── Billing pulse ───────────────────────────────────────────────────────────

export type BillingPulse = {
  /** Sessions arrived and waiting on billing's eyes (stage `review`, both pipelines). */
  review: number
  /** Packages queued behind the owner's sign-off (approvalQueue — THE derivation). */
  approval: number
  /** Sum of those packages' invoice totals, for the "· $6,025" tail. */
  approvalTotal: number
  /** Approved billing packages with nothing blocking them — genuinely sendable
   *  (stage `approved`: approved AND not awaiting a PO; COD excluded — an
   *  approved COD session is finished, nothing "goes out"). */
  send: number
}

/**
 * "Where billing is at", in ladder order. Built over fetchInvoices() with the
 * same stage/queue functions as the billing page — never re-implement these
 * predicates (the Sep 1 watch-out; approvalQueue membership IS the rule).
 */
export async function fetchBillingPulse(): Promise<BillingPulse | null> {
  let rows
  try {
    rows = await fetchInvoices()
  } catch {
    return null
  }
  if (!rows) return null
  const act = activeRows(rows)
  const approvals = approvalQueue(act)
  return {
    review: act.filter(r => billingStage(r).key === 'review').length,
    approval: approvals.length,
    approvalTotal: approvals.reduce((s, r) => s + (r.invoicedTotal ?? 0), 0),
    send: act.filter(r => !r.isCod && billingStage(r).key === 'approved').length,
  }
}

// ─── Holds this week ─────────────────────────────────────────────────────────

/** Holds to check — tentative bookings in the next 7 days. One queue, one
 *  derivation: this is fetchHoldsQueue with the dashboard's window. */
export function fetchHoldsWeek(): Promise<QueueBookingItem[]> {
  const today = getLocalToday()
  const to = new Date(today + 'T12:00:00')
  to.setDate(to.getDate() + 7)
  const toIso = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`
  return fetchHoldsQueue({ fromDate: today, toDate: toIso })
}
