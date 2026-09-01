// ─────────────────────────────────────────────────────────────────────────────
// lib/billing — the invoice lifecycle (docs/design-refs/billing-hub-v2.html).
//
// v2 SUPERSEDES billing-hub-final.html, which is stale. Do not port from it.
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
import { formatCurrency } from '@/lib/format'
import { bookingShouldHaveWorkOrder } from '@/lib/createWorkOrder'
import { logWoActivity } from '@/lib/woActivity'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Stored states. COD work orders carry NULL — their bucket is computed. */
export type InvoiceState =
  | 'needs_invoice' | 'needs_approval' | 'approved' | 'awaiting_po' | 'sent' | 'paid' | 'closed'

export type ClosedReason = 'written_off' | 'voided'

/**
 * TWO PIPELINES, NOT ONE (RULING 2026-08-11) — v2, superseding the nine-tab
 * single pipeline.
 *
 *   · BILLING: assemble → approve → send → chase → paid. Days to weeks.
 *   · COD:     money is already in → check it is accurate → done. Minutes.
 *
 * Eli: "the majority of COD do not go through a billing process, they are just
 * checked for accuracy, approved and then they are done." Forcing both through
 * one set of tabs is what made nine tabs feel necessary. They share a work order
 * and nothing else, so they get a toggle.
 */
export type Pipeline = 'billing' | 'cod'

/**
 * The tabs. Four for billing, four for COD.
 *
 * UPCOMING IS GONE (Eli, 2026-08-19, launch morning: "ditch the upcoming bin
 * and just organize all WO into in progress based on date"). It kept catching
 * real work — a session on its own day, after its start time, is not
 * "upcoming" to anyone standing in the building, and no derivation of
 * "has it started" from a date column can beat just showing the row where
 * the work lives. In progress now holds everything pre-send, sorted so
 * started work leads and not-yet-started sessions sit below it (sortBucket).
 *
 * The four steps v1 modelled as PLACES (open → needs invoice → needs approval →
 * approved) were never four places. They are one package being assembled, so
 * they collapse into `progress` and become three lights on the row. Every
 * serious AR tool separates by WHO IS WAITING, not by which rung of the ladder
 * something is on.
 */
export type BucketKey =
  // Shared
  | 'progress'   // being assembled — includes sessions that haven't started yet
  | 'paid'
  | 'closed'     // written off / voided — the archive for BOTH pipelines
  // Billing
  | 'awaiting'   // sent, waiting on the client's money
  // COD
  | 'balance'    // collection was missed. Rare, critical, leads its side.
  | 'review'     // money is in; check the WO and attach the invoice

export type Bucket = { key: BucketKey; label: string; pill: string; hot?: boolean }

export const BILLING_TABS: Bucket[] = [
  { key: 'progress', label: 'In progress',      pill: 'c-fill-warm' },
  { key: 'awaiting', label: 'Awaiting payment', pill: 'c-fill-uncon' },
  { key: 'paid',     label: 'Paid',             pill: 'c-fill-booked' },
  { key: 'closed',   label: 'Closed',           pill: 'c-fill-dead' },
]

export const COD_TABS: Bucket[] = [
  // BALANCE DUE LEADS ITS SIDE. Eli: "rare occasions that collection was not
  // made in error, so COD with balance exists — not a lot, but very important
  // these surface as the most important bin." Rare-but-critical sorted by
  // frequency ends up at the bottom, which is where you find it late.
  { key: 'balance',  label: 'Balance due',  pill: 'c-fill-hot', hot: true },
  // COD's In progress (2026-08-19, with the death of Upcoming): a session
  // that hasn't ended lives here; the moment it ends (or a runner submits)
  // it becomes Balance due / Needs review / Paid.
  { key: 'progress', label: 'In progress',  pill: 'c-fill-uncon' },
  { key: 'review',   label: 'Needs review', pill: 'c-fill-warm' },
  { key: 'paid',     label: 'Paid',         pill: 'c-fill-booked' },
]

export function tabsFor(pipeline: Pipeline): Bucket[] {
  return pipeline === 'cod' ? COD_TABS : BILLING_TABS
}

const ALL_BUCKETS: Bucket[] = [
  ...BILLING_TABS, ...COD_TABS,
]

export function bucketLabel(key: BucketKey): string {
  return ALL_BUCKETS.find(b => b.key === key)?.label ?? key
}

/**
 * THE ASSEMBLY LINE, as a number. This is what the three lights on the row read
 * from, and it is the answer to "how does billing spot last night's unreviewed
 * work orders in the morning" — anything at step 0–1 is theirs.
 *
 *   0  the work order is still open. Nobody has checked it.
 *   1  REVIEWED — billing completed it. Waiting on the QuickBooks invoice.
 *   2  INVOICED — the PDF is attached. Billing: waiting on an owner.
 *                 COD: that is the end of the line.
 *   3  APPROVED — an owner signed it off. Ready to send (or waiting on a PO).
 *   4  SENT      — out with the client, aging.
 *   5  PAID
 *
 * The labels name the STATE, not the artifact. An earlier version labelled the
 * first light "WO", which described a document and said nothing about whether
 * anyone had looked at it.
 */
export type Step = 0 | 1 | 2 | 3 | 4 | 5

export const BILLING_LIGHTS: Array<{ label: string; at: Step }> = [
  { label: 'Reviewed', at: 1 }, { label: 'Invoiced', at: 2 }, { label: 'Approved', at: 3 },
]
/** COD has no approval and nothing to send, so it shows two. */
export const COD_LIGHTS: Array<{ label: string; at: Step }> = [
  { label: 'Reviewed', at: 1 }, { label: 'Invoiced', at: 2 },
]

