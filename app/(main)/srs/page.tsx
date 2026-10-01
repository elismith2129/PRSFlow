'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /srs — Studio Referral Service payouts (Eli, 2026-10-01; mock
// docs/design-refs/srs-options.html, option A + adjustable percent).
//
// ITS OWN ROUTE, UNDER BILLING IN THE RAIL. It used to be a tab on /admin and
// vanished from sight when the rail rebuild gave every other Admin tab its own
// link and dropped /admin itself.
//
// ONE ONGOING LIST, OWED ON TOP. "simple ongoing list and clear indication of
// whats paid. its only a couple a month." Owed rows: orange Mark paid. Paid
// rows: greyed, green "Paid · date" chip — tap it to undo. Rounded up on the
// 1st (the bil_srs_roundup duty), but nothing here is month-shaped on purpose.
//
// PERCENT: studio default (owner/manager edit it, ✎ by the title) and a
// per-session override on any owed row (tap the % chip). Paid rows are frozen
// at what was paid. All the model is in lib/srs.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase, type Booking } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatCurrency } from '@/lib/format'
import { getLocalToday } from '@/lib/time'
import { toast } from '@/components/ui/Toaster'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import {
  fetchSrsDefaultPct, setSrsDefaultPct, fetchSrsRows, setSrsPct, markSrsPaid, undoSrsPaid, feeFor,
  fetchSrsHistory, SRS_DEFAULT_PCT_FALLBACK, type SrsRow, type SrsHistoryRow,
} from '@/lib/srs'

