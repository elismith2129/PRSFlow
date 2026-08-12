'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /billing — the invoice hub (docs/design-refs/billing-hub-final.html).
//
// Replaces /wo-hub AND the Dropbox folder system. Eli's folders were a status
// field he maintained by hand; here they are tabs over states on the work order,
// so the filing disappears and the window he already looks at becomes the app.
//
// Ported from the approved mock per the port protocol — values from the
// reference file, not from prose. Mock polarity is inverted (mock dark =
// data-theme="dark"; app dark = the ABSENCE of the attribute), so tokens are
// used directly and no [data-theme] rules are written here.
//
// RULINGS honoured (2026-08-11):
//   · SEARCH OVERRIDES THE TAB. Typing searches every bucket, closed included,
//     and dims the tabs; clearing returns you. Search-within-tab would mean
//     guessing the right folder before you can find anything — the exact
//     Dropbox problem this page removes.
//   · PAGINATION AT 10.
//   · Every row carries its status pill (option B's colour coding).
//   · CLOSED is out of every pipeline — excluded from the summary, from aging
//     and from All — but still searchable.
//   · Approving and sending are DIFFERENT QUEUES with different owners, so
//     "Ready to send" is its own tab.
//   · Approval is OWNERS ONLY. The button is hidden for everyone else, and a
//     Postgres trigger enforces it regardless of what the UI does.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type Booking } from '@/lib/supabase'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatCurrency } from '@/lib/format'
import {
  fetchInvoices, activeRows, searchRows, rowsInBucket, bucketCounts, paginate,
  pageCount, summarise, isPastDue, bucketLabel,
  approveInvoice, recordPoNumber, markSent, markPaid, closeInvoice, reopenInvoice,
  uploadInvoiceDoc, signedInvoiceUrl,
  BUCKETS, PAGE_SIZE,
  type InvoiceRow, type BucketKey, type ClosedReason,
} from '@/lib/billing'

/** 'all' is a view, not a bucket — it means every ACTIVE row. */
type Tab = BucketKey | 'all'