export type InvoiceRow = {
  workOrderId: string
  bookingId: string | null
  invoiceNumber: string | null
  woNumber: string | null
  client: string
  artist: string | null
  sessionDate: string | null
  /**
   * First dated row (or session_date) is after today — the session hasn't
   * begun. Drives the "Not started" chip and the In-progress sort, now that
   * these rows live in the same tab as real work (2026-08-19).
   */
  notStarted: boolean
  isCod: boolean
  pipeline: Pipeline
  bucket: BucketKey
  /** Position on the assembly line. Drives the lights and the next action. */
  step: Step
  state: InvoiceState | null
  closedReason: ClosedReason | null
  /** Owed on this invoice. 0 once settled. */
  balance: number
  total: number
  paid: number
  /** Days since the invoice was SENT. Null when it hasn't been. */
  ageDays: number | null
  /** The package was built and downloaded. NOT the same as sent — see below. */
  downloadedAt: string | null
  /**
   * A stored copy of the merged package EXACTLY as it was last downloaded.
   * True once anything has actually left — and it is what the package window
   * shows from then on, so you review the artifact rather than a re-render of
   * today's work order.
   */
  hasPackage: boolean
  /**
   * Built, downloaded, and still not marked sent after DOWNLOAD_STALE_DAYS.
   * The reminder that makes the two-step send safe: without it, a package can
   * sit finished in someone's Downloads folder and never reach the client.
   */
  staleDownload: boolean
  sentAt: string | null
  /**
   * When the invoice was marked paid. Needed because a BILLING invoice's money
   * never touches `payment_rows` — a label pays by cheque or ACH and billing
   * presses Mark paid; nobody types a payment row. So this stamp is the only
   * record that money arrived, and the only honest basis for "received this
   * month".
   */
  paidAt: string | null
  poNumber: string | null
  /** Set on the WORK ORDER — this package can go out without a PO. */
  noPoNeeded: boolean
  /**
   * Approved, but it cannot be sent: the client wants a PO number on it and
   * none has been recorded. DERIVED, never stored (it was a state in v1) —
   * typing the PO on the work order clears it with no second act.
   */
  awaitingPo: boolean
  hasInvoiceDoc: boolean
  approvedAt: string | null
  /** The total at the moment the invoice was attached. Null = never invoiced. */
  invoicedTotal: number | null
  /**
   * The work order has been edited since it was invoiced, so what PRSFlo says
   * is owed no longer matches what the client was billed. The single most
   * expensive thing to find out from the client rather than from the app.
   */
  invoiceDrift: boolean
  /**
   * "Aug 5–8" — the REAL span, from the work order's own dated rows.
   * `sessionDate` alone made a four-day session look like a one-nighter, which
   * is the single most misleading thing a billing row can say.
   */
  dateRange: string | null
  /** Rooms actually used, e.g. "B" or "B, A" — again from the rows. */
  rooms: string | null
  /** True when the session's last date has passed — drives the Open sort. */
  ended: boolean
}

/**
 * The four figures across the top. Each is a bucket you can click, so a number
 * is never a dead end — the numbers ARE the filters.
 */
export type SummaryStat = {
  value: string
  label: string
  alert?: boolean
  /** Clicking jumps here. Null when the figure has no single home. */
  goto: BucketKey | null
}

/** Aging threshold. 31+ days past SENT is the figure Eli's AR review uses. */
export const PAST_DUE_DAYS = 31

export const PAGE_SIZE = 10
/**
 * In progress gets 20 (Eli, 2026-08-11). It is the working list — the one you
 * scan top to bottom every morning — and paging through last night's work in
 * tens is friction on the path people take daily. The finished lists stay at 10
 * because you arrive at those looking for one specific thing.
 */
export const PROGRESS_PAGE_SIZE = 20
export function pageSizeFor(bucket: BucketKey): number {
  return bucket === 'progress' ? PROGRESS_PAGE_SIZE : PAGE_SIZE
}

/** Downloaded but still not sent after this long — the row goes hot. */
export const DOWNLOAD_STALE_DAYS = 2

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
 * How far along the assembly line a work order is.
 *
 * Derived from the stored state plus whether the invoice document is actually
 * attached — because the document IS the evidence for step 2, and a state that
 * says "invoiced" with no file would be a lie the lights then repeated.
 */
export function deriveStep(
  state: InvoiceState | null,
  isCod: boolean,
  hasDoc: boolean,
  woStatus: string,
): Step {
  if (isCod) {
    // COD has two rungs and no approval: reviewed, then invoiced. Whether the
    // money arrived is answered by the payments, never by a stamp.
    if (hasDoc) return 2
    return woStatus === 'completed' || state !== null ? 1 : 0
  }
  if (state === 'paid') return 5
  if (state === 'sent') return 4
  if (state === 'approved' || state === 'awaiting_po') return 3
  if (state === 'needs_approval' || hasDoc) return 2
  if (state === 'needs_invoice' || woStatus === 'completed') return 1
  return 0
}

