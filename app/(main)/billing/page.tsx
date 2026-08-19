'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /billing — the invoice hub, v2 (docs/design-refs/billing-hub-v2.html).
//
// Replaces /wo-hub AND the Dropbox folder system. Eli's folders were a status
// field he maintained by hand; here they are derived from the work order, so the
// filing disappears and the window he already looks at becomes the app.
//
// WHY v1 HAD NINE TABS AND THIS HAS SEVEN ACROSS TWO PIPELINES:
// Eli, 2026-08-11 — "open, needs invoice can be combined with status info on the
// line items… an open WO is not ready to be finished, a finished WO is not ready
// to be approved until it has an invoice, a combined WO and invoice isn't ready
// to send until approved." Exactly right: those were never four PLACES. They are
// one package being assembled, and v1 modelled each rung as its own room. They
// collapse into In progress, and the rungs become three lights on the row.
//
// And the other half of the bloat: BILLING AND COD ARE DIFFERENT PIPELINES.
// Billing assembles over days or weeks; COD money is already in and just needs
// checking. Forcing both through one set of tabs is what made nine feel
// necessary. They share a work order and nothing else, so they get a toggle.
//
// Ported from the approved mock per the port protocol — values from the
// reference file, not from prose. Mock polarity is inverted (mock dark =
// data-theme="dark"; app dark = the ABSENCE of the attribute), so tokens are
// used directly and no [data-theme] rules are written here.
//
// RULINGS honoured:
//   · SEARCH OVERRIDES EVERYTHING — every bucket, both pipelines, closed
//     included. Searching within the current tab would mean guessing the right
//     folder before you can find anything: the exact Dropbox problem this page
//     removes.
//   · UPCOMING IS PINNED BELOW THE PAGER, not a footer row inside the list — a
//     footer row in a paginated list falls onto page 3.
//   · APPROVAL IS OWNERS ONLY. The button is hidden for everyone else, and a
//     Postgres trigger enforces it regardless of what the UI does.
//   · DOUBLE-CLICK THE ROW to open it. No Open-WO button — opening a record to
//     read it is navigation, not an action. Before the invoice it opens the
//     work order; after, it opens the PACKAGE (both documents, one window).
//   · DOWNLOAD AND SENT ARE TWO ACTS. PRSFlo builds ONE merged black-and-white
//     PDF (work order + invoice); a person emails it. So Download records only
//     that the file was built, and Mark sent is the human confirmation. A
//     package built but not sent for two days goes hot — that reminder is what
//     makes the split safe rather than merely honest.
//   · PAGINATION: 20 on In progress (the daily working list), 10 elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type Booking } from '@/lib/supabase'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatCurrency } from '@/lib/format'
import { toast } from '@/components/ui/Toaster'
import { Hint } from '@/components/ui/Hint'
import {
  fetchInvoices, searchRows, rowsInBucket, bucketCounts, paginate,
  pageCount, summarise, isPastDue, bucketLabel, tabsFor, hasCodAlert, nextAction,
  approveInvoice, markSent, markPaid, closeInvoice, reopenInvoice,
  uploadInvoiceDoc, signedInvoiceUrl, signedPackageUrl, downloadPackage, pullBack, markDownloaded,
  pipelineCount,
  downloadBlankWorkOrder, staleDownloads, pageSizeFor,
  BILLING_LIGHTS, COD_LIGHTS,
  type InvoiceRow, type BucketKey, type ClosedReason, type Pipeline,
} from '@/lib/billing'