export default function BillingPage() {
  const { profile, loading: profileLoading } = useUserProfile()
  const isMobile = useIsMobile()

  const isEli = profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com'
  const isOwner = isEli || profile?.role === 'owner'

  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('to_review')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [closing, setClosing] = useState<InvoiceRow | null>(null)
  const [poFor, setPoFor] = useState<InvoiceRow | null>(null)
  const [poValue, setPoValue] = useState('')
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
  // are watched too, because a COD invoice moves between buckets when one lands
  // and nothing else would tell this page about it.
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
  const counts = useMemo(() => bucketCounts(rows), [rows])
  const summary = useMemo(() => summarise(rows), [rows])

  // SEARCH OVERRIDES THE TAB, and spans closed as well — the whole point of the
  // Closed bucket is that those invoices stay findable.
  const visible = useMemo(() => {
    if (searching) return searchRows(rows, query)
    if (tab === 'all') return activeRows(rows)
    return rowsInBucket(rows, tab)
  }, [rows, tab, query, searching])

  const pages = pageCount(visible.length)
  const pageRows = paginate(visible, Math.min(page, pages))
  const owed = visible.reduce((s, r) => s + Math.max(0, r.balance), 0)

  useEffect(() => { setPage(1) }, [tab, query])

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
   * The whole point: attaching and filing become one gesture. Billing exports
   * from QuickBooks, drags it here, and the work order routes itself — Needs
   * approval for a billing client, or back to its computed COD bucket. No
   * scanning, no combining, no remembering which folder.
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

  if (profileLoading) return null

  return (
    <div className="c-root">
      {/* HEADER — same anatomy as every other page: micro-label over the
          Archivo title, nothing else. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '2px 4px 14px' }}>
        <div>
          <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>Work orders &amp; invoices</span>
          <h1 className="c-arch" style={{ fontSize: isMobile ? 20 : 26, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Billing
          </h1>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      {/* SUMMARY — AR aging without leaving the page. Computed from the same
          rows the tabs use, so a figure up here can never disagree with the
          list below it. */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        <Stat n={formatCurrency(String(summary.outstanding))} k="Outstanding" />
        <Stat n={formatCurrency(String(summary.receivedThisMonth))} k="Received this month *" />
        <Stat n={summary.waitingApproval} k="Waiting on approval" />
        <Stat n={summary.overThirtyOne} k="Over 31 days" alert={summary.overThirtyOne > 0} />
      </div>

      {/* SEARCH — above the tabs on purpose: it outranks them. */}
      <div className="c-bsearch">
        <span style={{ opacity: 0.4, fontSize: 12 }}>⌕</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search every bucket — client, artist, invoice #, WO #, PO…"
        />
        {searching && (
          <span className="c-bclr" onClick={() => setQuery('')}>clear ✕</span>
        )}
      </div>

      <div className={`c-btabs${searching ? ' c-dim' : ''}`}>
        {BUCKETS.map(b => (
          <span
            key={b.key}
            className={`c-btab${tab === b.key ? ' c-on' : ''}`}
            onClick={() => setTab(b.key)}
          >
            {b.label} <span className="c-bn">{counts[b.key] ?? 0}</span>
          </span>
        ))}
        {/* All = every ACTIVE row. Closed is deliberately not in it. */}
        <span className={`c-btab${tab === 'all' ? ' c-on' : ''}`} onClick={() => setTab('all')}>
          All <span className="c-bn">{activeRows(rows).length}</span>
        </span>
      </div>

      <div className="c-panel">
        <div className="c-lozenge">
          <b>{searching ? 'Search results' : tab === 'all' ? 'All invoices' : bucketLabel(tab as BucketKey)}</b>
          <span className="c-ct">
            {visible.length}{owed > 0 ? ` · ${formatCurrency(String(owed))}` : ''}
          </span>
        </div>

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
            onApprove={() => run(r.workOrderId, () => approveInvoice(r, profile?.id ?? null))}
            onSend={() => run(r.workOrderId, () => markSent(r))}
            onPaid={() => run(r.workOrderId, () => markPaid(r))}
            onClose={() => setClosing(r)}
            onReopen={() => run(r.workOrderId, () => reopenInvoice(r))}
            onPo={() => { setPoFor(r); setPoValue(r.poNumber ?? '') }}
            onUpload={() => { uploadFor.current = r; fileInput.current?.click() }}
            onOpenDoc={() => openDoc(r)}
            onOpenWo={() => openWorkOrder(r)}
            dragOver={dragOver === r.workOrderId}
            onDragOver={e => { e.preventDefault(); setDragOver(r.workOrderId) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => onDropFile(r, e)}
          />
        ))}

        {visible.length > 0 && (
          <div className="c-bpager">
            <span className="c-binfo">
              {(Math.min(page, pages) - 1) * PAGE_SIZE + 1}–
              {Math.min(Math.min(page, pages) * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            {pages > 1 && Array.from({ length: pages }, (_, i) => i + 1).map(p => (
              <span key={p} className={`c-bpg${p === Math.min(page, pages) ? ' c-on' : ''}`} onClick={() => setPage(p)}>{p}</span>
            ))}
          </div>
        )}

        <div className="c-bnote">
          {searching
            ? 'Searching every bucket, not just the open tab — each result shows which bucket it lives in. Clear the search to go back.'
            : 'WO = the work order PDF PRSFlo already generates. INV = the QuickBooks invoice you upload. With both present, one button staples them.'}
        </div>
      </div>

      {/* The file picker is hidden; the row buttons drive it. */}
      <input ref={fileInput} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={onPickFile} />

      {openBooking && (
        <WorkOrderPopup
          booking={openBooking}
          onClose={() => { setOpenBooking(null); load() }}
        />
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
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Stat({ n, k, alert }: { n: string | number; k: string; alert?: boolean }) {
  return (
    <div className="c-bstat">
      <div className="c-arch" style={{ fontSize: 20, letterSpacing: '-0.02em', color: alert ? 'var(--c-st-hot)' : undefined }}>{n}</div>
      <div style={{ fontSize: 10, opacity: 0.55, marginTop: 1 }}>{k}</div>
    </div>
  )
}

function Row({
  row, searching, isOwner, busy, dragOver,
  onApprove, onSend, onPaid, onClose, onReopen, onPo, onUpload, onOpenDoc, onOpenWo,
  onDragOver, onDragLeave, onDrop,
}: {
  row: InvoiceRow
  searching: boolean
  isOwner: boolean
  busy: boolean
  dragOver: boolean
  onApprove: () => void
  onSend: () => void
  onPaid: () => void
  onClose: () => void
  onReopen: () => void
  onPo: () => void
  onUpload: () => void
  onOpenDoc: () => void
  onOpenWo: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const pill = BUCKETS.find(b => b.key === row.bucket)?.pill ?? 'c-fill-dead'
  const overdue = isPastDue(row)
  // Every row accepts a dropped PDF — replacing an invoice is legitimate — but
  // only one waiting on its invoice ADVANCES on drop (handled in lib/billing).
  const wantsInvoice = row.bucket === 'needs_invoice'

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
      </span>

      {/* Which bucket a hit lives in — only useful while searching, since
          otherwise the tab already says it. */}
      {searching && <span className="c-binbucket">{bucketLabel(row.bucket)}</span>}

      {row.closedReason && (
        <span className="c-breason">{row.closedReason === 'written_off' ? 'Written off' : 'Voided'}</span>
      )}

      <span className={`c-bpill ${pill}`}>
        {overdue ? '31+ days' : bucketLabel(row.bucket)}
      </span>

      {/* Document state. WO is always present — PRSFlo renders it. INV is the
          QuickBooks upload, and clicking opens or replaces it. */}
      <span className="c-bdoc c-on">WO ✓</span>
      <span
        className={`c-bdoc${row.hasInvoiceDoc ? ' c-on' : ''}`}
        onClick={row.hasInvoiceDoc ? onOpenDoc : onUpload}
        title={row.hasInvoiceDoc ? 'Open the invoice' : 'Upload the QuickBooks invoice'}
        style={{ cursor: 'pointer' }}
      >
        INV {row.hasInvoiceDoc ? '✓' : '+'}
      </span>

      {wantsInvoice
        ? <span className="c-bhint">{dragOver ? 'Release to attach' : 'Drop the QuickBooks PDF here'}</span>
        : <span className="c-bamt">{row.balance > 0 ? formatCurrency(String(row.balance)) : '—'}</span>}
      <span className="c-bage">{row.ageDays != null ? `${row.ageDays}d` : '—'}</span>

      {/* One action per row: whatever comes next for THIS bucket. A row with
          five buttons is a row nobody reads. */}
      <span className="c-bacts">
        {row.bucket === 'to_review' && (
          <button className="c-bact" onClick={onOpenWo}>Open WO</button>
        )}
        {wantsInvoice && (
          <button className="c-bact" onClick={onUpload}>
            {dragOver ? 'Drop it' : 'Attach invoice'}
          </button>
        )}
        {row.bucket === 'needs_approval' && isOwner && (
          <button className="c-bact" onClick={onApprove}>Approve</button>
        )}
        {row.bucket === 'approved' && <button className="c-bact" onClick={onSend}>Mark sent</button>}
        {row.bucket === 'awaiting_po' && <button className="c-bact" onClick={onPo}>Add PO</button>}
        {row.bucket === 'sent' && <button className="c-bact" onClick={onPaid}>Mark paid</button>}
        {row.bucket === 'closed'
          ? <button className="c-bact" onClick={onReopen}>Reopen</button>
          : <button className="c-bact c-bmuted" onClick={onClose}>Close</button>}
      </span>
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
          Saving this releases the invoice into Ready to send.
        </div>
        <button className="c-bact c-bblock" onClick={onConfirm}>Save PO</button>
        <button className="c-bact c-bmuted c-bblock" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
