'use client'
// Top clients — two boxes at the top of the CRM's Clients tab (Eli, 2026-10-01,
// reworked 10-02). Rolling window (30 / 90 days / 12 months) counted from the
// days actually worked. COD by client account; Label/Billing by LABEL — tap a
// label to see who under it is booking (artist · A&R). Ranked by sessions,
// dollars alongside. Top 5 each, "show all" for the rest. Model: lib/topClients.

import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatCurrency } from '@/lib/format'
import { getLocalToday } from '@/lib/time'
import { seasonFor } from '@/lib/lakers'
import { fetchTopClients, type TopRow, type TopLine } from '@/lib/topClients'

const money = (n: number) => formatCurrency(String(Math.round(n)))
const WINDOWS = [{ d: 30, l: '30 days' }, { d: 90, l: '90 days' }, { d: 365, l: '12 months' }]
const SHOWN = 5

function Line({ r, i, max, onClick, open, small }: { r: TopLine; i: number | null; max: number; onClick?: () => void; open?: boolean; small?: boolean }) {
  return (
    <div onClick={onClick} style={{
      display: 'grid', gridTemplateColumns: small ? '1fr auto' : '16px 1fr auto', gap: 8, alignItems: 'center',
      padding: small ? '4px 0 4px 24px' : '5px 0', borderTop: i ? '1px solid var(--c-wash2)' : 'none',
      fontSize: small ? 11.5 : 12.5, cursor: onClick ? 'pointer' : 'default',
    }}>
      {!small && <span className="c-arch" style={{ opacity: 0.3, fontSize: 12 }}>{(i ?? 0) + 1}</span>}
      <span style={{ minWidth: 0 }}>
        <b style={{ fontWeight: small ? 600 : 700 }}>{r.title}</b>
        {onClick && <span style={{ opacity: 0.4, marginLeft: 5, fontSize: 10 }}>{open ? '▾' : '▸'}</span>}
        {r.lakers > 0 && <span title="Lakers games this season" style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: 'var(--c-st-tenant)', color: 'var(--c-chip-ink)', marginLeft: 6 }}>🏀 {r.lakers}</span>}
        <span style={{ display: 'block', fontSize: 10.5, opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[r.sub || null, `${r.days} day${r.days === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </span>
        {!small && <span style={{ display: 'block', height: 3, borderRadius: 2, background: 'var(--c-st-booked)', opacity: 0.7, marginTop: 3, width: `${(r.sessions / max) * 100}%` }} />}
      </span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <b style={{ fontWeight: small ? 700 : 800 }}>{r.sessions} session{r.sessions === 1 ? '' : 's'}</b>
        <span style={{ display: 'block', fontSize: 10.5, opacity: 0.55 }}>{money(r.dollars)}</span>
      </span>
    </div>
  )
}

function Box({ title, by, rows, expandable }: { title: string; by: string; rows: TopRow[] | undefined; expandable?: boolean }) {
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const max = Math.max(1, ...(rows ?? []).map(r => r.sessions))
  const shown = all ? rows : rows?.slice(0, SHOWN)
  return (
    <div className="c-panel" style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span className="c-arch" style={{ fontSize: 13 }}>{title}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.45 }}>{by}</span>
      </div>
      {!rows && <div style={{ fontSize: 11.5, opacity: 0.5, padding: '6px 0' }}>Loading…</div>}
      {rows && rows.length === 0 && <div style={{ fontSize: 11.5, opacity: 0.5, padding: '6px 0' }}>No sessions.</div>}
      {shown?.map((r, i) => (
        <div key={r.key}>
          <Line r={r} i={i} max={max} open={open === r.key}
            onClick={expandable && r.breakdown.length ? () => setOpen(open === r.key ? null : r.key) : undefined} />
          {open === r.key && (
            <div style={{ marginBottom: 6, background: 'var(--c-wash)', borderRadius: 8, padding: '2px 8px' }}>
              {r.breakdown.map((k, j) => <Line key={k.key} r={k} i={j} max={max} small />)}
            </div>
          )}
        </div>
      ))}
      {rows && rows.length > SHOWN && (
        <button onClick={() => setAll(a => !a)} style={{ display: 'block', margin: '6px auto 0', background: 'none', border: 'none', color: 'var(--c-fg)', opacity: 0.5, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
          {all ? 'Show top 5 ↑' : `Show all ${rows.length} ↓`}
        </button>
      )}
    </div>
  )
}

export function TopClients() {
  const isMobile = useIsMobile()
  const today = getLocalToday()
  const [win, setWin] = useState(30)
  const [data, setData] = useState<{ cod: TopRow[]; label: TopRow[] } | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    fetchTopClients(today, win, seasonFor(today)).then(d => { if (live) setData(d) })
    return () => { live = false }
  }, [today, win])

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.45, marginRight: 'auto' }}>Top clients · last {WINDOWS.find(w => w.d === win)?.l}</span>
        <div className="c-seg c-seg-tiny">
          {WINDOWS.map(w => (
            <button key={w.d} type="button" className={w.d === win ? 'c-on' : ''} onClick={() => setWin(w.d)} style={{ padding: '3px 10px' }}>{w.l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, alignItems: 'start' }}>
        <Box key={`cod-${win}`} title="COD" by="by client" rows={data?.cod} />
        <Box key={`lab-${win}`} title="Label / Billing" by="by label · tap to open" rows={data?.label} expandable />
      </div>
    </div>
  )
}