/**
 * Which bucket a work order belongs in — v2: two pipelines, four/three tabs.
 *
 * `closed` wins over everything: written-off and voided invoices leave every
 * pipeline entirely (see activeRows) and land in ONE archive regardless of
 * payment type. A voided COD invoice under a COD-only Closed tab would be an
 * archive nobody would ever think to open.
 *
 * NO MORE `upcoming` (Eli, 2026-08-19). Not-yet-started sessions are just
 * `progress` rows now, sorted below the started work. On the COD side a
 * session that hasn't ENDED (or been runner-submitted — `ended` here already
 * includes that, see fetchInvoices) is `progress` too: Balance due means
 * collection was MISSED, which cannot be true of a session still running.
 */
export function deriveBucket(args: {
  state: InvoiceState | null
  isCod: boolean
  step: Step
  balance: number
  grand: number
  ended: boolean
}): BucketKey {
  const { state, isCod, step, balance, grand, ended } = args
  if (state === 'closed') return 'closed'

  if (isCod) {
    // Still running (and no runner submission yet) → In progress. This gate
    // comes FIRST: an unfinished session with an outstanding balance is not a
    // missed collection, it's a session that isn't over.
    if (!ended) return 'progress'
    // BALANCE DUE beats everything else on the COD side, at any step. Money
    // that was supposed to be collected at the top of the session and wasn't is
    // the only way COD goes wrong, and it must never be reachable only by
    // paging past settled sessions.
    //
    // A work order with nothing on it (grand <= 0) is NOT a balance — there is
    // nothing owed because nothing has been entered. It needs reviewing.
    if (grand > 0 && balance > 0) return 'balance'
    return step >= 2 && grand > 0 ? 'paid' : 'review'
  }

  if (step >= 5) return 'paid'
  if (step === 4) return 'awaiting'
  // Steps 0–3 are one package being assembled. Which rung it is on shows as
  // lights on the row, not as four different tabs.
  return 'progress'
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
    .select('id, booking_id, invoice_number, wo_number, client, label, artist, session_date, session_status, payment_status, po_number, no_po_needed, status, invoice_state, invoice_closed_reason, invoice_sent_at, invoice_paid_at, invoice_approved_at, invoice_doc_path, invoice_total, invoice_downloaded_at, invoice_package_path')
    .order('session_date', { ascending: false })
  if (!dbResult('Loading invoices', error)) return []
  if (!wos || wos.length === 0) return []

  // Everything billing touches, INCLUDING work orders still open — the "To
  // review" tab is their morning queue, and the whole point of the hub is that
  // the job happens on one screen.
  //
  // BLOCKS ARE EXCLUDED (Eli, 2026-08-11). Tour, Tech and Open Hours are
  // calendar events, not sessions: nothing is charged, so nothing is ever
  // invoiced. An earlier comment here claimed they "never get a work order in
  // the first place" — wrong. bookingShouldHaveWorkOrder stops them being
  // CREATED, but flipping a session to a block leaves its WO row behind
  // (dormant, by design — see handleBlockSave), and pre-gate rows exist too.
  // So they must be filtered on read.
  //
  // Filtered through the SAME gate the WO creator uses rather than a second
  // status list, so the two can never drift apart.
  //
  // BUT ONLY BEFORE THE PIPELINE (ruling 2026-08-11). That gate also excludes
  // CANCELLED, and blanket-applying it would mean cancelling a session made an
  // already-sent invoice VANISH from AR while the client still owed the money.
  // Once a work order has an invoice_state it stays visible whatever happens to
  // the booking, so it can be voided properly through the Closed bucket, with a
  // reason on the record. Tentative is the same story in reverse: invisible
  // until it matters, never disappearing once it does.
  const relevant = wos.filter(w =>
    w.invoice_state !== null
    || bookingShouldHaveWorkOrder({ status: (w.session_status ?? '') as any }),
  )
  if (relevant.length === 0) return []

  const ids = relevant.map(w => w.id)
  // NO `fallbackEngRate` HERE, DELIBERATELY (2026-08-13). `bookings.engineer_rate`
  // is VESTIGIAL: the booking form is deleted, `buildBookingProjection` does not
  // write the column, and staffing lives ONLY in the Studio Time table
  // (CLAUDE.md). The only thing still writing it is the calendar's legacy create
  // path, from the old form-data shape.
  //
  // A fallback was briefly added here on the theory that the hub was under-
  // counting engineering versus the work order screen. It was the wrong fix in
  // the wrong direction — reading a dead column would let a stale pre-rebuild
  // rate ADD engineering cost to an invoice that correctly had none. The rows
  // are the truth; if a row has no eng_rate, there is no engineer charge.
  const [st, rent, pay] = await Promise.all([
    supabase
      .from('studio_time_rows')
      .select('work_order_id, date, charge, ot_charge, from_time, to_time, eng_from_time, eng_to_time, eng_hours, eng_rate, status')
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

  const today = getLocalToday()

  return relevant.map(w => {
    const stRows = stBy.get(w.id) ?? []
    const totals = computeWoTotals({
      studioRows: stRows,
      rentalRows: rentBy.get(w.id) ?? [],
      paymentRows: payBy.get(w.id) ?? [],
    })

    // THE SESSION'S LAST DAY comes from the work order's own dated rows, not
    // from the booking. The rows are what actually happened: a session that
    // ended early has its unused row deleted, one that ran long has a row
    // added, and either way this follows without anyone updating a second
    // field. Undated rows are ignored rather than treated as today.
    const dates = stRows.map((r: any) => r.date).filter(Boolean).sort()
    const lastDate: string | null = dates.length ? dates[dates.length - 1] : null
    const ended = lastDate !== null && lastDate < today

    // A RUNNER SUBMISSION ENDS "UPCOMING" (Eli, 2026-08-18, launch testing).
    // Upcoming used to be purely calendar + office acts: an untouched WO whose
    // last day hadn't PASSED was "not work yet" — which filed a session the
    // runner had already submitted TODAY under Upcoming, invisible to review
    // until midnight. Submitted is a signal to the office (the standing rule);
    // any submitted/approved day makes this work NOW. `ended` on the row stays
    // honest (it drives sorting); only the bucket gate treats submission as
    // arrival.
    const anySubmitted = stRows.some(
      (r: any) => r.status === 'submitted' || r.status === 'approved',
    )

    // METADATA ON THE LINE (Eli, 2026-08-11). Free: these rows are already
    // loaded for the totals, so no extra query. Derived from the ROWS, not the
    // booking, for the same reason `ended` is — the rows are what actually
    // happened once a session ran long or finished early.
    const fmt = (d: string) => {
      const [y, m, day] = d.split('-').map(Number)
      if (!y || !m || !day) return d
      return `${MONTHS[m - 1]} ${day}`
    }
    const firstDate: string | null = dates.length ? dates[0] : null
    const dateRange = firstDate
      ? (firstDate === lastDate ? fmt(firstDate) : `${fmt(firstDate)}–${fmt(lastDate!)}`)
      : (w.session_date ? fmt(w.session_date) : null)
    const roomList = Array.from(new Set(
      stRows.map((r: any) => (r.studio || '').trim()).filter(Boolean),
    ))
    const rooms = roomList.length ? roomList.join(', ') : null

    // DRIFT: the work order has been edited since the invoice was raised, so
    // what PRSFlo says is owed no longer matches what the client was billed.
    // Rounded to the cent before comparing — floating-point noise is not drift.
    const invoicedTotal = w.invoice_total != null ? Number(w.invoice_total) : null
    const invoiceDrift = invoicedTotal !== null
      && Math.round(totals.grand * 100) !== Math.round(invoicedTotal * 100)
    const isCod = (w.payment_status ?? '').toUpperCase() === 'COD'
    const state = (w.invoice_state ?? null) as InvoiceState | null
    const hasDoc = !!w.invoice_doc_path
    let step = deriveStep(state, isCod, hasDoc, w.status ?? '')

    // EDITING AN APPROVED PACKAGE VOIDS THE APPROVAL (ruling 2026-08-11).
    // An owner approved $1,680 — not "this work order". Change the numbers and
    // the thing they signed off no longer exists, so it goes back to Needs
    // approval on its own.
    //
    // DERIVED, not written: nothing has to notice the edit and issue an update,
    // so it cannot be missed by a save path that forgot to call it.
    //
    // NOT applied once SENT. That invoice is already with the client, and
    // silently un-approving it would rewrite history rather than describe it —
    // the drift flag says what happened, and Pull it back is the deliberate act
    // that restarts the cycle.
    if (invoiceDrift && step === 3) step = 2
    const poNumber = (w.po_number ?? '').trim() || null
    const noPoNeeded = !!(w as any).no_po_needed

    return {
      workOrderId: w.id,
      bookingId: w.booking_id ?? null,
      invoiceNumber: w.invoice_number ?? null,
      woNumber: (w as any).wo_number ?? null,
      client: (w as any).label || w.client || 'Unknown',
      artist: w.artist ?? null,
      sessionDate: w.session_date ?? null,
      notStarted: ((firstDate ?? w.session_date) ?? '') > today,
      isCod,
      pipeline: (isCod ? 'cod' : 'billing') as Pipeline,
      bucket: deriveBucket({
        state, isCod, step, balance: totals.balance, grand: totals.grand,
        ended: ended || anySubmitted,
      }),
      step,
      state,
      closedReason: (w.invoice_closed_reason ?? null) as ClosedReason | null,
      balance: totals.balance,
      total: totals.grand,
      paid: totals.paid,
      ageDays: daysSince(w.invoice_sent_at ?? null),
      downloadedAt: w.invoice_downloaded_at ?? null,
      hasPackage: !!(w as any).invoice_package_path,
      staleDownload:
        step === 3 && !!w.invoice_downloaded_at
        && (daysSince(w.invoice_downloaded_at) ?? 0) >= DOWNLOAD_STALE_DAYS,
      sentAt: w.invoice_sent_at ?? null,
      paidAt: w.invoice_paid_at ?? null,
      poNumber,
      noPoNeeded,
      // AWAITING PO, entirely from the work order (ruling 2026-08-11). Only
      // billing, only once approved — before that the PO is not what is holding
      // anything up, and flagging it early would make it noise on every row.
      // PO IS A PRECONDITION OF APPROVAL, not of sending (ruling 2026-08-11).
      // Eli: "I want no-PO added to block approval so we get in the habit of
      // noting PO or none needed on the WO." Right — approval is the moment
      // someone asserts the package is complete, so the chip is visible from
      // step 2 — an owner should SEE the gap while approving.
      //
      // But it only DISABLES from step 3 (2026-08-31). The Aug 11 version
      // blocked approval itself, on the reasoning that a package which cannot
      // legally be sent is not complete. True of the package; not true of the
      // approval, which is an internal statement about the numbers. The hub
      // decides what the flag disables — see `blocked` in app/(main)/billing.
      awaitingPo: !isCod && step >= 2 && !poNumber && !noPoNeeded,
      hasInvoiceDoc: hasDoc,
      approvedAt: w.invoice_approved_at ?? null,
      invoicedTotal,
      invoiceDrift,
      dateRange,
      rooms,
      ended,
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

/**
 * The rows in one tab of one pipeline, sorted as a queue.
 *
 * The pipeline filter is what lets `paid` be a tab on both sides without the
 * two lists bleeding into each other. `closed` is the exception — one archive
 * for both, so it ignores the pipeline.
 */
export function rowsInBucket(
  rows: InvoiceRow[], bucket: BucketKey, pipeline: Pipeline,
): InvoiceRow[] {
  const inBucket = rows.filter(r =>
    r.bucket === bucket && (bucket === 'closed' || r.pipeline === pipeline),
  )
  return sortBucket(inBucket, bucket)
}

/**
 * Ordered so each tab reads as a queue rather than a list.
 *
 *   In progress → STARTED WORK FIRST, most recent on top (last night is the
 *              work). Not-yet-started sessions sit BELOW it, soonest first —
 *              the old Upcoming order, kept inside the one tab (Eli,
 *              2026-08-19: "organize all WO into in progress based on date").
 *   Awaiting → OLDEST sent first. The chase list is led by the debt that has
 *              been out longest, which is the one about to become a problem.
 *   Everything else → most recent session first.
 */
export function sortBucket(rows: InvoiceRow[], bucket: BucketKey): InvoiceRow[] {
  return [...rows].sort((a, b) => {
    if (bucket === 'awaiting') {
      return (b.ageDays ?? 0) - (a.ageDays ?? 0)
    }
    if (bucket === 'progress') {
      const fa = a.notStarted ? 1 : 0
      const fb = b.notStarted ? 1 : 0
      if (fa !== fb) return fa - fb // started work above not-yet-started
      return fa
        ? (a.sessionDate ?? '').localeCompare(b.sessionDate ?? '')  // future: soonest first
        : (b.sessionDate ?? '').localeCompare(a.sessionDate ?? '')  // started: most recent first
    }
    return (b.sessionDate ?? '').localeCompare(a.sessionDate ?? '')
  })
}

export function bucketCounts(rows: InvoiceRow[], pipeline: Pipeline): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of tabsFor(pipeline)) out[b.key] = 0
  for (const r of rows) {
    if (r.bucket !== 'closed' && r.pipeline !== pipeline) continue
    out[r.bucket] = (out[r.bucket] ?? 0) + 1
  }
  return out
}

/**
 * Does the COD side need looking at right now? Drives the hot dot on the
 * toggle, so a missed collection is visible from the Billing side without going
 * to look. A rare problem you have to go looking for is one you find late.
 */
/**
 * Work outstanding in a pipeline — the number beside its name in the heading
 * (spec §17). Everything not paid and not closed, because that is what "is
 * there anything for me over there?" means.
 *
 * Deliberately NOT the total row count: a pipeline whose work is all finished
 * should read 0, not 400. A count that only ever grows is wallpaper.
 */
export function pipelineCount(rows: InvoiceRow[], pipeline: Pipeline): number {
  return activeRows(rows).filter(r => r.pipeline === pipeline && r.bucket !== 'paid').length
}

export function hasCodAlert(rows: InvoiceRow[]): boolean {
  return rows.some(r => r.bucket === 'balance')
}

/**
 * Packages built but never sent. This is the safety net that makes the two-step
 * send safe rather than merely honest — it is counted on the tab, so a forgotten
 * package is visible from anywhere on the page instead of only to someone who
 * happens to scroll past its row.
 */
export function staleDownloads(rows: InvoiceRow[]): InvoiceRow[] {
  return rows.filter(r => r.staleDownload)
}

/**
 * THE DROPBOX FOLDER THAT FILLED UP (Eli, 2026-09-01). The old system's
 * "billing invoices need approvals" folder was the owner's queue: it filled,
 * he green-dotted, billing sent. This is its one derivation — the rows whose
 * button already says Approve (billing pipeline, step 2, still in play) — read
 * by the Rail badge, the owner dashboard banner, and the hub's approvals strip,
 * so the three can never disagree about the count.
 *
 * Membership is `step === 2`, which deliberately INCLUDES drifted-approved
 * work orders (deriveStep demotes them) — an invoice whose numbers changed
 * after sign-off is back in the queue, exactly as the hub's Approve button
 * treats it. Closed rows are out; a voided invoice is nobody's to approve.
 *
 * Oldest first (by the session's first day): the sweep should start with what
 * has waited longest, the way the folder's oldest files sat at the top.
 */
export function approvalQueue(rows: InvoiceRow[]): InvoiceRow[] {
  return rows
    .filter(r => r.pipeline === 'billing' && r.step === 2 && r.bucket === 'progress')
    .sort((a, b) => (a.sessionDate ?? '9999').localeCompare(b.sessionDate ?? '9999'))
}

/**
 * The badge/banner fetch. Full `fetchInvoices` on purpose — a slimmer SQL
 * count could not see drift demotion (it needs the line-item totals), and a
 * badge that says 3 over a strip that shows 4 would be worse than no badge.
 * Callers gate on OWNER before calling: the count is an owner's to-do, and
 * for everyone else it would be a fetch for someone else's queue.
 */
export async function fetchApprovalsQueue(): Promise<InvoiceRow[]> {
  return approvalQueue(await fetchInvoices())
}

export function paginate<T>(rows: T[], page: number, size = PAGE_SIZE): T[] {
  const start = (page - 1) * size
  return rows.slice(start, start + size)
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size))
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * Computed from the same rows the tabs use, so a figure up there can never
 * disagree with the list below it — and computed PER PIPELINE, because the two
 * sides are asking different questions. Billing wants to know what is owed and
 * what is late. COD wants to know what was missed and what still needs a look.
 */
export function summarise(rows: InvoiceRow[], pipeline: Pipeline): SummaryStat[] {
  const live = activeRows(rows).filter(r => r.pipeline === pipeline)
  const month = getLocalToday().slice(0, 7) // YYYY-MM
  const money = (n: number) => formatCurrency(String(n))

  // Payments PRSFlo can see. Anything zeroed straight into QuickBooks never
  // touches payment_rows, so this is a floor, not the books — hence the label.
  //
  // COD only. Money at the desk really does arrive as payment_rows, and it
  // lands on the day of the session, so the session date is the right month.
  const collected = live
    .filter(r => (r.sentAt ?? r.sessionDate ?? '').slice(0, 7) === month)
    .reduce((s, r) => s + r.paid, 0)

  // BILLING IS A DIFFERENT QUESTION (fix, 2026-08-13). Eli: "making paid did not
  // add money to the paid this month? did remove money from outstanding tho."
  //
  // Both were true, and they came from two calculations that disagreed about
  // what "paid" means. Outstanding excludes the paid bucket, so Mark paid moved
  // it immediately. Received summed `payment_rows` — which a label invoice never
  // has, because the money arrives by cheque or ACH and billing presses Mark
  // paid rather than typing a payment. So the figure could only ever move for
  // COD, and pressing the button appeared to lose the money.
  //
  // Counted from `paidAt` instead, in the month it was MARKED paid — not the
  // month it was sent, which for anything invoiced across a month boundary put
  // the receipt in the wrong month anyway. Recorded payments still win when
  // they exist, so a part-paid invoice reports what actually came in.
  const received = live
    .filter(r => (r.paidAt ?? '').slice(0, 7) === month)
    .reduce((s, r) => s + (r.paid > 0 ? r.paid : r.total), 0)

  if (pipeline === 'cod') {
    const balances = live.filter(r => r.bucket === 'balance')
    return [
      {
        value: money(balances.reduce((s, r) => s + Math.max(0, r.balance), 0)),
        label: 'Balance due', alert: balances.length > 0, goto: 'balance',
      },
      { value: money(collected), label: 'Collected this month', goto: null },
      {
        value: String(live.filter(r => r.bucket === 'review').length),
        label: 'Needs review', goto: 'review',
      },
      { value: String(balances.length), label: 'Balances open', alert: balances.length > 0, goto: 'balance' },
    ]
  }

  const overdue = live.filter(r => isPastDue(r))
  return [
    {
      value: money(live.filter(r => r.bucket !== 'paid').reduce((s, r) => s + Math.max(0, r.balance), 0)),
      label: 'Outstanding', goto: null,
    },
    { value: money(received), label: 'Received this month', goto: 'paid' },
    {
      // Step 2 = invoiced, waiting on an owner. This is Eli's own queue.
      value: String(live.filter(r => r.step === 2 && r.bucket === 'progress').length),
      label: 'Waiting on approval', goto: 'progress',
    },
    {
      value: String(overdue.length), label: `Over ${PAST_DUE_DAYS} days`,
      alert: overdue.length > 0, goto: 'awaiting',
    },
  ]
}

/** True when a sent invoice has aged past the review threshold. */
export function isPastDue(row: InvoiceRow): boolean {
  return row.bucket === 'awaiting' && (row.ageDays ?? 0) >= PAST_DUE_DAYS
}

/**
 * What the button on the row should say — one action, always the next one.
 *
 * Same law as the lights: PRSFlo works out where the package is, so the person
 * never has to decide which of six things to do.
 *
 * NULL MEANS "GO LOOK AT IT" (ruling 2026-08-11). There is no Open-WO button
 * any more — DOUBLE-CLICKING THE ROW opens the work order, and once an invoice
 * is attached it opens the package: both documents in one window. Eli: "you
 * double click a work order to review it… once the invoice is attached, when
 * you double click the row you get to see both combined."
 *
 * That is the right split. Opening a record to read it is navigation, not an
 * action, and giving it a button put a control on nearly every row that did the
 * same thing as clicking the row — which then crowded out the one control that
 * actually advanced anything.
 */
export function nextAction(row: InvoiceRow): string | null {
  if (row.bucket === 'closed') return 'Reopen'
  if (row.bucket === 'paid') return null
  if (row.bucket === 'awaiting') return 'Mark paid'
  // A COD balance is collected and recorded ON the work order, so the row's job
  // is to surface it — double-click does the rest.
  if (row.bucket === 'balance') return null
  if (row.step === 0) return null
  if (row.step === 1) return 'Attach invoice'
  if (row.isCod) return null
  // Approve is the gate everything queues behind: reviewed and invoiced.
  // NOT the PO (Eli, 2026-08-31 — reversing Aug 11): owner approval asserts
  // that the work order is complete and the invoice is right, which is knowable
  // the day the session ends. A label's PO can take weeks, and holding the
  // internal sign-off for it meant approving from memory a month later. The PO
  // now blocks DOWNLOAD/SEND instead, so nothing leaves without one.
  if (row.step === 2) return 'Approve'
  // TWO ACTS, NOT ONE (ruling 2026-08-11). PRSFlo builds the file; a person
  // emails it. So the button asks for what only they know, in order:
  //   Download  → build the package
  //   Mark sent → confirm it actually left
  // The row stays In progress in between, which is the state that never existed
  // before and is exactly where a forgotten package used to disappear.
  return row.downloadedAt ? 'Mark sent' : 'Download'
}

// ─── Transitions ─────────────────────────────────────────────────────────────

/**
 * Approve — OWNERS ONLY (Eli + Adam-Mike). Always lands on `approved`.
 *
 * v1 branched here into an `awaiting_po` STATE by looking up
 * `clients.requires_po`. Both are gone (ruling 2026-08-11): awaiting-PO is now
 * DERIVED from the work order's own PO number and its No-PO-needed flag, which
 * means typing the PO clears the block with no second act, and no client-level
 * setting has to be kept true for the hub to be right.
 *
 * The trigger `enforce_invoice_approver` is what makes owners-only true; this
 * function just performs the write.
 */
export async function approveInvoice(row: InvoiceRow, approverId: string | null, approverName?: string): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({
      invoice_state: 'approved',
      invoice_approved_at: new Date().toISOString(),
      invoice_approved_by: approverId,
      // RE-SNAPSHOT THE TOTAL (fix, 2026-08-13). Without this an invoice that
      // had drifted could NEVER be approved: approving set the state to
      // `approved` (step 3), and deriveStep immediately knocked it back to 2
      // because `invoice_total` still held the old figure — so the row kept
      // showing Approve, pressing it appeared to do nothing, and the only exits
      // were Pull it back or editing the database. Eli hit exactly this.
      //
      // Re-snapshotting is also what approval MEANS: an owner is signing off on
      // the numbers as they stand right now, not on what they were when the
      // invoice was first attached. The drift flag exists to make them look
      // before they sign, and it has done its job by the time they press this.
      invoice_total: row.total,
    })
    .eq('id', row.workOrderId)

  const ok = dbResult('Approving invoice', error)
  if (ok) {
    // WO history (2026-09-01): the top rung of the ladder — runner submits,
    // admin reviews, owner APPROVES. The amount recorded is the total being
    // signed off (the re-snapshot above), so the feed shows what was approved
    // even if the numbers move again later.
    void logWoActivity({
      workOrderId: row.workOrderId,
      actorId: approverId,
      actorName: approverName ?? '',
      source: 'office',
      kind: 'approved',
      afterInvoice: true,
      changes: [{ what: 'Invoice approved', to: formatCurrency(String(row.total)) }],
    })
  }
  return ok
}

/**
 * Record the PO. No state change — `awaitingPo` is derived, so writing the
 * number is the whole act and the flag clears itself on reload.
 */
export async function recordPoNumber(row: InvoiceRow, poNumber: string): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({ po_number: poNumber })
    .eq('id', row.workOrderId)
  return dbResult('Saving PO number', error)
}

/** This package can go out without a PO. Same field the WO screen writes. */
export async function setNoPoNeeded(row: InvoiceRow, value: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({ no_po_needed: value })
    .eq('id', row.workOrderId)
  return dbResult('Saving PO requirement', error)
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
 * Undo a send. Exists because Send is ONE PRESS with no confirmation (Eli's
 * call, 2026-08-11) — which is right for the common case, since you have just
 * looked at the package to get there. But one press that moves a row out of
 * your queue and starts a 31-day clock needs a way back, or the first misclick
 * becomes a permanent lie about when the client was billed. Clearing sent_at
 * matters as much as the state: a stale timestamp would age an invoice that was
 * never actually sent.
 */
/** Record that the package was built. Not a claim that anyone sent it. */
export async function markDownloaded(row: InvoiceRow): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({ invoice_downloaded_at: new Date().toISOString() })
    .eq('id', row.workOrderId)
  return dbResult('Recording the download', error)
}

export async function pullBack(row: InvoiceRow): Promise<boolean> {
  // STRIP THE INVOICE TOO (ruling 2026-08-11). Eli: "we should strip it and
  // make it so you can't approve without uploading an invoice — that way they
  // don't accidentally forget to add the new one."
  //
  // Exactly the right instinct, and it reverses my own earlier call. Leaving
  // the old PDF attached would let a corrected work order sail back through
  // approval carrying the invoice that was wrong in the first place — and it
  // would look complete the whole way, because the Invoiced light would be
  // green. Removing it forces the one act that fixes the actual problem.
  {
    const { data: wo } = await supabase
      .from('work_orders')
      .select('invoice_doc_path, invoice_package_path').eq('id', row.workOrderId).limit(1)
    const path = [wo?.[0]?.invoice_doc_path, wo?.[0]?.invoice_package_path].filter(Boolean) as string[]
    // Best effort: a file that fails to delete is orphaned storage, which is
    // untidy. A row still pointing at a stale invoice is wrong. Clearing the
    // pointer matters more than the bytes.
    if (path.length) await supabase.storage.from(INVOICES_BUCKET).remove(path)
  }

  const { error } = await supabase
    .from('work_orders')
    .update({
      invoice_state: 'needs_invoice',
      invoice_doc_path: null,
      invoice_package_path: null,
      invoice_total: null,
      invoice_sent_at: null,
      invoice_downloaded_at: null,
      invoice_approved_at: null,
      invoice_approved_by: null,
    })
    .eq('id', row.workOrderId)
  return dbResult('Pulling the invoice back', error)
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
 * Completing a work order starts the billing process.
 *
 * It lands in `needs_invoice` — NOT `needs_approval`. Eli's workflow: billing
 * reviews the runner's work order and completes it, THEN goes to QuickBooks,
 * updates the invoice and exports a PDF. Only once that PDF is attached does
 * anything reach an owner's queue. An earlier version skipped this stage and
 * would have put unreviewed, un-invoiced sessions straight in front of Eli.
 *
 * COD goes through it too — "this starts the billing process regardless of COD
 * or billing." COD returns to a computed bucket on attach, not here.
 *
 * `.is('invoice_state', null)` means re-completing a work order cannot drag an
 * invoice already in flight back to the start.
 */
export async function enterInvoicePipeline(workOrderId: string): Promise<boolean> {
  const { error } = await supabase
    .from('work_orders')
    .update({ invoice_state: 'needs_invoice' })
    .eq('id', workOrderId)
    .is('invoice_state', null)
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
export async function uploadInvoiceDoc(row: InvoiceRow, file: File): Promise<boolean> {
  const ext = file.name.split('.').pop() || 'pdf'
  const path = `${row.workOrderId}/${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from(INVOICES_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (!dbResult('Uploading invoice', upErr)) return false

  // THE DROP IS THE TRIGGER (RULING 2026-08-11). Attaching the invoice both
  // staples the document and routes the work order — one gesture instead of
  // upload-then-remember-to-file, which is the step that used to go missing in
  // Dropbox. Only advances a work order that was waiting on its invoice;
  // replacing the PDF on an already-approved invoice must not reset it.
  const advance = row.state === 'needs_invoice'
  // SNAPSHOT WHAT THE CLIENT WAS BILLED. Any later edit to hours, rentals or
  // damages then shows as drift instead of silently disagreeing with the PDF
  // that already went out.
  const snapshot = { invoice_total: row.total }
  const next = row.isCod
    // COD returns to a COMPUTED bucket — balance owed or paid — because whether
    // COD money arrived is answered by the payments, never by a stamp.
    ? { invoice_state: null }
    : { invoice_state: 'needs_approval' as InvoiceState }

  const { error } = await supabase
    .from('work_orders')
    .update({ invoice_doc_path: path, ...snapshot, ...(advance ? next : {}) })
    .eq('id', row.workOrderId)
  return dbResult('Attaching invoice', error)
}

/**
 * Short-lived URL for the stored PACKAGE — the merged file as it was sent.
 * This is what the package window opens once anything has gone out.
 */
export async function signedPackageUrl(workOrderId: string): Promise<string | null> {
  const { data: wo } = await supabase
    .from('work_orders').select('invoice_package_path').eq('id', workOrderId).limit(1)
  const path = wo?.[0]?.invoice_package_path
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(INVOICES_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data) return null
  return data.signedUrl
}

/**
 * Short-lived URL for a stored invoice. Signed client-side (like lib/photos.ts)
 * rather than through a service route — the bucket's RLS already limits reads
 * to owner/manager/billing, so a privileged server route would add nothing but
 * another place for the rule to drift.
 */
export async function signedInvoiceUrl(
  workOrderId: string, download = false,
): Promise<string | null> {
  const { data: wo } = await supabase
    .from('work_orders').select('invoice_doc_path').eq('id', workOrderId).limit(1)
  const path = wo?.[0]?.invoice_doc_path
  if (!path) return null

  const { data, error } = await supabase.storage
    .from(INVOICES_BUCKET).createSignedUrl(path, SIGNED_URL_TTL, { download })
  if (error || !data) return null
  return data.signedUrl
}

/**
 * DOWNLOAD THE PACKAGE — ONE merged PDF (ruling 2026-08-11, superseding the
 * two-file compromise).
 *
 * The work order is drawn server-side in black and white and the invoice's
 * pages are stapled onto the end, so what lands in Downloads is the single file
 * billing emails to the label. Built fresh on every call from the live record,
 * which is why there is no stored work-order PDF to go stale: Eli — "if you
 * needed to make changes… you hit save and download where it regenerates
 * another updated one."
 *
 * `woOnly` gets the work order by itself, for the export button on the work
 * order screen (a session that hasn't reached billing has no invoice yet).
 */
export async function downloadPackage(workOrderId: string, woOnly = false): Promise<boolean> {
  return fetchPdf(
    `?id=${encodeURIComponent(workOrderId)}${woOnly ? '&wo=1' : ''}`,
    'Downloading the package',
  )
}

/**
 * THE BLANK WORK ORDER (ruling 2026-08-12).
 *
 * The paper form, replaced. Eli: "just in case we need to create one for a
 * client… I just want to avoid having to create a fake session, go through the
 * whole process to make the work order, and then remember to delete it from the
 * calendar."
 *
 * Nothing is created and nothing is stored — this is a download, not a record.
 * It is drawn by the SAME generator as a real work order, which is what stops
 * the printed form drifting away from the screen.
 */
export async function downloadBlankWorkOrder(): Promise<boolean> {
  return fetchPdf('?blank=1', 'Building the blank work order')
}

/** Shared plumbing: ask the route for a PDF, hand it to the browser. */
async function fetchPdf(query: string, label: string): Promise<boolean> {
  // The route verifies this token and the caller's role before reading
  // anything — a work order id on its own must never be enough.
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) return dbResult(label, { message: 'Your session expired — sign in again.' })

  const res = await fetch(`/api/wo-package${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return dbResult(label, { message: body?.error || `Could not build the PDF (${res.status}).` })
  }

  // Filename comes from the server so it is decided in one place.
  const disp = res.headers.get('content-disposition') || ''
  const named = /filename="([^"]+)"/.exec(disp)?.[1] || 'work-order.pdf'
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = named
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick — revoking synchronously races the download in
  // Safari and produces a zero-byte file.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return true
}