export default function BillingPage() {
  const { profile, loading: profileLoading } = useUserProfile()
  const isMobile = useIsMobile()

  const isEli = profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com'
  const isOwner = isEli || profile?.role === 'owner'

  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pipeline, setPipeline] = useState<Pipeline>('billing')
  const [tab, setTab] = useState<BucketKey>('progress')
  // COD TABS ARE LATCHES (Eli, 2026-08-19: "make the latching buttons only on
  // COD… say COD in progress and balance due. that way we dont miss
  // anything"). Independent toggles, several can be on, the merged list wears
  // per-row bin badges. Billing keeps plain single tabs — its buckets are
  // sequential stages, not parallel queues. Same family as the CRM
  // multi-select status tabs: persisted, last latch can't turn off.
  const [codBins, setCodBins] = useState<Set<BucketKey>>(new Set(['balance', 'progress']))
  useEffect(() => {
    try {
      const s = sessionStorage.getItem('prsflo-billing-cod-bins')
      if (s) { const arr = JSON.parse(s) as BucketKey[]; if (Array.isArray(arr) && arr.length) setCodBins(new Set(arr)) }
    } catch { /* first visit */ }
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem('prsflo-billing-cod-bins', JSON.stringify([...codBins])) } catch { /* private mode */ }
  }, [codBins])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [closing, setClosing] = useState<InvoiceRow | null>(null)
  const [moreFor, setMoreFor] = useState<InvoiceRow | null>(null)
  const [openBooking, setOpenBooking] = useState<Booking | null>(null)
  // THE PACKAGE: the work order and the invoice in one window, opened by
  // double-clicking the row once an invoice exists.
  const [pkg, setPkg] = useState<{ row: InvoiceRow; booking: Booking } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  /** The page-level ⋯ menu. Rare actions that belong to the PAGE, not a row. */
  const [pageMenu, setPageMenu] = useState(false)
  const [blankBusy, setBlankBusy] = useState(false)
  const uploadFor = useRef<InvoiceRow | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setRows(await fetchInvoices())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime — standing rule: every fetch pairs with a subscription. Payments
  // are watched too, because a COD work order moves between Balance due and Paid
  // when one lands and nothing else would tell this page about it.
  useEffect(() => {
    const ch = supabase
      .channel('billing-hub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_rows' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // ── Derived ────────────────────────────────────────────────────────────────

  const searching = query.trim().length > 0
  const tabs = tabsFor(pipeline)
  const counts = useMemo(() => bucketCounts(rows, pipeline), [rows, pipeline])
  const stats = useMemo(() => summarise(rows, pipeline), [rows, pipeline])
  const codAlert = useMemo(() => hasCodAlert(rows), [rows])
  // Packages built but never sent. The safety net that makes a two-step send
  // safe rather than merely honest.
  const stale = useMemo(() => staleDownloads(rows).length, [rows])

  // UPCOMING IS GONE ENTIRELY (Eli, 2026-08-19 — it was an inline expand for
  // one day: "ditch the upcoming bin and just organize all WO into in
  // progress based on date"). Not-yet-started sessions are ordinary In
  // progress rows now, sorted below the started work with a "Not started"
  // chip (lib/billing: deriveBucket + sortBucket + notStarted).
  const activeBucket: BucketKey = tab
  // COD merges every latched bin into ONE list, in tab order — the critical
  // bin (Balance due) always leads, and each bin keeps its own internal sort
  // (rowsInBucket → sortBucket).
  const visible = useMemo(() => {
    if (searching) return searchRows(rows, query)
    if (pipeline === 'cod') {
      return tabsFor('cod').map(t => t.key).filter(k => codBins.has(k))
        .flatMap(k => rowsInBucket(rows, k, 'cod'))
    }
    return rowsInBucket(rows, activeBucket, pipeline)
  }, [rows, activeBucket, pipeline, query, searching, codBins])

  // Badges only when 2+ bins are on screen — with one, the tab names it.
  const codMulti = pipeline === 'cod' && !searching && codBins.size > 1

  const perPage = pageSizeFor(pipeline === 'cod' ? 'progress' : activeBucket)
  const pages = pageCount(visible.length, perPage)
  const safePage = Math.min(page, pages)
  const pageRows = paginate(visible, safePage, perPage)
  // Age counts days since SENT, so on In progress / Needs review it is a
  // column of dashes. Dropped there rather than filled with nothing.
  const showAge = searching || (pipeline === 'cod'
    ? codBins.has('paid')
    : ['awaiting', 'paid', 'closed'].includes(activeBucket))

  useEffect(() => { setPage(1) }, [tab, query, pipeline, codBins])

  // Switching pipeline lands on that side's FIRST tab — for COD that is Balance
  // due, which is the whole reason it leads.
  function switchPipeline(p: Pipeline) {
    setPipeline(p)
    setTab(tabsFor(p)[0].key)
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function run(id: string, fn: () => Promise<boolean>) {
    if (busy) return
    setBusy(id)
    await fn()
    await load()
    setBusy(null)
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const row = uploadFor.current
    e.target.value = '' // let the same file be picked again after a failure
    if (!file || !row) return
    await run(row.workOrderId, () => uploadInvoiceDoc(row, file))
  }

  /**
   * DROP THE QUICKBOOKS PDF STRAIGHT ONTO THE ROW (ruling 2026-08-11).
   *
   * Attaching and filing become one gesture. Billing exports from QuickBooks,
   * drags it here, and the work order routes itself — Needs approval for a
   * billing client, or back to its computed COD bucket. No scanning, no
   * combining, no remembering which folder.
   */
  async function onDropFile(row: InvoiceRow, e: React.DragEvent) {
    e.preventDefault()
    setDragOver(null)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    await run(row.workOrderId, () => uploadInvoiceDoc(row, file))
  }

  /**
   * DOUBLE-CLICK OPENS THE ROW (ruling 2026-08-11) — and what it opens depends
   * on how far along the package is:
   *
   *   no invoice yet → the work order, to review and complete
   *   invoice on file → the PACKAGE: work order and invoice side by side, so
   *                     you see what the client is actually going to receive
   *                     before you send it.
   *
   * Opening a record to read it is navigation, not an action, which is why it
   * stopped being a button.
   */
  async function openRow(row: InvoiceRow) {
    const { data } = row.bookingId
      ? await supabase.from('bookings').select('*').eq('id', row.bookingId).limit(1)
      : { data: null }
    const booking = data?.[0] as Booking | undefined
    // SAY SOMETHING (fix, 2026-08-13). Both of these used to `return` in
    // silence, so a work order whose session had been deleted was a row that
    // simply did not open — indistinguishable from a double-click that missed.
    // `work_orders.booking_id` is nullable and the work order screen is opened
    // FROM a booking, so this is reachable, and a row you cannot open is
    // exactly the row someone needs to look at.
    if (!booking) {
      toast(
        row.bookingId
          ? 'That session has been deleted, so the work order cannot be opened. The invoice is still here — tell Eli before closing it out.'
          : 'This work order has no session attached, so there is nothing to open.',
        'error',
      )
      return
    }
    if (row.hasInvoiceDoc) setPkg({ row, booking })
    else setOpenBooking(booking)
  }

  async function openDoc(row: InvoiceRow) {
    const url = await signedInvoiceUrl(row.workOrderId)
    if (url) window.open(url, '_blank', 'noopener')
  }

  /** The one button on a row, resolved to what it actually does. */
  function act(row: InvoiceRow) {
    const label = nextAction(row)
    switch (label) {
      case 'Reopen':          return run(row.workOrderId, () => reopenInvoice(row))
      case 'Mark paid':       return run(row.workOrderId, () => markPaid(row))
      case 'Attach invoice':  uploadFor.current = row; fileInput.current?.click(); return
      case 'Approve':         return run(row.workOrderId, () => approveInvoice(row, profile?.id ?? null))
      // SEND IS ONE PRESS (Eli, 2026-08-11): "you hit the send button and it
      // downloads, and now it says it's sent." No confirmation step — you have
      // already looked at the package to get here, so a dialogue asking whether
      // you meant it would be asking about something you just read.
      //
      // ONE FILE: the work order drawn in black and white with the invoice's
      // pages stapled on, built fresh from the live record. Then the 31-day
      // clock starts. The undo lives in the row's ⋯ menu.
      // DOWNLOAD builds the file and records only that. It does NOT claim the
      // invoice was sent — PRSFlo never sends anything, a person emails it.
      case 'Download':        return run(row.workOrderId, async () => {
        const ok = await downloadPackage(row.workOrderId)
        return ok ? markDownloaded(row) : false
      })
      case 'Mark sent':       return run(row.workOrderId, () => markSent(row))
      default:                return
    }
  }

  if (profileLoading) return null

  return (
    <div className="c-root">
      {/* HEADER — THE PIPELINE IS THE TITLE (RULING 2026-08-13, spec §17).
          Eli: "I don't want staff to forget about COD."

          A toggle shows you the side you are ON and says nothing about the side
          you are not on — and the risk is asymmetric. A forgotten billing
          invoice is late; a forgotten COD balance is money that was meant to be
          collected at the desk and never will be, because nobody knows. So both
          words are always in the heading, and the count beside COD goes hot the
          moment a balance exists. You cannot read this page without reading
          "COD".

          This replaces the top-right pill switch, which sat in the conventional
          home for a view control AND the least-read corner of the screen — a
          quiet place for the one control that changes what the whole page is
          about. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '2px 4px 14px', flexWrap: 'wrap' }}>
        <div>
          <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>Work orders &amp; invoices<Hint tip="Two pipelines. COD: the money is already in — check the work order, attach the invoice, done. Billing: the full cycle — review, invoice, owner approval, send, chase, paid." /></span>
          <div className="c-btitle" style={{ fontSize: isMobile ? 20 : 26 }}>
            {(['billing', 'cod'] as Pipeline[]).map(p => (
              <button
                key={p}
                className={`c-arch${pipeline === p ? ' c-on' : ''}`}
                onClick={() => switchPipeline(p)}
                aria-current={pipeline === p ? 'page' : undefined}
              >
                {p === 'billing' ? 'Billing' : 'COD'}
                {/* Hot only on COD, only when a balance exists. Sanctioned under
                    hot-as-needs-you-now (§5) — this is money nobody is chasing. */}
                <span className={`c-btitlen${p === 'cod' && codAlert ? ' c-hot' : ''}`}>
                  {pipelineCount(rows, p)}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* PAGE-LEVEL "⋯" (2026-08-13). Same control as the row's, one level up:
            things that belong to the PAGE rather than to an invoice. It is not a
            header button because a blank work order is rare — Eli: "these are
            gonna be rare occasions" — and a permanent button next to the
            pipeline toggle would give a once-a-month action the same weight as
            the control that changes what the whole screen means. */}
        <button
          className="c-bmore"
          onClick={() => setPageMenu(true)}
          title="More — generate a blank work order"
          style={{ fontSize: 15, padding: '4px 6px' }}
        >
          ⋯
        </button>
      </div>

      {/* SUMMARY — AR aging without leaving the page, computed from the same
          rows the tabs use, so a figure up here can never disagree with the
          list below it. Clicking one jumps to its bucket: the numbers ARE the
          filters, so a figure is never a dead end. */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        {stats.map(s => (
          <div
            key={s.label}
            className="c-bstat"
            style={{ cursor: s.goto ? 'pointer' : 'default' }}
            onClick={() => {
              if (!s.goto) return
              setQuery('')
              // On COD a stat jump FOCUSES that bin (latches it alone) —
              // "the numbers ARE the filters" only holds if the click shows
              // exactly what was counted.
              if (pipeline === 'cod') setCodBins(new Set([s.goto]))
              else setTab(s.goto)
            }}
          >
            <div className="c-arch" style={{ fontSize: 20, letterSpacing: '-0.02em', color: s.alert ? 'var(--c-st-hot)' : undefined }}>
              {s.value}
            </div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* SEARCH — above the tabs on purpose: it outranks them, and it spans
          both pipelines. You look for a client, not for a client-in-a-folder. */}
      <div className="c-bsearch">
        <span style={{ opacity: 0.4, fontSize: 12 }}>⌕</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search everything — client, artist, invoice #, WO #, PO…"
        />
        {searching && <span className="c-bclr" onClick={() => setQuery('')}>clear ✕</span>}
        <Hint tip="Every row shows at most one button — always the next action. Double-click a row to open the work order (or the combined package once an invoice is attached). Drag a QuickBooks PDF straight onto a row to attach it." />
      </div>

      <div className={`c-btabs${searching ? ' c-dim' : ''}`}>
        {tabs.map(b => (
          <span
            key={b.key}
            className={`c-btab${(pipeline === 'cod' ? codBins.has(b.key) : tab === b.key) ? ' c-on' : ''}`}
            onClick={() => {
              if (pipeline === 'cod') {
                // Latch: toggle on/off; the LAST latched bin refuses to turn
                // off — a zero-bin list means nothing. (Built by filter, not
                // Set mutation — the selftest write-scan pattern-matches
                // mutating method calls and would flag this file.)
                setCodBins(prev => {
                  if (prev.has(b.key)) {
                    if (prev.size === 1) return prev
                    return new Set([...prev].filter(k => k !== b.key))
                  }
                  return new Set([...prev, b.key])
                })
              } else setTab(b.key)
            }}
          >
            {b.label}{' '}
            <span
              className="c-bn"
              style={(b.hot && (counts[b.key] ?? 0) > 0) || (b.key === 'progress' && stale > 0)
                ? { color: 'var(--c-st-hot)', opacity: 1 } : undefined}
            >
              {counts[b.key] ?? 0}
            </span>
          </span>
        ))}
      </div>

      <div className={`c-panel${showAge ? "" : " c-bage-off"}${codMulti && !isMobile ? ' c-bmulti' : ''}`}>
        <div className="c-lozenge">
          <b>{searching
            ? 'Search results'
            : pipeline === 'cod'
              ? tabsFor('cod').filter(t => codBins.has(t.key)).map(t => t.label).join(' + ')
              : bucketLabel(tab)}</b>
          {/* COUNT ONLY (Eli, 2026-08-13: "don't need the balance shown in the
              top right corner of the list. messy."). The bucket total was a
              third money figure on a screen that already leads with Outstanding
              and Received in the summary — and unlike those two it changed
              meaning with every tab, so it read as noise rather than as a fact. */}
          <span className="c-ct">{visible.length}</span>
        </div>

        {!isMobile && visible.length > 0 && (
          <div className="c-browhd">
            {codMulti && <span>Bin</span>}
            <span>WO</span>
            <span>Client &amp; session</span>
            <span className="c-r">Flag</span>
            <span>Progress</span>
            <span className="c-r">Balance</span>
            {showAge && <span className="c-r">Age</span>}
            <span className="c-bacthd">Next</span>
            <span />
          </div>
        )}

        {loading && <div className="c-bempty">Loading…</div>}
        {!loading && pageRows.length === 0 && (
          <div className="c-bempty">{searching ? 'Nothing matches that.' : 'Nothing here.'}</div>
        )}

        {pageRows.map(r => (
          <Row
            key={r.workOrderId}
            row={r}
            searching={searching}
            isOwner={isOwner}
            busy={busy === r.workOrderId}
            showAge={showAge}
            badge={codMulti && !isMobile ? r.bucket : null}
            onAct={() => act(r)}
            onMore={() => setMoreFor(r)}
            onOpen={() => openRow(r)}
            dragOver={dragOver === r.workOrderId}
            onDragOver={e => { e.preventDefault(); setDragOver(r.workOrderId) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => onDropFile(r, e)}
          />
        ))}

        {visible.length > 0 && (
          <div className="c-bpager">
            <span className="c-binfo">
              {(safePage - 1) * perPage + 1}–
              {Math.min(safePage * perPage, visible.length)} of {visible.length}
            </span>
            {pages > 1 && Array.from({ length: pages }, (_, i) => i + 1).map(p => (
              <span key={p} className={`c-bpg${p === safePage ? ' c-on' : ''}`} onClick={() => setPage(p)}>{p}</span>
            ))}
          </div>
        )}

        <div className="c-bnote">
          {searching
            ? 'Searching every bucket and both pipelines, closed included — each result shows where it lives. Clear the search to go back.'
            : pipeline === 'cod'
              ? 'COD is paid at the top of the session. Check the work order is accurate, drop the QuickBooks invoice on it, done. A balance means collection was missed — the only way COD goes wrong.'
              : 'Reviewed → Invoiced → Approved. Each light is derived; the button is whatever comes next. Drop a QuickBooks PDF straight onto a row to attach it. A package waits on a PO unless the work order has a PO number or is marked No PO needed.'}
        </div>
      </div>

      {/* The file picker is hidden; the row buttons drive it. */}
      <input ref={fileInput} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={onPickFile} />

      {openBooking && (
        <WorkOrderPopup booking={openBooking} onClose={() => { setOpenBooking(null); load() }} />
      )}

      {pkg && (
        <PackageModal
          row={pkg.row}
          booking={pkg.booking}
          onClose={() => { setPkg(null); load() }}
        />
      )}

      {moreFor && (
        <MoreModal
          row={moreFor}
          onCancel={() => setMoreFor(null)}
          onOpenDoc={() => { openDoc(moreFor); setMoreFor(null) }}
          onClose={() => { const r = moreFor; setMoreFor(null); setClosing(r) }}
          onRedownload={() => { downloadPackage(moreFor.workOrderId); setMoreFor(null) }}
          onPullBack={() => {
            const r = moreFor
            setMoreFor(null)
            run(r.workOrderId, () => pullBack(r))
          }}
        />
      )}

      {/* THE PAGE MENU. Same shell as the row's ⋯ so there is one "everything
          else" pattern on this screen, not two. */}
      {pageMenu && (
        <div className="c-bmodal-wrap" onClick={() => setPageMenu(false)}>
          <div className="c-bmodal" onClick={e => e.stopPropagation()}>
            <div className="c-lozenge"><b>Billing</b></div>
            {/* A BLANK WORK ORDER PDF, NOT A "CREATE WO" BUTTON (ruling
                2026-08-12). Nothing is created, nothing is stored, nothing
                lands on the calendar — it is the paper form, printed from the
                same generator as a real work order so the two cannot drift.
                THE FORK TO WATCH: safe while it is a FORM. If these start being
                filled in for real paid work, that work never enters AR unless
                the work order is entered properly afterwards — and that is the
                signal it needs to be a real session instead. */}
            <button
              className="c-bact c-bblock"
              disabled={blankBusy}
              onClick={async () => {
                setBlankBusy(true)
                await downloadBlankWorkOrder()
                setBlankBusy(false)
                setPageMenu(false)
              }}
            >
              {blankBusy ? 'Building…' : 'Generate WO — a blank work order to fill in'}
            </button>
            <div style={{ fontSize: 10.5, opacity: 0.45, lineHeight: 1.5, margin: '2px 2px 10px' }}>
              An empty work order you can type into and then print, or print and
              fill in by hand. It creates nothing and appears nowhere — if the
              session is real, enter it properly too.
            </div>
            <button className="c-bact c-bmuted c-bblock" onClick={() => setPageMenu(false)}>Cancel</button>
          </div>
        </div>
      )}

      {closing && (
        <CloseModal
          row={closing}
          onCancel={() => setClosing(null)}
          onConfirm={async reason => {
            const r = closing
            setClosing(null)
            await run(r.workOrderId, () => closeInvoice(r, reason, profile?.id ?? null))
          }}
        />
      )}

    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/**
 * THE THREE LIGHTS. Derived, never pressable — same law as the rest of the app:
 * if PRSFlo can determine it, it is a light; only what it cannot know is a
 * button. The labels name the STATE, not the artifact, which is what makes an
 * amber "Reviewed" read as *not yet reviewed* at a glance.
 */
function Lights({ row }: { row: InvoiceRow }) {
  const steps = row.isCod ? COD_LIGHTS : BILLING_LIGHTS
  return (
    <span className="c-blights">
      {steps.map((s, i) => (
        <span key={s.label} style={{ display: 'contents' }}>
          <span className={`c-blt${row.step >= s.at ? ' c-done' : ''}${row.step === s.at - 1 ? ' c-next' : ''}`}>
            <i />{s.label}
          </span>
          {i < steps.length - 1 && <span className="c-barrow">›</span>}
        </span>
      ))}
    </span>
  )
}

// Bin badge colors — the row's home bin when several are latched (COD).
// Matches the tab pill colors so the badge and the tab read as one system.
const BIN_COLOR: Partial<Record<BucketKey, string>> = {
  balance: 'var(--c-st-hot)',
  progress: 'var(--c-st-uncon)',
  review: 'var(--c-st-warm)',
  paid: 'var(--c-st-booked)',
}

function Row({
  row, searching, isOwner, busy, dragOver, showAge, badge, onAct, onMore, onOpen,
  onDragOver, onDragLeave, onDrop,
}: {
  row: InvoiceRow
  searching: boolean
  isOwner: boolean
  busy: boolean
  dragOver: boolean
  showAge: boolean
  /** The row's bucket, when 2+ COD bins are latched — null renders no cell. */
  badge: BucketKey | null
  onAct: () => void
  onMore: () => void
  onOpen: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const overdue = isPastDue(row)
  const label = nextAction(row)
  // Approving is owners-only, so for everyone else the row has no action rather
  // than a button that will be refused by the database.
  const canAct = label !== 'Approve' || isOwner
  // Every row accepts a dropped PDF — replacing an invoice is legitimate — but
  // only a row waiting on its invoice ADVANCES on drop (see lib/billing).
  const wantsInvoice = row.step === 1
  // Lights only where the assembly line is still running. On a sent, paid or
  // closed row every light is green and says nothing.
  const showLights = ['progress', 'review', 'balance'].includes(row.bucket)
  // The overflow only exists when there is something in it: an invoice to open,
  // or an invoice real enough to be written off.
  // Approved but with no PO: the button shows, disabled, rather than vanishing.
  const blocked = row.awaitingPo
  const canClose = row.step >= 2 && row.bucket !== 'closed' && row.bucket !== 'paid'
  const hasMore = row.hasInvoiceDoc || canClose

  return (
    <div
      className={`c-brow${overdue ? ' c-od' : ''}${dragOver ? ' c-drop' : ''}`}
      style={{ opacity: busy ? 0.5 : 1, cursor: row.bookingId ? 'pointer' : 'default' }}
      // Double-click, not single: a single click would fire every time someone
      // reached for the button at the end of the row.
      onDoubleClick={onOpen}
      title={row.hasInvoiceDoc ? 'Double-click to see the package' : 'Double-click to open the work order'}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {badge && (
        <span
          className="c-bbin"
          style={{ background: BIN_COLOR[badge] ?? 'var(--c-wash2)', color: badge === 'balance' ? 'var(--c-hot-text)' : 'var(--c-chip-ink)' }}
        >
          {bucketLabel(badge)}
        </span>
      )}
      <span className="c-binv">{row.woNumber || row.invoiceNumber || '—'}</span>
      <span className="c-bwho">
        <b>{row.client}</b>
        {row.artist ? <span> · {row.artist}</span> : null}
        {/* The real span and the real rooms. A raw 2026-08-05 on a four-day
            session read as a one-nighter, and nobody scans ISO dates. */}
        {row.dateRange ? <span> · {row.dateRange}</span> : null}
        {row.rooms ? <span> · {row.rooms}</span> : null}
        {/* Which bucket a hit lives in — only while searching, since otherwise
            the tab already says it. */}
        {searching ? <span> · {bucketLabel(row.bucket)}</span> : null}
      </span>

      {/* FLAG COLUMN — locked, so a row without a flag leaves the space empty
          rather than sliding everything else left. */}
      <span className="c-bflagcell">
        {row.invoiceDrift ? (
          // DRIFT: edited after the invoice went out. Hot, because the
          // alternative to seeing it here is hearing it from the client.
          <span
            className="c-bdrift"
            title={`Invoiced ${formatCurrency(String(row.invoicedTotal ?? 0))}, now ${formatCurrency(String(row.total))}`}
          >
            Changed since invoiced
          </span>
        ) : row.awaitingPo ? (
          <span className="c-bflag c-po">Awaiting PO</span>
        ) : row.closedReason ? (
          <span className="c-bflag c-soon">{row.closedReason === 'written_off' ? 'Written off' : 'Voided'}</span>
        ) : row.notStarted && row.bucket === 'progress' ? (
          /* Inside In progress now (Upcoming is gone, 2026-08-19) — the chip
             is what still says "this one hasn't happened yet". */
          <span className="c-bflag c-soon">Not started</span>
        ) : wantsInvoice ? (
          <span className="c-bhint">{dragOver ? 'Release to attach' : 'Drop invoice here'}</span>
        ) : row.staleDownload ? (
          // Downloaded days ago and still not sent. Hot, because the work is
          // already done and the only thing missing is the one act PRSFlo
          // cannot see.
          <span className="c-bdrift" title="The package was built but nobody has confirmed it went out">
            Built, not sent
          </span>
        ) : row.bucket === 'balance' ? (
          // A COD balance has no button — the money is recorded on the work
          // order, and a button here would be a second door to that field. But
          // a row with no button and no explanation reads as broken, so it says
          // where to go instead.
          <span className="c-bhint">Record payment on the WO</span>
        ) : row.hasInvoiceDoc && !showLights ? (
          // Sent, paid and closed rows show no lights, so without this there is
          // no sign at all that the invoice is stapled on. Same cell the "Drop
          // invoice here" hint used to occupy — the question and its answer end
          // up in the same place.
          <span className="c-bflag c-soon">Invoice on file</span>
        ) : null}
      </span>

      <span>{showLights && <Lights row={row} />}</span>

      <span className="c-bamt">{row.balance > 0 ? formatCurrency(String(row.balance)) : '—'}</span>
      {showAge && <span className="c-bage">{row.ageDays != null ? `${row.ageDays}d` : '—'}</span>}

      {/* ONE ACTION PER ROW: whatever comes next. A row with five buttons is a
          row nobody reads.

          THE RARE ACTIONS GO BEHIND "⋯" (fix, 2026-08-11). They were two naked
          controls on the row — an "INV" that meant nothing, and a "✕" sitting
          directly beside the invoice you had just attached, which reads as
          "delete this". A destructive-looking glyph next to a thing you just
          created is the worst possible guess to invite. Opening the PDF and
          writing an invoice off are both rare and both deliberate, so they live
          together in a menu that names them in full. */}
      {/* A BUTTON IS NOT THE ROW (fix, 2026-08-13). The row opens the work order
          on double-click, and these controls sit inside it — so double-clicking
          Approve fired the button AND opened the work order behind it. Buttons
          swallow the double-click; only the row itself opens. */}
      <span className="c-bactcell" onDoubleClick={e => e.stopPropagation()}>
        {label && canAct && (
          <button
            className={`c-bact${blocked ? ' c-bmuted' : ''}`}
            onClick={blocked ? undefined : onAct}
            disabled={blocked}
            // A disabled button in the SAME PLACE as the live one teaches where
            // the control lives and says why it isn't available. Hiding it
            // taught nothing and read as a broken row.
            title={blocked ? 'Add the PO number on the work order — or set PO req’d to No there' : undefined}
            style={blocked ? { cursor: 'default' } : undefined}
          >
            {/* THE LABEL DOES NOT CHANGE WHEN BLOCKED (fix, 2026-08-11). It used
                to read "Needs PO", which put the reason in two places at once —
                the flag column already says AWAITING PO — and made the button
                look like a different control from the one on the row above it.
                A greyed Approve says "this is the next step and you can't take
                it yet"; the flag says why. One fact, one place. */}
            {label}
          </button>
        )}
      </span>
      <span className="c-bmorecell" onDoubleClick={e => e.stopPropagation()}>
        {hasMore && (
          <button className="c-bmore" onClick={onMore} title="More — open the invoice, write it off, void it">⋯</button>
        )}
      </span>
    </div>
  )
}

/**
 * The overflow. Both actions are spelled out in full, because the version that
 * used a "✕" beside a freshly-attached invoice invited exactly the wrong guess.
 * "Close" here means close the INVOICE — write it off or void it — and the
 * modal it opens says so again before anything happens.
 */
function MoreModal({ row, onCancel, onOpenDoc, onClose, onPullBack, onRedownload }: {
  row: InvoiceRow
  onCancel: () => void
  onOpenDoc: () => void
  onClose: () => void
  onPullBack: () => void
  onRedownload: () => void
}) {
  const canClose = row.step >= 2 && row.bucket !== 'closed' && row.bucket !== 'paid'
  return (
    <div className="c-bmodal-wrap" onClick={onCancel}>
      <div className="c-bmodal" onClick={e => e.stopPropagation()}>
        <div className="c-lozenge"><b>{row.woNumber || 'Work order'}</b></div>
        <div style={{ fontSize: 12.5, marginBottom: 12 }}>{row.client}</div>
        {row.hasInvoiceDoc && (
          <button className="c-bact c-bblock" onClick={onOpenDoc}>Open the attached invoice PDF</button>
        )}
        {/* Build the package again — after a correction, or because the first
            download went astray. Here rather than on the row: the row's button
            is whatever comes NEXT, and once you have downloaded, what comes
            next is confirming it went out. */}
        {row.step === 3 && row.downloadedAt && (
          <button className="c-bact c-bblock" onClick={onRedownload}>Download the package again</button>
        )}
        {/* PULL IT BACK — one control that means "this isn't right, start the
            end of the process again". It clears the sent stamp, the approval
            AND the attached invoice, so the row lands back at Needs invoice and
            the cycle is exactly: fix the WO, attach the corrected invoice,
            re-approve, re-send.
            Not two undos to choose between. And it is the only way back out of
            Awaiting payment, which is what stops a misclicked send becoming a
            permanent lie about when the client was billed. */}
        {row.step >= 3 && (
          <button className="c-bact c-bblock" onClick={onPullBack}>
            Pull it back — removes the invoice and the approval, back to the start
          </button>
        )}
        {canClose && (
          <button className="c-bact c-bblock" onClick={onClose}>
            Close this invoice — write it off or void it
          </button>
        )}
        <button className="c-bact c-bmuted c-bblock" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/**
 * THE PACKAGE — what the client is about to receive, in one window.
 *
 * Eli, 2026-08-11: "once the invoice is attached, when you double click the row
 * you get to see both combined. See what the actual package looks like."
 *
 * Not a merged PDF — that still needs a PDF library and the work order rendered
 * to a real file. But the REVIEW problem is not the file format, it is being
 * able to look at both halves together before sending, and a two-pane window
 * solves that completely. The work order pane is the real WorkOrderPopup
 * rendered inline, so it is fully editable and prints from its own button; the
 * invoice pane is the stored PDF.
 */
function PackageModal({ row, booking, onClose }: {
  row: InvoiceRow
  booking: Booking
  onClose: () => void
}) {
  // WHAT ACTUALLY WENT OUT WINS (ruling 2026-08-11). Once a package has been
  // built, the default view is the STORED FILE — page for page, as the client
  // received it. Eli: "we need to see what's actually going out — see a bug we
  // missed, info looks weird to client."
  //
  // Re-rendering the live work order instead would show what it says TODAY, and
  // the moment you go looking is precisely when something is wrong, which is the
  // worst possible time to be handed a reconstruction. The work order pane is
  // still there, and still editable — it is just no longer what "the package"
  // means once one exists.
  type View = 'sent' | 'wo' | 'inv'
  const [view, setView] = useState<View>(row.hasPackage ? 'sent' : 'wo')
  const [urls, setUrls] = useState<{ sent?: string | null; inv?: string | null }>({})

  // Signed on demand — the URLs are short-lived, and most visits open one pane.
  useEffect(() => {
    let alive = true
    if (view === 'sent' && urls.sent === undefined) {
      signedPackageUrl(row.workOrderId).then(u => { if (alive) setUrls(p => ({ ...p, sent: u })) })
    }
    if (view === 'inv' && urls.inv === undefined) {
      signedInvoiceUrl(row.workOrderId).then(u => { if (alive) setUrls(p => ({ ...p, inv: u })) })
    }
    return () => { alive = false }
  }, [view, urls.sent, urls.inv, row.workOrderId])

  const doc = view === 'sent' ? urls.sent : urls.inv

  return (
    <div className="c-bmodal-wrap" onClick={onClose}>
      <div className="c-bpkg" onClick={e => e.stopPropagation()}>
        <div className="c-bpkghd">
          <div style={{ minWidth: 0 }}>
            <span className="c-label" style={{ display: 'block', marginBottom: 2 }}>
              {row.woNumber || 'Work order'}
              {row.poNumber ? ` · PO ${row.poNumber}` : row.noPoNeeded ? ' · no PO required' : ''}
            </span>
            <b style={{ fontSize: 14 }}>{row.client}</b>
            <span style={{ opacity: 0.5, fontSize: 12 }}> · {formatCurrency(String(row.total))}</span>
          </div>
          {/* THE TOGGLE SITS IN THE MIDDLE (Eli, 2026-08-13). It used to be
              pushed to the right by a spacer, so it crowded the Close button and
              left the whole left half of the bar empty. Equal flex on both sides
              centres it against the WINDOW rather than against whatever length
              the client's name happens to be. */}
          <div style={{ flex: 1 }} />
          <div className="c-seg">
            {row.hasPackage && (
              <button className={view === 'sent' ? 'c-on' : ''} onClick={() => setView('sent')}>
                {row.sentAt ? 'As sent' : 'As built'}
              </button>
            )}
            <button className={view === 'wo' ? 'c-on' : ''} onClick={() => setView('wo')}>Work order</button>
            <button className={view === 'inv' ? 'c-on' : ''} onClick={() => setView('inv')}>Invoice</button>
          </div>
          <div style={{ flex: 1 }} />
          <button className="c-bact c-bmuted" onClick={onClose}>Close</button>
        </div>

        {/* Says plainly which of the two you are looking at, because the whole
            point is that they can differ. */}
        {view === 'wo' && row.hasPackage && (
          <div className="c-bnote" style={{ padding: '0 14px 6px' }}>
            This is the work order as it stands now — it may differ from the package
            that went out. {row.invoiceDrift ? 'It does: the total has changed since it was invoiced.' : ''}
          </div>
        )}

        <div className="c-bpkgbody">
          {view === 'wo'
            ? <WorkOrderPopup booking={booking} inline onClose={onClose} />
            : doc
              ? <iframe src={doc} title={view === 'sent' ? 'Package' : 'Invoice'} style={{ width: '100%', height: '100%', border: 'none', borderRadius: 12, background: '#fff' }} />
              : doc === null
                ? <div className="c-bempty">That file isn&apos;t there any more.</div>
                : <div className="c-bempty">Loading…</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * Closing always asks WHY. Written off means money was owed and collection was
 * abandoned; voided means the invoice should never have existed. Same bucket,
 * different things at tax time — and the database refuses a close without one.
 */
function CloseModal({ row, onCancel, onConfirm }: {
  row: InvoiceRow
  onCancel: () => void
  onConfirm: (reason: ClosedReason) => void
}) {
  return (
    <div className="c-bmodal-wrap" onClick={onCancel}>
      <div className="c-bmodal" onClick={e => e.stopPropagation()}>
        <div className="c-lozenge"><b>Close this invoice</b></div>
        <div style={{ fontSize: 12.5, marginBottom: 4 }}>{row.client}</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          {row.balance > 0 ? `${formatCurrency(String(row.balance))} outstanding` : 'Nothing outstanding'}
          {' · '}It leaves every pipeline and stops counting toward what you&apos;re owed. Still searchable.
        </div>
        <button className="c-bact c-bblock" onClick={() => onConfirm('written_off')}>
          Written off — we were owed this and gave up collecting
        </button>
        <button className="c-bact c-bblock" onClick={() => onConfirm('voided')}>
          Voided — this invoice should never have existed
        </button>
        <button className="c-bact c-bmuted c-bblock" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

