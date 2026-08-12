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
//   · PAGINATION AT 10.
//   · UPCOMING IS PINNED BELOW THE PAGER, not a footer row inside the list — a
//     footer row in a paginated list falls onto page 3.
//   · APPROVAL IS OWNERS ONLY. The button is hidden for everyone else, and a
//     Postgres trigger enforces it regardless of what the UI does.
//   · SEND IS TWO FILES for now, in a modal, because the work order prints from
//     its own screen. See lib/billing's downloadInvoiceDoc.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type Booking } from '@/lib/supabase'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatCurrency } from '@/lib/format'
import {
  fetchInvoices, searchRows, rowsInBucket, bucketCounts, paginate,
  pageCount, summarise, isPastDue, bucketLabel, tabsFor, hasCodAlert, nextAction,
  approveInvoice, recordPoNumber, markSent, markPaid, closeInvoice, reopenInvoice,
  uploadInvoiceDoc, signedInvoiceUrl, downloadInvoiceDoc,
  BILLING_LIGHTS, COD_LIGHTS, PAGE_SIZE,
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
  const [showUpcoming, setShowUpcoming] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [closing, setClosing] = useState<InvoiceRow | null>(null)
  const [poFor, setPoFor] = useState<InvoiceRow | null>(null)
  const [poValue, setPoValue] = useState('')
  const [sending, setSending] = useState<InvoiceRow | null>(null)
  const [openBooking, setOpenBooking] = useState<Booking | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
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

  const activeBucket: BucketKey = showUpcoming ? 'upcoming' : tab
  const visible = useMemo(() => {
    if (searching) return searchRows(rows, query)
    return rowsInBucket(rows, activeBucket, pipeline)
  }, [rows, activeBucket, pipeline, query, searching])

  const pages = pageCount(visible.length)
  const safePage = Math.min(page, pages)
  const pageRows = paginate(visible, safePage)
  const owed = visible.reduce((s, r) => s + Math.max(0, r.balance), 0)
  const upcomingCount = counts.upcoming ?? 0

  useEffect(() => { setPage(1) }, [tab, query, pipeline, showUpcoming])

  // Switching pipeline lands on that side's FIRST tab — for COD that is Balance
  // due, which is the whole reason it leads.
  function switchPipeline(p: Pipeline) {
    setPipeline(p)
    setTab(tabsFor(p)[0].key)
    setShowUpcoming(false)
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

  /** Open the work order itself — billing reviews it before completing. */
  async function openWorkOrder(row: InvoiceRow) {
    if (!row.bookingId) return
    const { data } = await supabase.from('bookings').select('*').eq('id', row.bookingId).limit(1)
    if (data?.[0]) setOpenBooking(data[0] as Booking)
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
      case 'Open WO':         return openWorkOrder(row)
      case 'Attach invoice':  uploadFor.current = row; fileInput.current?.click(); return
      case 'Approve':         return run(row.workOrderId, () => approveInvoice(row, profile?.id ?? null))
      case 'Add PO':          setPoFor(row); setPoValue(row.poNumber ?? ''); return
      case 'Send package':    setSending(row); return
      default:                return
    }
  }

  if (profileLoading) return null

  return (
    <div className="c-root">
      {/* HEADER — micro-label over the Archivo title, and the TOGGLE, which is
          the one control that changes what everything below means. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '2px 4px 14px', flexWrap: 'wrap' }}>
        <div>
          <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>Work orders &amp; invoices</span>
          <h1 className="c-arch" style={{ fontSize: isMobile ? 20 : 26, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Billing
          </h1>
        </div>
        <div style={{ flex: 1 }} />
        <div className="c-seg">
          <button className={pipeline === 'billing' ? 'c-on' : ''} onClick={() => switchPipeline('billing')}>
            Billing
          </button>
          <button
            className={pipeline === 'cod' ? 'c-on' : ''}
            onClick={() => switchPipeline('cod')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            COD
            {/* The dot only exists while a COD balance does. A rare problem you
                have to go looking for is one you find late. */}
            {codAlert && <i className="c-bsegdot" />}
          </button>
        </div>
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
            onClick={() => { if (s.goto) { setShowUpcoming(false); setQuery(''); setTab(s.goto) } }}
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
      </div>

      <div className={`c-btabs${searching ? ' c-dim' : ''}`}>
        {tabs.map(b => (
          <span
            key={b.key}
            className={`c-btab${tab === b.key && !showUpcoming ? ' c-on' : ''}`}
            onClick={() => { setTab(b.key); setShowUpcoming(false) }}
          >
            {b.label}{' '}
            <span
              className="c-bn"
              style={b.hot && (counts[b.key] ?? 0) > 0 ? { color: 'var(--c-st-hot)', opacity: 1 } : undefined}
            >
              {counts[b.key] ?? 0}
            </span>
          </span>
        ))}
      </div>

      <div className="c-panel">
        <div className="c-lozenge">
          <b>{searching ? 'Search results' : showUpcoming ? 'Upcoming sessions' : bucketLabel(tab)}</b>
          <span className="c-ct">
            {visible.length}{owed > 0 ? ` · ${formatCurrency(String(owed))}` : ''}
          </span>
        </div>

        {!isMobile && visible.length > 0 && (
          <div className="c-browhd">
            <span>WO</span>
            <span>Client &amp; session</span>
            <span className="c-r">Flag</span>
            <span>Progress</span>
            <span className="c-r">Balance</span>
            <span className="c-r">Age</span>
            <span className="c-r">Next</span>
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
            onAct={() => act(r)}
            onClose={() => setClosing(r)}
            onOpenDoc={() => openDoc(r)}
            dragOver={dragOver === r.workOrderId}
            onDragOver={e => { e.preventDefault(); setDragOver(r.workOrderId) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => onDropFile(r, e)}
          />
        ))}

        {visible.length > 0 && (
          <div className="c-bpager">
            <span className="c-binfo">
              {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            {pages > 1 && Array.from({ length: pages }, (_, i) => i + 1).map(p => (
              <span key={p} className={`c-bpg${p === safePage ? ' c-on' : ''}`} onClick={() => setPage(p)}>{p}</span>
            ))}
          </div>
        )}

        {/* UPCOMING — pinned BELOW the pager so it can never fall onto page 3,
            and it SWITCHES the list rather than expanding beneath it. Ten
            paginated rows followed by twelve un-paginated ones would make
            "page 2" mean two different things. */}
        {!searching && showUpcoming && (
          <button className="c-bup" onClick={() => setShowUpcoming(false)}>
            ← Back to {bucketLabel(tab)}<span className="c-go">›</span>
          </button>
        )}
        {!searching && !showUpcoming && upcomingCount > 0 && (
          <button className="c-bup" onClick={() => setShowUpcoming(true)}>
            Upcoming sessions <span className="c-bn">{upcomingCount}</span> — not started yet
            <span className="c-go">→</span>
          </button>
        )}

        <div className="c-bnote">
          {searching
            ? 'Searching every bucket and both pipelines, closed included — each result shows where it lives. Clear the search to go back.'
            : showUpcoming
              ? 'Sessions that have not happened yet. Fully editable — extend, cancel days, adjust rates — they just are not work yet.'
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

      {poFor && (
        <PoModal
          row={poFor}
          value={poValue}
          onChange={setPoValue}
          onCancel={() => setPoFor(null)}
          onConfirm={async () => {
            const r = poFor
            const v = poValue.trim()
            setPoFor(null)
            if (v) await run(r.workOrderId, () => recordPoNumber(r, v))
          }}
        />
      )}

      {sending && (
        <SendModal
          row={sending}
          onCancel={() => setSending(null)}
          onInvoice={() => downloadInvoiceDoc(sending)}
          onWorkOrder={() => { const r = sending; setSending(null); openWorkOrder(r) }}
          onSent={async () => {
            const r = sending
            setSending(null)
            await run(r.workOrderId, () => markSent(r))
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

function Row({
  row, searching, isOwner, busy, dragOver, onAct, onClose, onOpenDoc,
  onDragOver, onDragLeave, onDrop,
}: {
  row: InvoiceRow
  searching: boolean
  isOwner: boolean
  busy: boolean
  dragOver: boolean
  onAct: () => void
  onClose: () => void
  onOpenDoc: () => void
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
  const wantsInvoice = row.step === 1 && row.bucket !== 'upcoming'
  // Lights only where the assembly line is still running. On a sent, paid or
  // closed row every light is green and says nothing.
  const showLights = ['progress', 'review', 'balance', 'upcoming'].includes(row.bucket)

  return (
    <div
      className={`c-brow${overdue ? ' c-od' : ''}${dragOver ? ' c-drop' : ''}`}
      style={{ opacity: busy ? 0.5 : 1 }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="c-binv">{row.woNumber || row.invoiceNumber || '—'}</span>
      <span className="c-bwho">
        <b>{row.client}</b>
        {row.artist ? <span> · {row.artist}</span> : null}
        {row.sessionDate ? <span> · {row.sessionDate}</span> : null}
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
        ) : row.bucket === 'upcoming' ? (
          <span className="c-bflag c-soon">Not started</span>
        ) : wantsInvoice ? (
          <span className="c-bhint">{dragOver ? 'Release to attach' : 'Drop invoice here'}</span>
        ) : null}
      </span>

      <span>{showLights && <Lights row={row} />}</span>

      <span className="c-bamt">{row.balance > 0 ? formatCurrency(String(row.balance)) : '—'}</span>
      <span className="c-bage">{row.ageDays != null ? `${row.ageDays}d` : '—'}</span>

      {/* ONE ACTION PER ROW: whatever comes next. A row with five buttons is a
          row nobody reads. The invoice link and Close sit behind it because
          they are the exceptions, not the flow. */}
      <span className="c-bactcell">
        {row.hasInvoiceDoc && (
          <button className="c-bact c-bmuted" onClick={onOpenDoc} title="Open the attached invoice">INV</button>
        )}
        {/* "Close invoice" = write off or void. It ONLY appears once there is an
            invoice to close — offering it on a work order nobody has reviewed
            was meaningless, and read like "close this window" (Eli). */}
        {row.step >= 2 && row.bucket !== 'closed' && row.bucket !== 'paid' && (
          <button className="c-bact c-bmuted" onClick={onClose} title="Write off or void">✕</button>
        )}
        {label && canAct && <button className="c-bact" onClick={onAct}>{label}</button>}
      </span>
    </div>
  )
}

/**
 * SENDING IS TWO FILES, and therefore a modal (ruling 2026-08-11).
 *
 * Eli: "I'm ok with two files for now." A merged package needs a PDF library
 * plus the work order rendered to a real file; today the work order prints from
 * its own screen. So the three things behind "Send package" — download the
 * invoice, print the work order, start the aging clock — are shown as three
 * things. One button doing all three would surprise you exactly once and then be
 * distrusted forever.
 */
function SendModal({ row, onCancel, onInvoice, onWorkOrder, onSent }: {
  row: InvoiceRow
  onCancel: () => void
  onInvoice: () => void
  onWorkOrder: () => void
  onSent: () => void
}) {
  return (
    <div className="c-bmodal-wrap" onClick={onCancel}>
      <div className="c-bmodal" onClick={e => e.stopPropagation()}>
        <div className="c-lozenge"><b>Send the package</b></div>
        <div style={{ fontSize: 12.5, marginBottom: 4 }}>{row.client}</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          {formatCurrency(String(row.total))}
          {row.poNumber ? ` · PO ${row.poNumber}` : row.noPoNeeded ? ' · no PO required' : ''}
          {' · '}Two files for now — grab both, email them, then mark it sent.
        </div>
        <button className="c-bact c-bblock" onClick={onInvoice}>1 · Download the invoice PDF</button>
        <button className="c-bact c-bblock" onClick={onWorkOrder}>2 · Open the work order to print</button>
        <button className="c-bact c-bblock" onClick={onSent}>3 · Mark sent — starts the 31-day clock</button>
        <button className="c-bact c-bmuted c-bblock" onClick={onCancel}>Cancel</button>
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

function PoModal({ row, value, onChange, onCancel, onConfirm }: {
  row: InvoiceRow
  value: string
  onChange: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="c-bmodal-wrap" onClick={onCancel}>
      <div className="c-bmodal" onClick={e => e.stopPropagation()}>
        <div className="c-lozenge"><b>PO number</b></div>
        <div style={{ fontSize: 12.5, marginBottom: 10 }}>{row.client}</div>
        <input
          className="c-input"
          value={value}
          autoFocus
          placeholder="PO number from the client…"
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm() }}
          style={{ width: '100%', marginBottom: 10 }}
        />
        <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 12, lineHeight: 1.5 }}>
          Saving this clears the Awaiting-PO flag — it is derived from the number,
          so there is nothing else to press. If this client never needs one, set
          PO req&apos;d to No on the work order instead.
        </div>
        <button className="c-bact c-bblock" onClick={onConfirm}>Save PO</button>
        <button className="c-bact c-bmuted c-bblock" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
