'use client'
// ─────────────────────────────────────────────────────────────────────────────
// TenantsView — the rent board + the Mustard shared-runner sheet
// (Eli, 2026-09-02; mock docs/design-refs/tenants-tab-options.html option A,
// sheet from mustard-shared-runner-options.html option A, HOURS ONLY).
//
// Third word in the billing hub's heading, beside Billing and COD — rendered
// as its own branch like Financials, so the invoice tree and this view never
// acquire each other's conditionals. All model logic lives in lib/tenants.ts;
// this file renders and stamps.
//
// ONE BUTTON PER ROW, ALWAYS THE NEXT ACT (the hub's law): Mark sent (the
// 25th email went out) → Mark paid (stamps the date) → done. "Open" is the
// state between the two, never a button. ↩ undoes the last stamp — a
// misclick must not become a permanent lie about when rent arrived.
//
// REALTIME: own channel on tenant_rent_months, plus a studio_time_rows
// channel for the sheet. The st-rows channel is safe ONLY because this view
// renders in a branch where WorkOrderPopup (which opens its own filtered
// st-rows channel) is unmounted — if TenantsView ever mounts beside the
// popup, one of the two channels has to go. work_orders/payment_rows changes
// arrive via the shared useWoInvoicesVersion, per the standing rule.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useWoInvoicesVersion } from '@/hooks/useWoInvoicesVersion'
import { formatCurrency } from '@/lib/format'
import {
  TENANT_ROOMS, SHARED_RUNNER,
  fetchRentStamps, stampKey, markRentSent, markRentPaid, markRentQb,
  undoRentSent, undoRentPaid, undoRentQb,
  isRentLate, currentMonth, shiftMonth, monthLabel, fetchSharedRunnerMonth,
  type RentStamp, type RentKind, type SharedRunnerMonth, type SharedRunnerDay,
} from '@/lib/tenants'

const VENUES = ['Paramount', 'Ameraycan', 'Track', 'Encore'] as const

const fmtHrs = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

