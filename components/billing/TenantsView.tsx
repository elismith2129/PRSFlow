'use client'
// ─────────────────────────────────────────────────────────────────────────────
// TenantsView — the rent board, the ledger, the tenant editor, and the
// Mustard shared-runner sheet (Eli, 2026-09-02; leases-as-data 2026-09-28;
// mocks docs/design-refs/tenants-simple.html + tenants-ledger-options.html).
//
// Third word in the billing hub's heading, beside Billing and COD — rendered
// as its own branch like Financials (Eli, 2026-09-28: stays a TAB, not its
// own route). All model logic lives in lib/tenants.ts; this file renders,
// stamps, and edits leases.
//
// ONE BUTTON PER ROW, ALWAYS THE NEXT ACT (the hub's law): Mark sent → Mark
// paid → In QB. "Open" is the state between, never a button. ↩ undoes the
// last stamp. Mark paid asks how much (prefilled in full) — a short payment
// is a Partial and the row keeps offering Mark paid for the balance.
//
// PERIODS: each row shows its period (anchor to anchor) so MBA's mid-month
// cycle reads naturally beside the 1st-of-month tenants. Late shifts with
// the anchor (lib/tenants periodFor).
//
// REALTIME: own channels on leases and tenant_rent_months. The sheet
// re-derives on studio_time_rows via the shared useWoInvoicesVersion (the
// st-rows channel rides the wo-invoices channel since 2026-09-23). This view
// still must never mount beside WorkOrderPopup — same rule as before.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useWoInvoicesVersion } from '@/hooks/useWoInvoicesVersion'
import { formatCurrency } from '@/lib/format'
import {
  VENUES, SHARED_RUNNER,
  fetchLeases, createLease, updateLease, deleteLease,
  fetchRentStamps, fetchLeaseLedger, stampKey, markRentSent, markRentPaid, markRentQb,
  undoRentSent, undoRentPaid, undoRentQb,
  isRentLate, isRentPartial, currentMonth, shiftMonth, monthLabel, periodFor, leasesForMonth,
  fetchSharedRunnerMonth,
  type Lease, type LeaseInput, type Venue, type RentStamp, type RentKind, type SharedRunnerMonth, type SharedRunnerDay,
} from '@/lib/tenants'

const fmtHrs = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))
const money = (n: number) => formatCurrency(String(n))

