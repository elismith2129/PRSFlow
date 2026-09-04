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
//   · CLICK THE ROW to open it (single click since 2026-09-01). No Open-WO
//     button — opening a record to read it is navigation, not an action.
//     Before the invoice it opens the work order; after, it opens the PACKAGE
//     (both documents, one window).
//   · THE STAGE BADGE REPLACED THE LIGHTS on the billing side (Eli,
//     2026-09-03, mock billing-badges-po-simple.html): one badge names where
//     the row is; the button column is only ever the next real act — Add PO,
//     Download, Mark sent, Mark paid. Approve lives in the strip; Attach and
//     re-queue are the drop gesture.
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
import { useWoInvoicesVersion } from '@/hooks/useWoInvoicesVersion'
import { formatCurrency } from '@/lib/format'
import { toast } from '@/components/ui/Toaster'
import { Hint } from '@/components/ui/Hint'
import { FinancialsView } from '@/components/billing/FinancialsView'
import { TenantsView } from '@/components/billing/TenantsView'
import {
  fetchInvoices, searchRows, rowsInBucket, bucketCounts, paginate,
  pageCount, summarise, isPastDue, bucketLabel, tabsFor, hasCodAlert, nextAction,
  approveInvoice, rejectInvoice, previewPackageUrl,
  markSent, markPaid, closeInvoice, reopenInvoice,
  uploadInvoiceDoc, signedInvoiceUrl, signedPackageUrl, downloadPackage, pullBack, markDownloaded,
  pipelineCount, recordPoNumber, setNoPoNeeded, billingStage, sortByColumn,
  downloadBlankWorkOrder, staleDownloads, pageSizeFor, approvalQueue,
  BILLING_LIGHTS, COD_LIGHTS,
  type InvoiceRow, type BucketKey, type ClosedReason, type Pipeline,
  type SortCol, type StageKey,
} from '@/lib/billing'