function fmtStampDay(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dayLabel(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00')
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`
}

const chipStyle = (kind: 'paid' | 'open' | 'late' | 'none'): CSSProperties => ({
  fontSize: 9.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
  padding: '5px 11px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0,
  ...(kind === 'paid' ? { background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)' }
    : kind === 'late' ? { background: 'var(--c-st-hot)', color: '#fff' }
    : { background: 'var(--c-wash2)', opacity: kind === 'none' ? 0.6 : 1 }),
})

export function TenantsView() {
  const { profile } = useUserProfile()
  const isMobile = useIsMobile()
  const woVersion = useWoInvoicesVersion()

  const [boardMonth, setBoardMonth] = useState(currentMonth())
  const [stamps, setStamps] = useState<Map<string, RentStamp>>(new Map())
  const [shared, setShared] = useState<Record<string, SharedRunnerMonth>>({})
  const [sheetMonth, setSheetMonth] = useState<string | null>(null) // null = board
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [stVersion, setStVersion] = useState(0)

  // The incidentals month on the board is the month BEFORE the rent month —
  // September's board carries August's incidentals (they go out the 2nd–3rd).
  const incMonth = shiftMonth(boardMonth, -1)

  const loadStamps = useCallback(async () => {
    setStamps(await fetchRentStamps([boardMonth, incMonth]))
    setLoading(false)
  }, [boardMonth, incMonth])

  const loadShared = useCallback(async (month: string) => {
    const m = await fetchSharedRunnerMonth(month)
    setShared(prev => ({ ...prev, [month]: m }))
  }, [])

  // Realtime — the fetch/subscription pairing (standing rule). Stamps get
  // their own channel; the sheet re-derives on studio_time_rows changes and
  // on work_orders/payment_rows movement (shared hook).
  useEffect(() => {
    const ch = supabase
      .channel('tenants-rent-months')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenant_rent_months' }, () => { loadStamps() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadStamps])
  useEffect(() => {
    const ch = supabase
      .channel('tenants-shared-strows')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_time_rows' }, () => { setStVersion(v => v + 1) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  useEffect(() => { loadStamps() }, [loadStamps])
  useEffect(() => { loadShared(incMonth) }, [loadShared, incMonth, woVersion, stVersion])
  useEffect(() => { if (sheetMonth) loadShared(sheetMonth) }, [loadShared, sheetMonth, woVersion, stVersion])

  async function run(key: string, fn: () => Promise<boolean>) {
    if (busy) return
    setBusy(key)
    try { if (await fn()) await loadStamps() } finally { setBusy(null) }
  }

  // ── Derived board figures ──────────────────────────────────────────────────

  const occupied = TENANT_ROOMS.filter(t => t.tenant)
  const roll = occupied.reduce((s, t) => s + t.rent, 0)
  const collected = occupied.reduce((s, t) =>
    s + (stamps.get(stampKey(t.id, boardMonth, 'rent'))?.paidAt ? t.rent : 0), 0)

  // ── The stamp cell: chip + one button + undo ───────────────────────────────

  function StampCell({ roomId, month, kind }: { roomId: string; month: string; kind: RentKind }) {
    const st = stamps.get(stampKey(roomId, month, kind))
    const key = stampKey(roomId, month, kind)
    const late = isRentLate(st, month)
    // The ladder: Not sent → Open (sent) → Paid → In QB (done). One chip
    // names the state, one button offers the next act, ↩ unwinds the last.
    const chip = st?.qbAt
      ? <span style={chipStyle('paid')} title={`Paid ${st.paidAt ? fmtStampDay(st.paidAt) : ''} · entered in QuickBooks`}>In QB · {fmtStampDay(st.qbAt)}</span>
      : st?.paidAt
        ? <span style={chipStyle('paid')}>Paid · {fmtStampDay(st.paidAt)}</span>
        : late
          ? <span style={chipStyle('late')} title="Unpaid past the 5th">Open · late</span>
          : st?.sentAt
            ? <span style={chipStyle('open')}>Open</span>
            : <span style={chipStyle('none')}>Not sent</span>
    const action = st?.qbAt ? null : st?.paidAt
      ? <button className="c-bact" disabled={busy === key}
          title="The payment has been entered in QuickBooks (manual for now)"
          onClick={() => run(key, () => markRentQb(roomId, month, kind, profile?.id ?? null))}>
          In QB
        </button>
      : !st?.sentAt
        ? <button className="c-bact" disabled={busy === key}
            onClick={() => run(key, () => markRentSent(roomId, month, kind, profile?.id ?? null))}>
            Mark sent
          </button>
        : <button className="c-bact" disabled={busy === key}
            onClick={() => run(key, () => markRentPaid(roomId, month, kind, profile?.id ?? null))}>
            Mark paid
          </button>
    const undo = (st?.qbAt || st?.paidAt || st?.sentAt) && (
      <button
        title={st?.qbAt ? 'Undo — not actually in QuickBooks' : st?.paidAt ? 'Undo — not actually paid' : 'Undo — the email didn’t go out'}
        disabled={busy === key}
        onClick={() => run(key, () => st?.qbAt
          ? undoRentQb(roomId, month, kind)
          : st?.paidAt
            ? undoRentPaid(roomId, month, kind)
            : undoRentSent(roomId, month, kind))}
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontWeight: 700, fontSize: 12 }}>
          <button className="c-bact" onClick={() => setBoardMonth(shiftMonth(boardMonth, -1))}>‹</button>
          {monthLabel(boardMonth)}
          <button className="c-bact" onClick={() => setBoardMonth(shiftMonth(boardMonth, 1))}>›</button>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        {[
          { v: formatCurrency(String(roll)), l: 'Rent roll / mo' },
          { v: formatCurrency(String(collected)), l: `Collected · ${monthLabel(boardMonth).slice(0, 3)}` },
          { v: formatCurrency(String(roll - collected)), l: 'Still open', alert: roll - collected > 0 && isRentLate(undefined, boardMonth) },
          { v: `${occupied.length} / ${TENANT_ROOMS.length}`, l: 'Rooms occupied' },
        ].map(s => (
          <div key={s.l} className="c-bstat">
            <div className="c-arch" style={{ fontSize: 20, letterSpacing: '-0.02em', color: s.alert ? 'var(--c-st-hot)' : undefined }}>{s.v}</div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 1 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {loading && <div className="c-bempty">Loading…</div>}

      {!loading && VENUES.map(venue => {
        const rooms = TENANT_ROOMS.filter(t => t.venue === venue)
        if (rooms.length === 0) return null
        return (
          <div key={venue} style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.4, margin: '14px 2px 4px' }}>{venue}</div>
            {rooms.map(t => (
              <div key={t.id}>
                <div
                  className={t.tenant ? 'c-panel' : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', marginTop: 5,
                    flexWrap: isMobile ? 'wrap' : undefined,
                    ...(t.tenant ? {} : { border: '1.5px dashed var(--c-wash2)', borderRadius: 10 }),
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: 11.5, minWidth: isMobile ? 0 : 92, flexShrink: 0 }}>{t.room}</span>
                  {t.tenant ? (
                    <>
                      <span style={{ fontWeight: 700, fontSize: 12.5 }}>{t.tenant}</span>
                      {t.incidentals && (
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', background: 'var(--c-wash2)', padding: '3px 8px', borderRadius: 99, opacity: 0.8 }}>+ incidentals</span>
                      )}
                      <span style={{ fontWeight: 700, fontSize: 12, opacity: 0.85, marginLeft: isMobile ? 0 : 6, whiteSpace: 'nowrap' }}>{formatCurrency(String(t.rent))}</span>
                      <StampCell roomId={t.id} month={boardMonth} kind="rent" />
                    </>
                  ) : (
                    <span style={{ fontStyle: 'italic', opacity: 0.4, fontSize: 12 }}>empty</span>
                  )}
                </div>
                {t.incidentals && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 12px 7px 26px', fontSize: 11.5, flexWrap: isMobile ? 'wrap' : undefined }}>
                    <span style={{ fontWeight: 700 }}>
                      Incidentals — {monthLabel(incMonth)}
                      <span style={{ display: 'block', fontSize: 9.5, fontWeight: 400, opacity: 0.55 }}>
                        goes out the 2nd–3rd · shared runner {SHARED_RUNNER.splitLabel}
                      </span>
                    </span>
                    <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>
                      {boardShared ? `${fmtHrs(boardShared.billable)} hrs` : '…'}
                    </span>
                    <button className="c-bact" onClick={() => setSheetMonth(incMonth)}>Month sheet →</button>
                    <StampCell roomId={t.id} month={incMonth} kind="incidentals" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}

      <div className="c-bnote" style={{ marginTop: 14 }}>
        One button per row, always the next act: Mark sent (the 25th rent email went out) → Mark
        paid (stamps the date) → In QB (the payment is entered in QuickBooks — manual for now).
        ↩ undoes a misclick. Open past the 5th goes hot. The roster and rents are deal terms —
        they change in code, not on this screen. Mustard's incidentals hours come from the month
        sheet; billing prices them in QuickBooks.
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