function fmtStampDay(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dayLabel(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00')
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`
}

const chipStyle = (kind: 'paid' | 'open' | 'late' | 'none' | 'partial'): CSSProperties => ({
  fontSize: 9.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
  padding: '5px 11px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0,
  ...(kind === 'paid' ? { background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)' }
    : kind === 'late' ? { background: 'var(--c-st-hot)', color: '#fff' }
    : kind === 'partial' ? { background: 'var(--c-st-warm)', color: 'var(--c-chip-ink)' }
    : { background: 'var(--c-wash2)', opacity: kind === 'none' ? 0.6 : 1 }),
})

const lbl: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.5, display: 'block', marginBottom: 3 }

export function TenantsView() {
  const { profile } = useUserProfile()
  const isMobile = useIsMobile()
  const woVersion = useWoInvoicesVersion()
  const canEdit = profile?.role === 'owner' || profile?.role === 'manager'

  const [leases, setLeases] = useState<Lease[]>([])
  const [boardMonth, setBoardMonth] = useState(currentMonth())
  const [stamps, setStamps] = useState<Map<string, RentStamp>>(new Map())
  const [shared, setShared] = useState<Record<string, SharedRunnerMonth>>({})
  const [sheetMonth, setSheetMonth] = useState<string | null>(null) // null = board
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Lease | 'new' | null>(null)
  const [ledgerFor, setLedgerFor] = useState<Lease | null>(null)
  const [payFor, setPayFor] = useState<{ lease: Lease; month: string } | null>(null)
  const [showPast, setShowPast] = useState(false)

  // The incidentals month on the board is the month BEFORE the rent month —
  // September's board carries August's incidentals (they go out the 2nd–3rd).
  const incMonth = shiftMonth(boardMonth, -1)

  const loadLeases = useCallback(async () => { setLeases(await fetchLeases()) }, [])
  const loadStamps = useCallback(async () => {
    setStamps(await fetchRentStamps([boardMonth, incMonth]))
    setLoading(false)
  }, [boardMonth, incMonth])
  const loadShared = useCallback(async (month: string) => {
    const m = await fetchSharedRunnerMonth(month)
    setShared(prev => ({ ...prev, [month]: m }))
  }, [])

  useEffect(() => {
    const ch = supabase
      .channel('tenants-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenant_rent_months' }, () => { loadStamps() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leases' }, () => { loadLeases() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadStamps, loadLeases])

  useEffect(() => { loadLeases() }, [loadLeases])
  useEffect(() => { loadStamps() }, [loadStamps])
  useEffect(() => { loadShared(incMonth) }, [loadShared, incMonth, woVersion])
  useEffect(() => { if (sheetMonth) loadShared(sheetMonth) }, [loadShared, sheetMonth, woVersion])

  async function run(key: string, fn: () => Promise<boolean>) {
    if (busy) return
    setBusy(key)
    try { if (await fn()) await loadStamps() } finally { setBusy(null) }
  }

  // ── Derived board figures ──────────────────────────────────────────────────

  const active = leasesForMonth(leases, boardMonth)
  const past = leases.filter(l => !active.includes(l))
  const roll = active.reduce((s, l) => s + l.amount, 0)
  const collected = active.reduce((s, l) => {
    const st = stamps.get(stampKey(l.id, boardMonth, 'rent'))
    return s + (st?.paidAt ? (st.amount ?? l.amount) : (st?.paidAmount ?? 0))
  }, 0)
  const anyLate = active.some(l => isRentLate(stamps.get(stampKey(l.id, boardMonth, 'rent')), periodFor(l, boardMonth)))

  // ── The stamp cell: chip + one button + undo ───────────────────────────────

  function StampCell({ lease, month, kind }: { lease: Lease; month: string; kind: RentKind }) {
    const key = stampKey(lease.id, month, kind)
    const st = stamps.get(key)
    const p = periodFor(lease, month)
    const late = isRentLate(st, p)
    const partial = kind === 'rent' && isRentPartial(st)
    const chip = st?.qbAt
      ? <span style={chipStyle('paid')} title={`Paid ${st.paidAt ? fmtStampDay(st.paidAt) : ''} · entered in QuickBooks`}>In QB · {fmtStampDay(st.qbAt)}</span>
      : st?.paidAt
        ? <span style={chipStyle('paid')}>Paid · {fmtStampDay(st.paidAt)}</span>
        : partial
          ? <span style={late ? chipStyle('late') : chipStyle('partial')} title={`${money(st!.paidAmount!)} of ${money(st!.amount ?? lease.amount)}`}>Partial{late ? ' · late' : ''}</span>
          : late
            ? <span style={chipStyle('late')} title={`Unpaid past ${fmtStampDay(p.lateFrom + 'T12:00:00')}`}>Open · late</span>
            : st?.sentAt
              ? <span style={chipStyle('open')}>Open</span>
              : <span style={chipStyle('none')}>Not sent</span>
    const action = st?.qbAt ? null : st?.paidAt
      ? <button className="c-bact" disabled={busy === key}
          title="The payment has been entered in QuickBooks (manual for now)"
          onClick={() => run(key, () => markRentQb(lease, month, kind, profile?.id ?? null))}>
          In QB
        </button>
      : !st?.sentAt && !partial
        ? <button className="c-bact" disabled={busy === key}
            onClick={() => run(key, () => markRentSent(lease, month, kind, profile?.id ?? null))}>
            Mark sent
          </button>
        : <button className="c-bact" disabled={busy === key}
            onClick={() => kind === 'rent'
              ? setPayFor({ lease, month })
              : run(key, () => markRentPaid(lease, month, kind, profile?.id ?? null))}>
            Mark paid
          </button>
    const undo = (st?.qbAt || st?.paidAt || st?.sentAt || partial) && (
      <button
        title={st?.qbAt ? 'Undo — not actually in QuickBooks' : (st?.paidAt || partial) ? 'Undo — not actually paid' : 'Undo — the email didn’t go out'}
        disabled={busy === key}
        onClick={() => run(key, () => st?.qbAt
          ? undoRentQb(lease, month, kind)
          : (st?.paidAt || partial)
            ? undoRentPaid(lease, month, kind)
            : undoRentSent(lease, month, kind))}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-fg)', opacity: 0.35, fontSize: 12, padding: '2px 4px' }}
      >↩</button>
    )
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
        {st?.sentAt && !st?.paidAt && !isMobile && (
          <span style={{ fontSize: 10, opacity: 0.45, whiteSpace: 'nowrap' }}>sent {fmtStampDay(st.sentAt)}</span>
        )}
        {chip}{action}{undo}
      </span>
    )
  }

  // ── The Mustard sheet ──────────────────────────────────────────────────────

  if (sheetMonth) {
    const m = shared[sheetMonth]
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="c-bact" onClick={() => setSheetMonth(null)}>← Rent board</button>
          <span className="c-arch" style={{ fontSize: 13 }}>Mustard — shared runner</span>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', background: 'var(--c-wash2)', padding: '3px 8px', borderRadius: 99, opacity: 0.8 }}>
            {SHARED_RUNNER.splitLabel}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontWeight: 700, fontSize: 12 }}>
            <button className="c-bact" onClick={() => setSheetMonth(shiftMonth(sheetMonth, -1))}>‹</button>
            {monthLabel(sheetMonth)}
            <button className="c-bact" onClick={() => setSheetMonth(shiftMonth(sheetMonth, 1))}>›</button>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
          {[
            { v: m ? fmtHrs(m.runnerHours) : '…', l: 'Runner hrs' },
            { v: m ? fmtHrs(m.solo) : '…', l: 'Solo · full' },
            { v: m ? fmtHrs(m.shared) : '…', l: 'Shared · ½', warm: true },
            { v: m ? fmtHrs(m.billable) : '…', l: 'Billable hrs', hero: true },
          ].map(s => (
            <div key={s.l} className="c-bstat" style={s.hero ? { outline: '2px solid var(--c-st-booked)', outlineOffset: -2 } : undefined}>
              <div className="c-arch" style={{ fontSize: 20, letterSpacing: '-0.02em', color: s.hero ? 'var(--c-st-booked)' : s.warm ? 'var(--c-st-warm)' : undefined }}>{s.v}</div>
              <div style={{ fontSize: 10, opacity: 0.55, marginTop: 1 }}>{s.l}</div>
            </div>
          ))}
        </div>

        <div className="c-panel" style={{ padding: '12px 14px' }}>
          {!m && <div className="c-bempty">Loading…</div>}
          {m && m.days.length === 0 && (
            <div className="c-bempty">No runner hours or billed ERS·A sessions in {monthLabel(sheetMonth)}.</div>
          )}
          {m && m.days.length > 0 && (
            <>
              {!isMobile && (
                <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr 1fr 64px 64px', gap: 10, padding: '0 10px 5px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.45 }}>
                  <span>Day</span><span>Mustard runner</span><span>ERS·A billed</span>
                  <span style={{ textAlign: 'right' }}>Solo</span><span style={{ textAlign: 'right' }}>Shared</span>
                </div>
              )}
              {m.days.map(d => <SheetDay key={d.date} d={d} isMobile={isMobile} />)}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 64px 64px' : '78px 1fr 1fr 64px 64px', gap: 10, padding: '10px 10px 0', fontWeight: 800, fontSize: 12, borderTop: '1.5px solid var(--c-wash2)', marginTop: 8 }}>
                <span>Totals</span>
                {!isMobile && <span style={{ opacity: 0.5 }}>{fmtHrs(m.runnerHours)} hrs typed</span>}
                {!isMobile && <span />}
                <span style={{ textAlign: 'right' }}>{fmtHrs(m.solo)}</span>
                <span style={{ textAlign: 'right', color: 'var(--c-st-warm)' }}>{fmtHrs(m.shared)}</span>
              </div>
            </>
          )}
          <div className="c-bnote">
            Billable = solo + shared ÷ 2{m ? ` = ${fmtHrs(m.billable)} hrs` : ''} — the figure for the
            QuickBooks incidentals invoice (goes out the 2nd–3rd). Solo hours bill full; hours where a
            billed ERS·A session was running bill half. Derived fresh from the work orders'
            studio-time rows on every load — edit a time anywhere and this sheet is simply correct.
            A dashed day means ERS·A ran but no runner hours are typed on Mustard's work order.
          </div>
        </div>
      </div>
    )
  }

  // ── The rent board ─────────────────────────────────────────────────────────

  const boardShared = shared[incMonth]

  function LeaseRow({ l }: { l: Lease }) {
    const p = periodFor(l, boardMonth)
    const st = stamps.get(stampKey(l.id, boardMonth, 'rent'))
    const amt = st?.amount ?? l.amount
    const paid = st?.paidAt ? amt : (st?.paidAmount ?? 0)
    return (
      <div>
        <div className="c-panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', marginTop: 5, flexWrap: isMobile ? 'wrap' : undefined }}>
          <span style={{ fontWeight: 800, fontSize: 11.5, minWidth: isMobile ? 0 : 92, flexShrink: 0 }}>{l.roomLabel}</span>
          <button
            onClick={() => setLedgerFor(l)}
            title="Ledger — every month for this tenant"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-fg)', fontWeight: 700, fontSize: 12.5, textAlign: 'left' }}
          >
            {l.tenant}
            {l.hasWorkOrder && (
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', background: 'var(--c-wash2)', padding: '3px 8px', borderRadius: 99, opacity: 0.8 }}>WO + incidentals</span>
            )}
          </button>
          {!isMobile && (
            <span style={{ fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' }}>
              {p.label}
              <span style={{ display: 'block', fontSize: 9.5, opacity: 0.7 }}>due {fmtStampDay(p.start + 'T12:00:00')}</span>
            </span>
          )}
          <span style={{ fontWeight: 700, fontSize: 12, opacity: 0.85, marginLeft: isMobile ? 0 : 6, whiteSpace: 'nowrap' }}>
            {money(amt)}
            {paid > 0 && paid < amt && <span style={{ display: 'block', fontSize: 9.5, fontWeight: 400, opacity: 0.6 }}>paid {money(paid)}</span>}
          </span>
          <StampCell lease={l} month={boardMonth} kind="rent" />
          {canEdit && (
            <button className="c-bmore" title="Edit tenant" onClick={() => setEditing(l)} style={{ fontSize: 13, padding: '2px 5px' }}>✎</button>
          )}
        </div>
        {l.hasWorkOrder && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 12px 7px 26px', fontSize: 11.5, flexWrap: isMobile ? 'wrap' : undefined }}>
            <span style={{ fontWeight: 700 }}>
              Incidentals — {monthLabel(incMonth)}
              <span style={{ display: 'block', fontSize: 9.5, fontWeight: 400, opacity: 0.55 }}>
                goes out the 2nd–3rd · shared runner {SHARED_RUNNER.splitLabel} · OT on the work order
              </span>
            </span>
            <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>
              {boardShared ? `${fmtHrs(boardShared.billable)} hrs` : '…'}
            </span>
            <button className="c-bact" onClick={() => setSheetMonth(incMonth)}>Month sheet →</button>
            <StampCell lease={l} month={incMonth} kind="incidentals" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {canEdit && <button className="c-bact" onClick={() => setEditing('new')}>+ Tenant</button>}
        {past.length > 0 && (
          <button className="c-bact" onClick={() => setShowPast(v => !v)} style={{ opacity: 0.7 }}>
            {showPast ? 'Hide past' : `Past tenants (${past.length})`}
          </button>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontWeight: 700, fontSize: 12 }}>
          <button className="c-bact" onClick={() => setBoardMonth(shiftMonth(boardMonth, -1))}>‹</button>
          {monthLabel(boardMonth)}
          <button className="c-bact" onClick={() => setBoardMonth(shiftMonth(boardMonth, 1))}>›</button>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        {[
          { v: money(roll), l: 'Rent roll / mo' },
          { v: money(collected), l: `Collected · ${monthLabel(boardMonth).slice(0, 3)}` },
          { v: money(roll - collected), l: 'Still open', alert: roll - collected > 0 && anyLate },
          { v: String(active.length), l: 'Tenants' },
        ].map(s => (
          <div key={s.l} className="c-bstat">
            <div className="c-arch" style={{ fontSize: 20, letterSpacing: '-0.02em', color: s.alert ? 'var(--c-st-hot)' : undefined }}>{s.v}</div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 1 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {loading && <div className="c-bempty">Loading…</div>}
      {!loading && active.length === 0 && <div className="c-bempty">No tenants in {monthLabel(boardMonth)}.</div>}

      {!loading && VENUES.map(venue => {
        const rows = active.filter(l => l.venue === venue)
        if (rows.length === 0) return null
        return (
          <div key={venue} style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.4, margin: '14px 2px 4px' }}>{venue}</div>
            {rows.map(l => <LeaseRow key={l.id} l={l} />)}
          </div>
        )
      })}

      {showPast && past.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.4, margin: '14px 2px 4px' }}>Not in {monthLabel(boardMonth)}</div>
          {past.map(l => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', marginTop: 5, border: '1.5px dashed var(--c-wash2)', borderRadius: 10, fontSize: 12, opacity: 0.7 }}>
              <span style={{ fontWeight: 800, fontSize: 11.5, minWidth: isMobile ? 0 : 92 }}>{l.roomLabel}</span>
              <button onClick={() => setLedgerFor(l)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-fg)', fontWeight: 700, fontSize: 12.5 }}>{l.tenant}</button>
              <span style={{ fontSize: 10.5, opacity: 0.6 }}>
                {l.startDate > periodFor(l, boardMonth).end ? `starts ${fmtStampDay(l.startDate + 'T12:00:00')}` : `ended ${l.endDate ? fmtStampDay(l.endDate + 'T12:00:00') : ''}`}
              </span>
              <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(l.amount)}</span>
              {canEdit && <button className="c-bmore" title="Edit tenant" onClick={() => setEditing(l)} style={{ fontSize: 13, padding: '2px 5px' }}>✎</button>}
            </div>
          ))}
        </div>
      )}

      <div className="c-bnote" style={{ marginTop: 14 }}>
        One button per row, always the next act: Mark sent (the rent email went out) → Mark paid
        (asks how much — less than the full amount is a Partial) → In QB (entered in QuickBooks,
        manual for now). ↩ undoes a misclick. Each row shows its period; unpaid five days past the
        period start goes hot. Tap a name for that tenant’s ledger. Tenants don’t have work orders —
        except a lease marked “has a work order” (Mustard), whose overtime and shared-runner hours
        bill through Billing like any other WO.
      </div>

      {payFor && (
        <PayModal
          lease={payFor.lease}
          month={payFor.month}
          stamp={stamps.get(stampKey(payFor.lease.id, payFor.month, 'rent'))}
          onClose={() => setPayFor(null)}
          onSave={async amt => {
            const key = stampKey(payFor.lease.id, payFor.month, 'rent')
            await run(key, () => markRentPaid(payFor.lease, payFor.month, 'rent', profile?.id ?? null, amt))
            setPayFor(null)
          }}
        />
      )}
      {ledgerFor && <LedgerModal lease={ledgerFor} onClose={() => setLedgerFor(null)} />}
      {editing && (
        <LeaseModal
          lease={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await loadLeases(); await loadStamps() }}
        />
      )}
    </div>
  )
}

// ── Mark paid: how much? ─────────────────────────────────────────────────────

function PayModal({ lease, month, stamp, onClose, onSave }: {
  lease: Lease; month: string; stamp: RentStamp | undefined
  onClose: () => void; onSave: (amount: number) => Promise<void>
}) {
  const amt = stamp?.amount ?? lease.amount
  const already = stamp?.paidAmount ?? 0
  const [val, setVal] = useState(String(amt))
  const [saving, setSaving] = useState(false)
  const n = parseFloat(val)
  const ok = !isNaN(n) && n > 0 && n <= amt + 0.005
  const p = periodFor(lease, month)
  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="c-arch" style={{ fontSize: 15, marginBottom: 2 }}>{lease.tenant} — paid</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 14 }}>{p.label} · {money(amt)} due{already > 0 ? ` · ${money(already)} already in` : ''}</div>
        <label style={lbl}>Amount received (total for this period)</label>
        <input className="c-input" type="number" step="0.01" min="0" value={val} onChange={e => setVal(e.target.value)} autoFocus
          style={{ width: '100%', fontSize: 16, fontWeight: 700 }} />
        {ok && n < amt - 0.005 && (
          <div style={{ fontSize: 11, marginTop: 8, color: 'var(--c-st-warm)', fontWeight: 700 }}>Partial — {money(amt - n)} still open.</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="c-bact" onClick={onClose}>Cancel</button>
          <button className="c-bact" disabled={!ok || saving} onClick={async () => { setSaving(true); await onSave(n) }}>
            {ok && n < amt - 0.005 ? 'Record partial' : 'Paid in full'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── The ledger: every period for one tenant ──────────────────────────────────

function LedgerModal({ lease, onClose }: { lease: Lease; onClose: () => void }) {
  const [rows, setRows] = useState<RentStamp[] | null>(null)
  useEffect(() => { fetchLeaseLedger(lease.id).then(setRows) }, [lease.id])
  const balance = (rows ?? []).reduce((s, r) => s + ((r.amount ?? lease.amount) - (r.paidAt ? (r.amount ?? lease.amount) : (r.paidAmount ?? 0))), 0)
  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="c-arch" style={{ fontSize: 15 }}>{lease.tenant} — {lease.roomLabel}</span>
          <span style={{ fontSize: 11, opacity: 0.55 }}>{money(lease.amount)} / mo · starts the {lease.anchorDay}{lease.anchorDay === 1 ? 'st' : 'th'} · since {fmtStampDay(lease.startDate + 'T12:00:00')}{lease.endDate ? ` · ended ${fmtStampDay(lease.endDate + 'T12:00:00')}` : ''}</span>
          {balance > 0 && <span style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 12, color: 'var(--c-st-hot)' }}>Balance {money(balance)}</span>}
        </div>
        {!rows && <div className="c-bempty">Loading…</div>}
        {rows && rows.length === 0 && <div className="c-bempty">Nothing stamped yet.</div>}
        {rows && rows.length > 0 && (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 96px', gap: 8, padding: '0 8px 4px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.45 }}>
              <span>Period</span><span style={{ textAlign: 'right' }}>Invoiced</span><span style={{ textAlign: 'right' }}>Paid</span><span style={{ textAlign: 'right' }}>Balance</span><span />
            </div>
            {rows.map(r => {
              const p = periodFor(lease, r.month)
              const amt = r.amount ?? lease.amount
              const paid = r.paidAt ? amt : (r.paidAmount ?? 0)
              const bal = amt - paid
              return (
                <div key={r.month} className="c-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 96px', gap: 8, alignItems: 'center', padding: '7px 8px', marginTop: 4, fontSize: 11.5 }}>
                  <span>
                    {p.label}, {r.month.slice(0, 4)}
                    <span style={{ display: 'block', fontSize: 9.5, opacity: 0.5 }}>
                      {[r.sentAt && `sent ${fmtStampDay(r.sentAt)}`, r.paidAt && `paid ${fmtStampDay(r.paidAt)}`, r.qbAt && `QB ${fmtStampDay(r.qbAt)}`].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right', fontWeight: 700 }}>{money(amt)}</span>
                  <span style={{ textAlign: 'right', fontWeight: 700 }}>{money(paid)}</span>
                  <span style={{ textAlign: 'right', fontWeight: 700, color: bal > 0 ? 'var(--c-st-hot)' : undefined, opacity: bal > 0 ? 1 : 0.4 }}>{money(bal)}</span>
                  <span style={{ justifySelf: 'end' }}>
                    {r.qbAt ? <span style={chipStyle('paid')}>In QB</span>
                      : r.paidAt ? <span style={chipStyle('paid')}>Paid</span>
                      : paid > 0 ? <span style={chipStyle('partial')}>Partial</span>
                      : isRentLate(r, p) ? <span style={chipStyle('late')}>Late</span>
                      : <span style={chipStyle('open')}>Open</span>}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="c-bact" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Add / edit a tenant ──────────────────────────────────────────────────────

function LeaseModal({ lease, onClose, onSaved }: { lease: Lease | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [v, setV] = useState<LeaseInput>(lease
    ? { tenant: lease.tenant, venue: lease.venue, roomLabel: lease.roomLabel, amount: lease.amount, anchorDay: lease.anchorDay, startDate: lease.startDate, endDate: lease.endDate, hasWorkOrder: lease.hasWorkOrder, notes: lease.notes }
    : { tenant: '', venue: 'Paramount', roomLabel: '', amount: 0, anchorDay: 1, startDate: currentMonth() + '-01', endDate: null, hasWorkOrder: false, notes: null })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof LeaseInput>(k: K, val: LeaseInput[K]) => setV(prev => ({ ...prev, [k]: val }))
  const ok = v.tenant.trim() && v.roomLabel.trim() && v.amount > 0 && v.anchorDay >= 1 && v.anchorDay <= 28 && v.startDate
    && (!v.endDate || v.endDate >= v.startDate)

  async function save() {
    if (!ok || saving) return
    setSaving(true)
    const done = lease ? await updateLease(lease.id, v) : await createLease(v)
    setSaving(false)
    if (done) await onSaved()
  }
  async function remove() {
    if (!lease || saving) return
    setSaving(true)
    const done = await deleteLease(lease.id)
    setSaving(false)
    if (done) await onSaved()
  }

  const field: CSSProperties = { width: '100%' }
  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="c-arch" style={{ fontSize: 15, marginBottom: 14 }}>{lease ? `Edit — ${lease.tenant}` : 'New tenant'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>Tenant</label>
            <input className="c-input" style={field} value={v.tenant} onChange={e => set('tenant', e.target.value)} autoFocus />
          </div>
          <div>
            <label style={lbl}>Venue</label>
            <select className="c-input" style={field} value={v.venue} onChange={e => set('venue', e.target.value as Venue)}>
              {VENUES.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Room(s)</label>
            <input className="c-input" style={field} value={v.roomLabel} placeholder="Studio B · South + PR1" onChange={e => set('roomLabel', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Rent / month</label>
            <input className="c-input" style={field} type="number" step="0.01" min="0" value={v.amount || ''} onChange={e => set('amount', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label style={lbl}>Period starts on the</label>
            <input className="c-input" style={field} type="number" min="1" max="28" value={v.anchorDay} onChange={e => set('anchorDay', Math.max(1, Math.min(28, parseInt(e.target.value) || 1)))} />
          </div>
          <div>
            <label style={lbl}>Start date</label>
            <input className="c-input" style={field} type="date" value={v.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>End date (blank = ongoing)</label>
            <input className="c-input" style={field} type="date" value={v.endDate ?? ''} onChange={e => set('endDate', e.target.value || null)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={v.hasWorkOrder} onChange={e => set('hasWorkOrder', e.target.checked)} />
              <span><b>Has a work order</b> — runners fill day cards, office approves daily; OT and shared-runner hours bill through Billing. (Mustard.)</span>
            </label>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>Notes</label>
            <input className="c-input" style={field} value={v.notes ?? ''} onChange={e => set('notes', e.target.value || null)} />
          </div>
        </div>
        <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 10, lineHeight: 1.5 }}>
          Changing the rent affects months from now on — stamped months keep the amount they were invoiced at. A tenant who leaves gets an end date; the row stays for their ledger.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          {lease && !confirmDelete && (
            <button className="c-bact" onClick={() => setConfirmDelete(true)} style={{ opacity: 0.6 }} title="Only for a tenant entered by mistake — refused once months are stamped">Delete</button>
          )}
          {lease && confirmDelete && (
            <button className="c-bact" onClick={remove} disabled={saving} style={{ color: 'var(--c-st-hot)' }}>Really delete</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="c-bact" onClick={onClose}>Cancel</button>
          <button className="c-bact" disabled={!ok || saving} onClick={save}>{lease ? 'Save' : 'Add tenant'}</button>
        </div>
      </div>
    </div>
  )
}

function SheetDay({ d, isMobile }: { d: SharedRunnerDay; isMobile: boolean }) {
  const winText = (w: { from: string; to: string }) => `${w.from} – ${w.to}`
  return (
    <div
      className={d.missing ? undefined : 'c-panel'}
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '58px 1fr 52px 52px' : '78px 1fr 1fr 64px 64px',
        gap: 10, alignItems: 'center', padding: '8px 10px', marginTop: 5, fontSize: 12,
        ...(d.missing ? { border: '1.5px dashed var(--c-wash2)', borderRadius: 10 } : {}),
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 11.5 }}>{dayLabel(d.date)}</span>
      <span style={{ opacity: d.missing ? 0.5 : 0.85, fontStyle: d.missing ? 'italic' : undefined }}>
        {d.missing
          ? 'no hours on Mustard’s WO'
          : d.runner.map(winText).join(' · ')}
        {!d.missing && (
          <span style={{ display: 'block', fontSize: 10, opacity: 0.55 }}>
            {fmtHrs(d.runner.reduce((s, w) => s + w.hours, 0))} hrs
          </span>
        )}
        {isMobile && d.sessions.length > 0 && (
          <span style={{ display: 'block', fontSize: 10, opacity: 0.55 }}>
            ERS·A: {d.sessions.map(winText).join(' · ')}
          </span>
        )}
      </span>
      {!isMobile && (
        <span style={{ opacity: d.sessions.length ? 0.85 : 0.35 }}>
          {d.sessions.length === 0 ? '—' : d.sessions.map(winText).join(' · ')}
          {d.sessions.length > 0 && (
            <span style={{ display: 'block', fontSize: 10, opacity: 0.55 }}>
              {d.sessions.map(s => s.label).filter(Boolean).join(' · ') || 'billed session'}
            </span>
          )}
        </span>
      )}
      <span style={{ textAlign: 'right', fontWeight: 700, opacity: d.missing ? 0.35 : 1 }}>
        {d.missing ? '—' : fmtHrs(d.solo)}
      </span>
      <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--c-st-warm)', opacity: d.missing ? 0.35 : 1 }}>
        {d.missing ? '—' : fmtHrs(d.shared)}
      </span>
    </div>
  )
}