export default function BillingPage() {
  const { profile, loading: profileLoading } = useUserProfile()
  const isMobile = useIsMobile()

  const isEli = profile?.email === 'eli@paramountrecording.com'
  const isOwner = isEli || profile?.role === 'owner'

  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pipeline, setPipeline] = useState<Pipeline>('billing')
  // FINANCIALS IS A THIRD TITLE, NOT A TAB (2026-08-20). The pipeline words ARE
  // the page heading (ruling 2026-08-13), so the one control that changes what
  // the whole screen is about already lives there — putting revenue anywhere
  // else would mean two controls of that kind on one page. It is deliberately
  // NOT a `Pipeline` value: `Pipeline` types the invoice buckets, and revenue
  // history has no bucket, no row and no next action. Widening that union to
  // carry a view mode would put a non-pipeline through every function in
  // lib/billing that switches on it.
  // TENANTS joined the heading 2026-09-02 (rent board + the Mustard shared-
  // runner sheet) — same shape as Financials: a view, deliberately NOT a
  // `Pipeline` value, rendered as its own branch.
  const [view, setView] = useState<'invoices' | 'financials' | 'tenants'>('invoices')
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
  // COLUMN SORT — billing only (Eli, 2026-09-03: sort, never filter). Date
  // desc is the default and the only order that shows the day dividers.
  const [sortCol, setSortCol] = useState<SortCol>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // THE ADD-PO STRIP (Eli, 2026-09-03) — a fold under the row, not a modal.
  // One open at a time; the row id is the key.
  const [poFor, setPoFor] = useState<string | null>(null)
  const [poNum, setPoNum] = useState('')
  const [poFile, setPoFile] = useState<File | null>(null)
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

  // Realtime — standing rule: every fetch pairs with a subscription. Payments
  // are watched because a COD work order moves between Balance due and Paid
  // when one lands and nothing else would tell this page about it.
  //
  // SHARED CHANNEL (2026-09-01): the Rail's Billing badge and the dashboard's
  // approvals banner watch the same tables now, so the page's own
  // 'billing-hub' channel became `useWoInvoicesVersion` — one channel among
  // the three surfaces, per the standing rule against duplicate channels on
  // one table per page. The version effect also runs on mount, so it carries
  // the initial load too.
  const woVersion = useWoInvoicesVersion()
  useEffect(() => { load() }, [load, woVersion])

  // ── Derived ────────────────────────────────────────────────────────────────

  const searching = query.trim().length > 0
  const tabs = tabsFor(pipeline)
  const counts = useMemo(() => bucketCounts(rows, pipeline), [rows, pipeline])
  const stats = useMemo(() => summarise(rows, pipeline), [rows, pipeline])
  const codAlert = useMemo(() => hasCodAlert(rows), [rows])
  // Packages built but never sent. The safety net that makes a two-step send
  // safe rather than merely honest.
  const stale = useMemo(() => staleDownloads(rows).length, [rows])
  // The green-dot sweep (Eli, 2026-09-01) — the rows whose button says
  // Approve, fronted for owners. Same derivation as the Rail badge and the
  // dashboard banner (lib/billing approvalQueue), so the three always agree.
  const approvals = useMemo(() => approvalQueue(rows), [rows])

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
    // Billing sorts by the clicked column (date desc default). This replaces
    // sortBucket's started-work-first order on the billing side — the day
    // dividers + the In-progress badge carry that information now.
    return sortByColumn(rowsInBucket(rows, activeBucket, pipeline), sortCol, sortDir)
  }, [rows, activeBucket, pipeline, query, searching, codBins, sortCol, sortDir])

  // Badges only when 2+ bins are on screen — with one, the tab names it.
  const codMulti = pipeline === 'cod' && !searching && codBins.size > 1
  // THE STAGE LAYOUT (Eli, 2026-09-03): billing rows lead with a stage badge
  // and drop the three lights. Search gets it too — results mix pipelines, so
  // billing hits wear their stage and COD hits wear their bin, one column.
  const staged = pipeline === 'billing' || searching
  // Day dividers only under date order — over money-ordered rows a date
  // heading lies about what follows it. Billing only; COD's merged bins keep
  // their own internal queue order.
  const dividers = staged && !searching && sortCol === 'date'

  const perPage = pageSizeFor(pipeline === 'cod' ? 'progress' : activeBucket)
  const pages = pageCount(visible.length, perPage)
  const safePage = Math.min(page, pages)
  const pageRows = paginate(visible, safePage, perPage)
  // Age counts days since SENT, so on In progress / Needs review it is a
  // column of dashes. Dropped there rather than filled with nothing.
  const showAge = searching || (pipeline === 'cod'
    ? codBins.has('paid')
    : ['awaiting', 'paid', 'closed'].includes(activeBucket))

  useEffect(() => { setPage(1); setPoFor(null) }, [tab, query, pipeline, codBins])

  // Each tab's default order: Awaiting payment leads with the OLDEST debt
  // (the chase list — sortBucket's old order, kept); Not started reads
  // soonest-first (the next session to happen leads); everything else by date,
  // newest first. Changing tab resets the sort so a Balance sort on one tab
  // doesn't quietly reorder the next.
  useEffect(() => {
    setSortCol(tab === 'awaiting' ? 'age' : 'date')
    setSortDir(tab === 'notstarted' ? 'asc' : 'desc')
  }, [tab, pipeline])

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

  // Who is acting — attach and PO writes log WO history lines now.
  const actor = { id: profile?.id ?? null, name: profile?.display_name || '' }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const row = uploadFor.current
    e.target.value = '' // let the same file be picked again after a failure
    if (!file || !row) return
    await run(row.workOrderId, () => uploadInvoiceDoc(row, file, actor))
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
    await run(row.workOrderId, () => uploadInvoiceDoc(row, file, actor))
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
      case 'Approve':         return run(row.workOrderId, () => approveInvoice(row, profile?.id ?? null, profile?.display_name || undefined))
      // THE PO ARRIVED LATE (Eli, 2026-09-03): open the fold under the row.
      // The strip itself performs the acts (PO → replacement invoice →
      // download); this just opens it.
      case 'Add PO':
        setPoFor(row.workOrderId); setPoNum(row.poNumber ?? ''); setPoFile(null)
        return
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

  /** Sort cycle: desc → asc → back to the date default. */
  function clickSort(c: SortCol) {
    if (sortCol !== c) { setSortCol(c); setSortDir('desc') }
    else if (sortDir === 'desc') setSortDir('asc')
    else { setSortCol('date'); setSortDir('desc') }
  }

  /**
   * ATTACH VIA CLICK — the button is gone (the column stops narrating,
   * 2026-09-03), so the flag cell's "Drop invoice here · or click" opens the
   * same picker the button used to. The drop gesture is unchanged.
   */
  function attachFor(row: InvoiceRow) {
    uploadFor.current = row
    fileInput.current?.click()
  }

  /**
   * THE ADD-PO SAVE (Eli, 2026-09-03) — four acts, one press, in order: the PO
   * onto the work order (same field the WO writes), the re-issued invoice over
   * the attached one (the label usually re-dates it to the PO date — the date
   * lives in the PDF, nothing else to type), then the package builds and
   * downloads. The approval is untouched throughout: the replacement attach no
   * longer re-snapshots the total, so an unchanged-money swap can't drift, and
   * a changed-money one correctly goes back to the owner.
   */
  async function savePoStrip(row: InvoiceRow) {
    const po = poNum.trim()
    if (!po) return
    const file = poFile
    setPoFor(null)
    await run(row.workOrderId, async () => {
      if (!(await recordPoNumber(row, po, actor))) return false
      if (file && !(await uploadInvoiceDoc(row, file, actor))) return false
      const ok = await downloadPackage(row.workOrderId)
      return ok ? markDownloaded(row) : false
    })
  }

  if (profileLoading) return null

  // The heading is shared by both views, so it is built once. Financials is an
  // owner-only word in it — hidden for everyone else, and backed by an
  // owner-only RLS policy on `financial_history`, because a hidden button is
  // presentation and never a boundary.
  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '2px 4px 14px', flexWrap: 'wrap' }}>
      <div>
        <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>
          {view === 'financials'
            ? 'Revenue'
            : view === 'tenants'
              ? <>Rent<Hint tip="One row per tenant room per month: Mark sent (the 25th rent email) → Mark paid → In QB (entered in QuickBooks). Mustard's incidentals line carries the shared-runner hours — solo hours bill full, hours shared with a billed ERS·A session bill half." /></>
              : <>Work orders &amp; invoices<Hint tip="Two pipelines. COD: the money is already in — check the work order, attach the invoice, done. Billing: the full cycle — review, invoice, owner approval, send, chase, paid." /></>}
        </span>
        <div className="c-btitle" style={{ fontSize: isMobile ? 20 : 26 }}>
          {(['billing', 'cod'] as Pipeline[]).map(p => (
            <button
              key={p}
              className={`c-arch${view === 'invoices' && pipeline === p ? ' c-on' : ''}`}
              onClick={() => { setView('invoices'); switchPipeline(p) }}
              aria-current={view === 'invoices' && pipeline === p ? 'page' : undefined}
            >
              {p === 'billing' ? 'Billing' : 'COD'}
              {/* Hot only on COD, only when a balance exists. Sanctioned under
                  hot-as-needs-you-now (§5) — this is money nobody is chasing. */}
              <span className={`c-btitlen${p === 'cod' && codAlert ? ' c-hot' : ''}`}>
                {pipelineCount(rows, p)}
              </span>
            </button>
          ))}
          <button
            className={`c-arch${view === 'tenants' ? ' c-on' : ''}`}
            onClick={() => setView('tenants')}
            aria-current={view === 'tenants' ? 'page' : undefined}
            title="Tenant rent board — what's open, what's paid and when"
          >
            Tenants
          </button>
          {isOwner && (
            <button
              className={`c-arch${view === 'financials' ? ' c-on' : ''}`}
              onClick={() => setView('financials')}
              aria-current={view === 'financials' ? 'page' : undefined}
              title="Revenue over time — owners only"
            >
              Financials
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1 }} />
      {view === 'invoices' && (
        /* PAGE-LEVEL "⋯" (2026-08-13). Same control as the row's, one level up:
           things that belong to the PAGE rather than to an invoice. It is not a
           header button because a blank work order is rare — Eli: "these are
           gonna be rare occasions" — and a permanent button next to the
           pipeline toggle would give a once-a-month action the same weight as
           the control that changes what the whole screen means. */
        <button
          className="c-bmore"
          onClick={() => setPageMenu(true)}
          title="More — generate a blank work order"
          style={{ fontSize: 15, padding: '4px 6px' }}
        >
          ⋯
        </button>
      )}
    </div>
  )

  // Revenue is a different page that happens to live behind the same heading —
  // no search, no buckets, no rows, no modals. Rendering it as a branch rather
  // than threading `view` through the invoice tree keeps the two from acquiring
  // each other's conditionals.
  if (view === 'financials' && isOwner) {
    return (
      <div className="c-root">
        {header}
        <FinancialsView />
      </div>
    )
  }

  // Tenants renders as its own branch for the same reason Financials does —
  // and the early return matters doubly here: it unmounts WorkOrderPopup,
  // which is what makes TenantsView's studio_time_rows channel safe under
  // the one-channel-per-table-per-page rule (see TenantsView header).
  if (view === 'tenants') {
    return (
      <div className="c-root">
        {header}
        <TenantsView />
      </div>
    )
  }

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
          about.

          Since 2026-08-20 the heading also carries FINANCIALS for owners; it is
          built above as `header` because both views wear it. */}
      {header}

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

      {/* THE GREEN-DOT SWEEP (Eli, 2026-09-01 — option D of
          docs/design-refs/billing-approval-notify-options.html). Dropbox's
          "billing invoices need approvals" folder, as a strip: owners only,
          pinned above In progress, one Approve per row — the Finder gesture
          without hunting the list. It FRONTS rows the list below already
          holds, never hides them. Drift ⚠ is the one thing worth reading
          before signing off; the PO chip is informational — since 2026-08-31
          a missing PO blocks sending, not approval. Empty queue = no strip,
          and billing staff never see it (they can't approve). */}
      {/* Shown on BOTH pipelines since 2026-09-01 (COD sessions need the
          owner's sign-off too — the queue mixes both, chip marks COD). On the
          billing side it stays pinned to In progress, where its rows live. */}
      {isOwner && !searching && approvals.length > 0 && (pipeline === 'cod' || tab === 'progress') && (
        <div style={{ borderRadius: 14, background: 'var(--c-wash)', padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
            <span style={{
              minWidth: 19, height: 17, borderRadius: 99, padding: '0 6px',
              fontSize: 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)',
            }}>{approvals.length}</span>
            <span className="c-arch" style={{ fontSize: 12 }}>Ready for your approval</span>
            {!isMobile && (
              <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.45 }}>
                click a row to read the package first
              </span>
            )}
          </div>
          {approvals.map(r => (
            <div
              key={r.workOrderId}
              className="c-panel"
              onClick={() => openRow(r)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', marginTop: 6, cursor: 'pointer' }}
            >
              <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: isMobile ? 0 : 150, flexShrink: 1 }}>
                {r.client}{r.artist ? ` — ${r.artist}` : ''}
              </span>
              {r.isCod && (
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.05em', background: 'var(--c-wash2)', padding: '3px 8px', borderRadius: 99, opacity: 0.8, flexShrink: 0 }}>COD</span>
              )}
              {!isMobile && (
                <span style={{ fontSize: 11, opacity: 0.55 }}>
                  {[r.dateRange, r.rooms].filter(Boolean).join(' · ')}
                </span>
              )}
              {r.awaitingPo && (
                <span
                  title="No PO on the work order yet — approving is fine; sending is what it blocks"
                  style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.05em', background: 'var(--c-wash2)', padding: '3px 8px', borderRadius: 99, opacity: 0.8, flexShrink: 0 }}
                >AWAITING PO</span>
              )}
              <span
                title={r.invoiceDrift ? `The work order changed after the invoice was attached — invoiced ${formatCurrency(String(r.invoicedTotal ?? 0))}, now ${formatCurrency(String(r.total))}. Approving re-snapshots the total.` : undefined}
                style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 12.5, whiteSpace: 'nowrap', color: r.invoiceDrift ? 'var(--c-st-hot)' : undefined }}
              >
                {formatCurrency(String(r.total))}{r.invoiceDrift ? ' ⚠' : ''}
              </span>
              <button
                className="c-bact"
                disabled={busy === r.workOrderId}
                onClick={e => { e.stopPropagation(); run(r.workOrderId, () => approveInvoice(r, profile?.id ?? null, profile?.display_name || undefined)) }}
                onDoubleClick={e => e.stopPropagation()}
              >
                Approve
              </button>
            </div>
          ))}
        </div>
      )}

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
        <Hint tip="Every row shows at most one button — always the next action. Click a row to open the work order (or the combined package once an invoice is attached). Drag a QuickBooks PDF straight onto a row to attach it." />
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

      <div className={`c-panel${showAge ? "" : " c-bage-off"}${codMulti && !isMobile ? ' c-bmulti' : ''}${staged && !isMobile ? ' c-bstaged' : ''}`}>
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

        {!isMobile && visible.length > 0 && (staged ? (
          /* SORTABLE HEADER (Eli, 2026-09-03) — click sorts, click again
             reverses, a third click returns to the default date order (there
             is no Date column to click — the date lives in Client & session).
             Sort ONLY, never filter: the buckets already are the filters.
             "Next" is not sortable — it derives from the step, so sorting by
             it would be Status under a confusing name. Search results keep the
             header as plain labels. */
          <div className="c-browhd">
            <SortHd col="status" label="Status" {...{ searching, sortCol, sortDir, clickSort }} />
            <SortHd col="wo" label="WO" {...{ searching, sortCol, sortDir, clickSort }} />
            <SortHd col="client" label="Client & session" {...{ searching, sortCol, sortDir, clickSort }} />
            <span className="c-r">Flag</span>
            <SortHd col="balance" label="Balance" right {...{ searching, sortCol, sortDir, clickSort }} />
            {showAge && <SortHd col="age" label="Age" right {...{ searching, sortCol, sortDir, clickSort }} />}
            <span className="c-bacthd">Next</span>
            <span />
          </div>
        ) : (
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
        ))}

        {loading && <div className="c-bempty">Loading…</div>}
        {!loading && pageRows.length === 0 && (
          <div className="c-bempty">{searching ? 'Nothing matches that.' : 'Nothing here.'}</div>
        )}

        {pageRows.map((r, i) => (
          <span key={r.workOrderId} style={{ display: 'contents' }}>
            {/* DAY DIVIDER (Eli, 2026-09-03 — the CRM's idiom, grouped by
                session date). Only under date order; a "Sep 2" heading over
                money-ordered rows lies about what follows it. */}
            {dividers && (i === 0 || (pageRows[i - 1].sessionDate ?? '') !== (r.sessionDate ?? '')) && (
              <div className="c-bday">
                <b>{fmtDayHeading(r.sessionDate)}</b><i />
                <u>{pageRows.filter(x => (x.sessionDate ?? '') === (r.sessionDate ?? '')).length} session{pageRows.filter(x => (x.sessionDate ?? '') === (r.sessionDate ?? '')).length === 1 ? '' : 's'}</u>
              </div>
            )}
            <Row
              row={r}
              searching={searching}
              isOwner={isOwner}
              busy={busy === r.workOrderId}
              showAge={showAge}
              badge={codMulti && !isMobile ? r.bucket : null}
              stage={staged && !r.isCod ? billingStage(r) : null}
              codBin={staged && r.isCod ? r.bucket : null}
              onAct={() => act(r)}
              onAttach={() => attachFor(r)}
              onMore={() => setMoreFor(r)}
              onOpen={() => openRow(r)}
              dragOver={dragOver === r.workOrderId}
              onDragOver={e => { e.preventDefault(); setDragOver(r.workOrderId) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => onDropFile(r, e)}
            />
            {/* THE ADD-PO STRIP — a fold under its row, not a modal. */}
            {poFor === r.workOrderId && (
              <div className="c-bpostrip" onClick={e => e.stopPropagation()}>
                <span>
                  <span className="c-bpolbl">PO number</span>
                  <input
                    type="text"
                    value={poNum}
                    autoFocus
                    onChange={e => setPoNum(e.target.value)}
                    placeholder="From the label"
                  />
                </span>
                <span style={{ flex: 1, minWidth: 220 }}>
                  <span className="c-bpolbl">Re-issued invoice (usually re-dated to the PO date)</span>
                  <label className="c-bpofile" style={{ display: 'block' }}>
                    {poFile ? poFile.name : 'Choose the new invoice PDF — replaces the attached one'}
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      style={{ display: 'none' }}
                      onChange={e => setPoFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </span>
                <button
                  className="c-bact"
                  disabled={!poNum.trim() || busy === r.workOrderId}
                  onClick={() => savePoStrip(r)}
                  title="Writes the PO to the work order, swaps the invoice if you chose one, and downloads the rebuilt package. The approval is untouched — the money never moved."
                >
                  Save &amp; download
                </button>
                <button className="c-bact c-bmuted" onClick={() => setPoFor(null)}>Cancel</button>
              </div>
            )}
          </span>
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
              : 'The badge says where each package is; the button is only ever the next real act — Add PO, Download, Mark sent, Mark paid. Drop a QuickBooks PDF straight onto a row to attach it (that also re-queues a Not-approved row). Approving happens in the strip above; a missing PO blocks sending, never approval.'}
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
          isOwner={isOwner}
          approverId={profile?.id ?? null}
          approverName={profile?.display_name || ''}
        />
      )}

      {moreFor && (
        <MoreModal
          row={moreFor}
          onCancel={() => setMoreFor(null)}
          onOpenDoc={() => { openDoc(moreFor); setMoreFor(null) }}
          onClose={() => { const r = moreFor; setMoreFor(null); setClosing(r) }}
          onRedownload={() => { downloadPackage(moreFor.workOrderId); setMoreFor(null) }}
          onNoPo={() => {
            const r = moreFor
            setMoreFor(null)
            run(r.workOrderId, () => setNoPoNeeded(r, true))
          }}
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

/**
 * STAGE BADGE COLOURS (Eli, 2026-09-03, from the approved mock
 * billing-badges-po-simple.html): In progress is COD's exact blue; amber waits
 * on someone in-house; Awaiting PO is a lighter blue (waiting on the label —
 * fixed literal, both themes, like every status colour); Approved and Paid are
 * green (his call — the Paid tab is rarely open, so they never sit together);
 * Not approved is hot; Closed is the wash. Buttons are never green — colour
 * belongs to status, a button is a verb.
 */
const STAGE_STYLE: Record<StageKey, React.CSSProperties> = {
  progress:     { background: 'var(--c-st-uncon)', color: 'var(--c-chip-ink)' },
  // A dimmed In-progress: same family (the session side of the line), clearly
  // not yet in play. Lives mostly in its own tab; search is where it earns
  // the distinct look.
  not_started:  { background: 'var(--c-st-uncon)', color: 'var(--c-chip-ink)', opacity: 0.55 },
  review:       { background: 'var(--c-st-warm)', color: 'var(--c-chip-ink)' },
  invoice:      { background: 'var(--c-st-warm)', color: 'var(--c-chip-ink)', opacity: 0.75 },
  approval:     { background: 'var(--c-st-warm)', color: 'var(--c-chip-ink)' },
  po:           { background: '#b9d5f1', color: 'var(--c-chip-ink)' },
  approved:     { background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)' },
  not_approved: { background: 'var(--c-st-hot)', color: 'var(--c-hot-text)' },
  sent:         { background: 'var(--c-st-uncon)', color: 'var(--c-chip-ink)' },
  paid:         { background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)' },
  closed:       { background: 'var(--c-wash2)', opacity: 0.65 },
}

/** "Wed, Sep 3" from a YYYY-MM-DD — local, never Date-parse of a bare string. */
function fmtDayHeading(iso: string | null): string {
  if (!iso) return 'No date'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** One sortable header cell — active column keeps the caret. */
function SortHd({ col, label, right, searching, sortCol, sortDir, clickSort }: {
  col: SortCol
  label: string
  right?: boolean
  searching: boolean
  sortCol: SortCol
  sortDir: 'asc' | 'desc'
  clickSort: (c: SortCol) => void
}) {
  const on = !searching && sortCol === col
  return (
    <span
      className={`${right ? 'c-r' : ''}${searching ? '' : ` c-bsort${on ? ' c-on' : ''}`}`.trim()}
      onClick={searching ? undefined : () => clickSort(col)}
      title={searching ? undefined : 'Click to sort · again to reverse · again for date order'}
    >
      {label}{on ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
    </span>
  )
}

function Row({
  row, searching, isOwner, busy, dragOver, showAge, badge, stage, codBin,
  onAct, onAttach, onMore, onOpen, onDragOver, onDragLeave, onDrop,
}: {
  row: InvoiceRow
  searching: boolean
  isOwner: boolean
  busy: boolean
  dragOver: boolean
  showAge: boolean
  /** The row's bucket, when 2+ COD bins are latched — null renders no cell. */
  badge: BucketKey | null
  /** The billing stage badge (2026-09-03) — replaces the three lights. */
  stage: { key: StageKey; label: string } | null
  /** In the staged layout a COD search hit wears its bin in the same column. */
  codBin: BucketKey | null
  onAct: () => void
  onAttach: () => void
  onMore: () => void
  onOpen: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const overdue = isPastDue(row)
  const label = nextAction(row)
  const inStaged = stage !== null || codBin !== null
  // THE ROW RENDERS NO APPROVE BUTTON on the billing side (Eli, 2026-09-03 —
  // the button column stops narrating): owners approve from the strip above
  // the list or inside the package window, both of which show the drift ⚠ and
  // the package first. nextAction still SAYS 'Approve' because approvalQueue's
  // membership is that predicate — the label is hidden here, never re-derived.
  // COD rows keep their Approve button: the COD side is untouched.
  const hideLabel = label === 'Approve' && !row.isCod
  // Approving is owners-only, so for everyone else the row has no action rather
  // than a button that will be refused by the database.
  const canAct = label !== 'Approve' || isOwner
  // Every row accepts a dropped PDF — replacing an invoice is legitimate — but
  // only a row waiting on its invoice ADVANCES on drop (see lib/billing).
  const wantsInvoice = row.step === 1
  // Lights only on the COD layout now — the billing side's stage badge already
  // says how far along the line a row is (Eli, 2026-09-03: "you no longer
  // need those"). In the staged layout there is no lights column at all.
  const showLights = !inStaged && ['progress', 'review', 'balance'].includes(row.bucket)
  const canClose = row.step >= 2 && row.bucket !== 'closed' && row.bucket !== 'paid'
  const hasMore = row.hasInvoiceDoc || canClose || (row.awaitingPo && !row.isCod)

  return (
    <div
      className={`c-brow${overdue ? ' c-od' : ''}${dragOver ? ' c-drop' : ''}`}
      style={{ opacity: busy ? 0.5 : 1, cursor: row.bookingId ? 'pointer' : 'default' }}
      // SINGLE click opens (Eli, 2026-09-01: "1 click from 2 clicks. driving me
      // nuts") — reversing the Aug 11 double-click ruling. The original fear
      // was a click aimed at the row's button opening the WO behind it; the
      // action and ⋯ cells stop click propagation now, so the button path and
      // the open path can't collide.
      onClick={onOpen}
      title={row.hasInvoiceDoc ? 'Click to see the package' : 'Click to open the work order'}
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
      {/* THE STAGE BADGE (Eli, 2026-09-03) — the COD bin badge, on billing.
          One word for the whole position; the lights are gone. A COD hit in
          search wears its bin in the same column so the grid stays aligned. */}
      {stage && (
        <span className="c-bbin" style={STAGE_STYLE[stage.key]}>{stage.label}</span>
      )}
      {codBin && (
        <span
          className="c-bbin"
          style={{ background: BIN_COLOR[codBin] ?? 'var(--c-wash2)', color: codBin === 'balance' ? 'var(--c-hot-text)' : 'var(--c-chip-ink)' }}
        >
          {bucketLabel(codBin)}
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
        {row.rejectedAt ? (
          // NOT APPROVED: the owner looked and bounced it. The badge says so;
          // the flag carries the note and the way back — dropping the
          // corrected invoice on the row re-queues it (2026-09-03).
          <span className="c-bdrift" title={row.rejectNote ? `Owner: “${row.rejectNote}” — drop the corrected invoice on this row to send it back for approval` : 'The owner did not approve this package — drop the corrected invoice on this row to re-queue it'}>
            See note · drop the corrected invoice
          </span>
        ) : row.invoiceDrift ? (
          // DRIFT: edited after the invoice went out. Hot, because the
          // alternative to seeing it here is hearing it from the client.
          <span
            className="c-bdrift"
            title={`Invoiced ${formatCurrency(String(row.invoicedTotal ?? 0))}, now ${formatCurrency(String(row.total))}`}
          >
            Changed since invoiced
          </span>
        ) : row.awaitingPo && !stage ? (
          /* On the staged layout the badge already SAYS Awaiting PO — the chip
             here would say it twice, so the cell shows when it was approved
             instead (the useful second fact while chasing a label). */
          <span className="c-bflag c-po">Awaiting PO</span>
        ) : row.awaitingPo && stage && row.approvedAt ? (
          <span className="c-bhint">Approved {fmtDayHeading(row.approvedAt.slice(0, 10))}</span>
        ) : row.closedReason ? (
          <span className="c-bflag c-soon">{row.closedReason === 'written_off' ? 'Written off' : 'Voided'}</span>
        ) : row.notStarted && row.bucket === 'progress' && !stage ? (
          /* The staged layout's In-progress badge already says it. */
          <span className="c-bflag c-soon">Not started</span>
        ) : wantsInvoice ? (
          /* CLICK OR DROP (2026-09-03): the Attach button is gone, so the hint
             is also the picker. Swallows the click so the row doesn't open. */
          <span
            className="c-bhint"
            style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onAttach() }}
          >
            {dragOver ? 'Release to attach' : 'Drop invoice here · or click'}
          </span>
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
        ) : row.hasInvoiceDoc && !showLights && !stage ? (
          // COD's sent/paid/closed rows show no lights, so without this there
          // is no sign the invoice is stapled on. The staged layout doesn't
          // need it — Invoiced is step 2, and every badge from Needs approval
          // up implies it.
          <span className="c-bflag c-soon">Invoice on file</span>
        ) : null}
      </span>

      {/* The lights column only exists on the COD layout — the staged grid has
          no cell for it (the badge replaced it, 2026-09-03). */}
      {!inStaged && <span>{showLights && <Lights row={row} />}</span>}

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
      <span className="c-bactcell" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
        {/* THE GREYED DOWNLOAD IS GONE (2026-09-03). An Awaiting-PO row's
            button used to be a disabled Download pointing at the work order;
            now it is Add PO — the thing you actually came to do — so nothing
            here ever renders disabled. Nothing can still leave without a PO:
            Download simply isn't offered until one exists (nextAction). */}
        {label && canAct && !hideLabel && (
          <button className="c-bact" onClick={onAct}>
            {label}
          </button>
        )}
      </span>
      <span className="c-bmorecell" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
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
function MoreModal({ row, onCancel, onOpenDoc, onClose, onPullBack, onRedownload, onNoPo }: {
  row: InvoiceRow
  onCancel: () => void
  onOpenDoc: () => void
  onClose: () => void
  onPullBack: () => void
  onRedownload: () => void
  onNoPo: () => void
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
        {/* The rare sibling of Add PO — this job goes out without one. Same
            work_orders.no_po_needed field the WO screen writes; here because
            the WO trip was the whole complaint (2026-09-03). */}
        {row.awaitingPo && !row.isCod && (
          <button className="c-bact c-bblock" onClick={onNoPo}>
            No PO required — this one can go out without it
          </button>
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
function PackageModal({ row, booking, onClose, isOwner, approverId, approverName }: {
  row: InvoiceRow
  booking: Booking
  onClose: () => void
  isOwner: boolean
  approverId: string | null
  approverName: string
}) {
  // ── THE APPROVAL SURFACE (Eli, 2026-09-01): "the approval needs to be the
  // package, black and white — the owner needs to approve what is actually
  // going out." Owners with an approval pending land on the PACKAGE view (the
  // live B&W render from the same generator that builds the client PDF), with
  // Approve / Don't approve in the footer. The loop is entirely in-window:
  // review the B&W → Don't approve + note → billing fixes on the Work order
  // tab (the live editor) → Send for approval → review the fresh B&W → Approve.
  const approvalPending = isOwner && row.step === 2
    && (nextAction(row) === 'Approve' || row.rejectedAt !== null)
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
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
  type View = 'pkg' | 'sent' | 'wo' | 'inv'
  const [view, setView] = useState<View>(approvalPending ? 'pkg' : row.hasPackage ? 'sent' : 'wo')
  const [urls, setUrls] = useState<{ pkg?: string | null; sent?: string | null; inv?: string | null }>({})

  // Signed on demand — the URLs are short-lived, and most visits open one pane.
  // 'pkg' is different: a LIVE B&W build fetched to a blob (previewPackageUrl),
  // revoked on unmount. Rebuilt fresh every time the modal opens, which is the
  // point — after a fix, reopening shows the corrected artifact.
  useEffect(() => {
    let alive = true
    if (view === 'pkg' && urls.pkg === undefined) {
      previewPackageUrl(row.workOrderId).then(u => { if (alive) setUrls(p => ({ ...p, pkg: u })) })
    }
    if (view === 'sent' && urls.sent === undefined) {
      signedPackageUrl(row.workOrderId).then(u => { if (alive) setUrls(p => ({ ...p, sent: u })) })
    }
    if (view === 'inv' && urls.inv === undefined) {
      signedInvoiceUrl(row.workOrderId).then(u => { if (alive) setUrls(p => ({ ...p, inv: u })) })
    }
    return () => { alive = false }
  }, [view, urls.pkg, urls.sent, urls.inv, row.workOrderId])
  useEffect(() => () => { if (urls.pkg) URL.revokeObjectURL(urls.pkg) }, [urls.pkg])

  const doc = view === 'pkg' ? urls.pkg : view === 'sent' ? urls.sent : urls.inv

  async function doApprove() {
    if (busy) return
    setBusy(true)
    const ok = await approveInvoice(row, approverId, approverName || undefined)
    setBusy(false)
    if (ok) { toast(`Approved — ${formatCurrency(String(row.total))}`, 'success'); onClose() }
  }
  async function doReject() {
    if (busy) return
    setBusy(true)
    const ok = await rejectInvoice(row, approverId, approverName, rejectNote)
    setBusy(false)
    if (ok) { toast('Returned to billing with your note', 'success'); onClose() }
  }

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
            {/* The PACKAGE — the live B&W build, what the client would receive
                today. First when an approval is pending: it is the thing being
                signed. ('As sent' remains the frozen artifact for sent ones.) */}
            {approvalPending && (
              <button className={view === 'pkg' ? 'c-on' : ''} onClick={() => setView('pkg')}>Package</button>
            )}
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

        {/* A standing rejection travels with the record — the note is the
            assignment, visible to whoever opens the window next. */}
        {row.rejectedAt && (
          <div className="c-bnote" style={{ padding: '0 14px 6px', color: 'var(--c-st-hot)' }}>
            Returned by the owner{row.rejectNote ? <> — “{row.rejectNote}”</> : ''}. Fix the work order, then drop the corrected invoice on the row — that puts it back in the approval queue.
          </div>
        )}

        <div className="c-bpkgbody">
          {view === 'wo'
            ? <WorkOrderPopup
                booking={booking}
                inline
                onClose={onClose}
                // FIX → TOGGLE BACK → FRESH BUILD (Eli, 2026-09-01: "if you
                // change the digital version the bw version builds again").
                // A save drops the cached Package/As-built URLs, so returning
                // to the Package tab re-fetches a build that includes the fix.
                // (Sent packages are untouchable here — the Package tab only
                // exists pre-send.)
                onSaved={() => setUrls(p => {
                  if (p.pkg) URL.revokeObjectURL(p.pkg)
                  return { inv: p.inv }
                })}
              />
            : doc
              ? <iframe src={doc} title={view === 'pkg' ? 'Package preview' : view === 'sent' ? 'Package' : 'Invoice'} style={{ width: '100%', height: '100%', border: 'none', borderRadius: 12, background: '#fff' }} />
              : doc === null
                ? <div className="c-bempty">{view === 'pkg' ? 'The package could not be built.' : 'That file isn’t there any more.'}</div>
                : <div className="c-bempty">{view === 'pkg' ? 'Building the package…' : 'Loading…'}</div>}
        </div>

        {/* ── THE OWNER'S CALL (owners only, while an approval is pending).
            Approve signs off the numbers as they stand; Don't approve REQUIRES
            a note and returns the row to billing with a hot RETURNED chip. */}
        {approvalPending && !rejecting && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: '1px solid var(--c-wash2)' }}>
            <span style={{ fontSize: 10.5, opacity: 0.55 }}>
              {row.rejectedAt ? 'You returned this — approving accepts the fix.' : 'This is what the client receives.'}
            </span>
            <button
              className="c-bact"
              style={{ marginLeft: 'auto', opacity: busy ? 0.5 : 1 }}
              disabled={busy}
              onClick={() => setRejecting(true)}
            >Don&apos;t approve…</button>
            <button
              className="c-bact"
              // Not green (Eli, 2026-09-03): colour belongs to status — a
              // button is a verb. The approvals strip's Approve is plain too.
              style={{ opacity: busy ? 0.5 : 1 }}
              disabled={busy}
              onClick={doApprove}
            >{busy ? 'Working…' : `Approve ${formatCurrency(String(row.total))}`}</button>
          </div>
        )}
        {approvalPending && rejecting && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--c-wash2)' }}>
            <div style={{ fontSize: 10.5, opacity: 0.55, marginBottom: 6 }}>
              What needs fixing? Billing sees this note on the row.
            </div>
            <textarea
              className="c-input"
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              autoFocus
              rows={2}
              placeholder="e.g. Aug 28 OT is missing — should be 2h at $195"
              style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 7, justifyContent: 'flex-end' }}>
              <button className="c-bact c-bmuted" disabled={busy} onClick={() => setRejecting(false)}>Back</button>
              <button
                className="c-bact"
                disabled={busy || !rejectNote.trim()}
                style={{ opacity: busy || !rejectNote.trim() ? 0.5 : 1 }}
                onClick={doReject}
              >{busy ? 'Working…' : 'Return to billing'}</button>
            </div>
          </div>
        )}
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