const money = (v: number) => formatCurrency(String(v.toFixed(2)))
// Paid runs back to 2023, so a date outside this year carries its year.
const shortDay = (d: string | null) => {
  if (!d) return '—'
  const dt = new Date(d.slice(0, 10) + 'T12:00:00')
  const sameYear = dt.getFullYear() === new Date().getFullYear()
  return dt.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: '2-digit' })
}
const pctLabel = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1)}%`

const lbl: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.5, display: 'block', marginBottom: 3 }
const sec: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.4, margin: '16px 2px 4px', display: 'flex', justifyContent: 'space-between' }
const btn96: CSSProperties = { width: 96, textAlign: 'center', justifyContent: 'center', flexShrink: 0 }
const PAID_SHOWN = 6

export default function SrsPage() {
  const { profile } = useUserProfile()
  const isMobile = useIsMobile()
  const role = profile?.role
  const allowed = role === 'owner' || role === 'manager' || role === 'billing'
  const canEditDefault = role === 'owner' || role === 'manager'

  const [defaultPct, setDefaultPct] = useState(SRS_DEFAULT_PCT_FALLBACK)
  const [rows, setRows] = useState<SrsRow[]>([])
  const [history, setHistory] = useState<SrsHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<SrsRow | null>(null)
  const [pctFor, setPctFor] = useState<SrsRow | 'default' | null>(null)
  const [showAllPaid, setShowAllPaid] = useState(false)
  const [openBooking, setOpenBooking] = useState<Booking | null>(null)

  const load = useCallback(async () => {
    const d = await fetchSrsDefaultPct()
    setDefaultPct(d)
    const [r, h] = await Promise.all([fetchSrsRows(d), fetchSrsHistory()])
    setRows(r)
    setHistory(h)
    setLoading(false)
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])
  useEffect(() => {
    if (!allowed) return
    const ch = supabase
      .channel('srs-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'srs_payouts' }, () => { load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [allowed, load])

  async function run(key: string, fn: () => Promise<boolean>) {
    if (busy) return
    setBusy(key)
    try { if (await fn()) await load() } finally { setBusy(null) }
  }

  async function openWo(r: SrsRow) {
    if (!r.bookingId) { toast('This work order has no session attached, so there is nothing to open.'); return }
    const { data } = await supabase.from('bookings').select('*').eq('id', r.bookingId).limit(1)
    const b = data?.[0] as Booking | undefined
    if (!b) { toast('That session has been deleted, so the work order cannot be opened.'); return }
    setOpenBooking(b)
  }

  // WorkOrderPopup never mounts beside a realtime list (billing hub rule).
  if (openBooking) {
    return <WorkOrderPopup booking={openBooking} onClose={() => { setOpenBooking(null); load() }} />
  }

  if (profile && !allowed) {
    return <div className="c-bempty">SRS payouts are for the office.</div>
  }

  const owed = rows.filter(r => !r.paidAt).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  // Paid = the app's paid sessions + the spreadsheet history, newest session first.
  type PaidItem = { kind: 'wo'; date: string; r: SrsRow } | { kind: 'log'; date: string; h: SrsHistoryRow }
  const paid: PaidItem[] = [
    ...rows.filter(r => r.paidAt).map(r => ({ kind: 'wo' as const, date: r.date ?? '', r })),
    ...history.filter(h => h.paid).map(h => ({ kind: 'log' as const, date: h.date, h })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const owedTotal = owed.reduce((s, r) => s + r.fee, 0)
  const paidShown = showAllPaid ? paid : paid.slice(0, PAID_SHOWN)

  // A row from Eli's spreadsheet log: no work order, read-only, as recorded.
  function LogRow({ h }: { h: SrsHistoryRow }) {
    return (
      <div className="c-panel" title={h.note ?? undefined} style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', marginTop: 5,
        flexWrap: isMobile ? 'wrap' : undefined, opacity: 0.55, boxShadow: 'none', background: 'var(--c-wash)',
      }}>
        <span className="c-mono" style={{ fontSize: 11, opacity: 0.6, width: 50, flexShrink: 0 }}>{shortDay(h.date)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 12.5 }}>{h.client}</span>
          <span style={{ display: 'block', fontSize: 10.5, opacity: 0.5 }}>
            {[h.dateLabel, h.invoiceNumber ? `Inv #${h.invoiceNumber}` : null, 'from the log', h.note].filter(Boolean).join(' · ')}
          </span>
        </span>
        {h.pct != null && (
          <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 9px', borderRadius: 99, background: 'var(--c-wash2)', flexShrink: 0 }}>{pctLabel(h.pct)}</span>
        )}
        <span style={{ textAlign: 'right', width: 108, flexShrink: 0 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{money(h.fee)}</span>
          {h.roomCharges != null && <span style={{ display: 'block', fontSize: 9.5, opacity: 0.45 }}>of {money(h.roomCharges)} rooms</span>}
        </span>
        <span style={{ ...btn96, fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', padding: '9px 0', borderRadius: 8, background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', display: 'inline-block' }}>
          {h.paidOn ? `Paid · ${shortDay(h.paidOn)}` : 'Paid'}
        </span>
      </div>
    )
  }

  function Row({ r }: { r: SrsRow }) {
    const isPaid = !!r.paidAt
    const key = r.workOrderId
    const pctChip: CSSProperties = {
      fontSize: 10, fontWeight: 800, padding: '4px 9px', borderRadius: 99, border: 'none', fontFamily: 'inherit',
      background: r.overridePct != null && !isPaid ? 'var(--c-st-warm)' : 'var(--c-wash2)',
      color: r.overridePct != null && !isPaid ? 'var(--c-chip-ink)' : 'var(--c-fg)',
      cursor: isPaid ? 'default' : 'pointer', flexShrink: 0,
    }
    return (
      <div className="c-panel" style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', marginTop: 5,
        flexWrap: isMobile ? 'wrap' : undefined,
        ...(isPaid ? { opacity: 0.55, boxShadow: 'none', background: 'var(--c-wash)' } : {}),
      }}>
        <span className="c-mono" style={{ fontSize: 11, opacity: 0.6, width: 50, flexShrink: 0 }}>{shortDay(r.date)}</span>
        <button onClick={() => openWo(r)} title="Open the work order"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-fg)', textAlign: 'left', flex: 1, minWidth: 0, fontFamily: 'inherit' }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 12.5 }}>{r.client || r.artist || 'No client name'}</span>
          <span style={{ display: 'block', fontSize: 10.5, opacity: 0.5 }}>
            {[r.woNumber, r.rooms.join(' + ')].filter(Boolean).join(' · ')}
          </span>
        </button>
        <button style={pctChip} disabled={isPaid}
          title={isPaid ? 'Paid at this percent' : r.overridePct != null ? 'Set for this session — tap to change' : 'Studio default — tap to set for this session'}
          onClick={() => !isPaid && setPctFor(r)}>
          {pctLabel(r.pct)}
        </button>
        <span style={{ textAlign: 'right', width: 108, flexShrink: 0 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{money(r.fee)}</span>
          <span style={{ display: 'block', fontSize: 9.5, opacity: 0.45 }}>of {money(r.roomCharges)} rooms</span>
        </span>
        {isPaid ? (
          <button className="c-bact" disabled={busy === key}
            style={{ ...btn96, background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', border: 'none' }}
            title="Tap to undo — not actually paid"
            onClick={() => { if (confirm(`Undo paid on ${r.client || r.woNumber}?`)) run(key, () => undoSrsPaid(r.workOrderId)) }}>
            Paid · {shortDay(r.paidOn ?? r.paidAt)}
          </button>
        ) : (
          <button className="c-bact" disabled={busy === key}
            style={{ ...btn96, background: 'var(--c-st-warm)', color: 'var(--c-chip-ink)', border: 'none' }}
            onClick={() => setPayFor(r)}>
            Mark paid
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <h1 className="c-arch" style={{ fontSize: 22, letterSpacing: '-0.01em', margin: '2px 0 4px' }}>SRS</h1>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            Default {pctLabel(defaultPct)} of room charges
            {canEditDefault && (
              <button className="c-bmore" title="Change the studio default" onClick={() => setPctFor('default')} style={{ fontSize: 13, padding: '0 5px', marginLeft: 4 }}>✎</button>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={lbl}>Owed · {owed.length} {owed.length === 1 ? 'session' : 'sessions'}</div>
          <div className="c-arch" style={{ fontSize: 22, color: owedTotal > 0 ? 'var(--c-st-warm)' : undefined, fontVariantNumeric: 'tabular-nums' }}>{money(owedTotal)}</div>
        </div>
      </div>

      {loading && <div className="c-bempty">Loading…</div>}

      {!loading && (
        <>
          <div style={sec}><span>Owed</span><span>Round up on the 1st</span></div>
          {owed.length === 0 && <div className="c-bempty">Nothing owed.</div>}
          {owed.map(r => <Row key={r.workOrderId} r={r} />)}

          {paid.length > 0 && <div style={sec}><span>Paid</span><span /></div>}
          {paidShown.map(p => p.kind === 'wo'
            ? <Row key={p.r.workOrderId} r={p.r} />
            : <LogRow key={p.h.id} h={p.h} />)}
          {paid.length > PAID_SHOWN && (
            <button onClick={() => setShowAllPaid(s => !s)}
              style={{ display: 'block', margin: '8px auto 0', background: 'none', border: 'none', color: 'var(--c-fg)', opacity: 0.5, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
              {showAllPaid ? 'Show fewer ↑' : `Show ${paid.length - PAID_SHOWN} older paid ↓`}
            </button>
          )}

          <div className="c-bnote" style={{ marginTop: 16 }}>
            Every session with SRS ticked on its work order lands here by itself. The fee is the
            percent × room charges (studio time and overtime; engineering excluded). Tap a % to set
            it for that one session — 20% for one-offs, 10% for a low rate or an extended booking.
            Mark paid asks the date it went out and locks the percent and amount. Tap a green chip
            to undo. Tap a name to open its work order. Rows marked “from the log” are the SRS
            spreadsheet from before PRSFlo (Dec 2023 – Jun 2026), entered as recorded.
          </div>
        </>
      )}

      {payFor && (
        <PayModal row={payFor} onClose={() => setPayFor(null)}
          onSave={async d => { const r = payFor; setPayFor(null); await run(r.workOrderId, () => markSrsPaid(r, d, profile?.id ?? null)) }} />
      )}
      {pctFor && (
        <PctModal
          title={pctFor === 'default' ? 'Studio default' : `${pctFor.client || pctFor.woNumber} — this session`}
          sub={pctFor === 'default'
            ? 'Applies to every owed session that isn’t set on its own. Paid sessions keep what they were paid at.'
            : `${money(pctFor.roomCharges)} room charges`}
          start={pctFor === 'default' ? defaultPct : pctFor.pct}
          preview={pctFor === 'default' ? null : pctFor.roomCharges}
          onReset={pctFor !== 'default' && pctFor.overridePct != null ? async () => {
            const r = pctFor; setPctFor(null); await run(r.workOrderId, () => setSrsPct(r.workOrderId, null))
          } : null}
          resetLabel={`Use default (${pctLabel(defaultPct)})`}
          onClose={() => setPctFor(null)}
          onSave={async p => {
            const t = pctFor; setPctFor(null)
            if (t === 'default') await run('default', () => setSrsDefaultPct(p))
            else await run(t.workOrderId, () => setSrsPct(t.workOrderId, p))
          }}
        />
      )}
    </div>
  )
}

function PayModal({ row, onClose, onSave }: { row: SrsRow; onClose: () => void; onSave: (onDate: string) => Promise<void> }) {
  const [date, setDate] = useState(getLocalToday())
  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="c-arch" style={{ fontSize: 15, marginBottom: 2 }}>{row.client || row.woNumber} — SRS paid</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 14 }}>
          {money(row.fee)} · {pctLabel(row.pct)} of {money(row.roomCharges)} · {row.woNumber}
        </div>
        <label style={lbl}>Date paid</label>
        <input className="c-input" type="date" value={date} max={getLocalToday()} onChange={e => setDate(e.target.value)} autoFocus
          style={{ width: '100%', fontSize: 13, fontWeight: 700 }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="c-bact" onClick={onClose}>Cancel</button>
          <button className="c-bact" disabled={!date} onClick={() => onSave(date)}>Mark paid</button>
        </div>
      </div>
    </div>
  )
}

function PctModal({ title, sub, start, preview, onReset, resetLabel, onClose, onSave }: {
  title: string; sub: string; start: number; preview: number | null
  onReset: (() => Promise<void>) | null; resetLabel: string
  onClose: () => void; onSave: (pct: number) => Promise<void>
}) {
  const [val, setVal] = useState(String(start))
  const p = parseFloat(val)
  const ok = !isNaN(p) && p >= 0 && p <= 100
  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="c-arch" style={{ fontSize: 15, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 14 }}>{sub}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[20, 15, 10].map(q => (
            <button key={q} className="c-bact" onClick={() => setVal(String(q))}
              style={String(q) === val ? { background: 'var(--c-st-warm)', color: 'var(--c-chip-ink)', border: 'none' } : undefined}>{q}%</button>
          ))}
        </div>
        <label style={lbl}>Percent</label>
        <input className="c-input" type="number" step="0.5" min="0" max="100" value={val} onChange={e => setVal(e.target.value)}
          style={{ width: '100%', fontSize: 15, fontWeight: 700 }} />
        {ok && preview != null && (
          <div style={{ fontSize: 11.5, marginTop: 8, fontWeight: 700 }}>Fee: {money(feeFor(preview, p))}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {onReset && <button className="c-bact" onClick={() => onReset()} style={{ marginRight: 'auto' }}>{resetLabel}</button>}
          <button className="c-bact" onClick={onClose}>Cancel</button>
          <button className="c-bact" disabled={!ok} onClick={() => onSave(p)}>Save</button>
        </div>
      </div>
    </div>
  )
}
