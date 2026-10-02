'use client'
// Top clients — two boxes at the top of the CRM's Clients tab (Eli, 2026-10-01;
// mock docs/design-refs/lakers-topclients-options.html, option A round 2).
// COD by client account; Label/Billing by label + A&R, artists underneath.
// Ranked by sessions, dollars alongside. Arrows step months. Model: lib/topClients.

import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatCurrency } from '@/lib/format'
import { getLocalToday } from '@/lib/time'
import { seasonFor } from '@/lib/lakers'
import { fetchTopClients, type TopRow } from '@/lib/topClients'

const money = (n: number) => formatCurrency(String(Math.round(n)))
const shift = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 1 + d, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}
const label = (ym: string) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

export function TopClients() {
  const isMobile = useIsMobile()
  const thisMonth = getLocalToday().slice(0, 7)
  const [ym, setYm] = useState(thisMonth)
  const [data, setData] = useState<{ cod: TopRow[]; label: TopRow[] } | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    fetchTopClients(ym, seasonFor(ym + '-15')).then(d => { if (live) setData(d) })
    return () => { live = false }
  }, [ym])

  const Box = ({ title, by, rows }: { title: string; by: string; rows: TopRow[] | undefined }) => {
    const max = Math.max(1, ...(rows ?? []).map(r => r.sessions))
    return (
      <div className="c-panel" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span className="c-arch" style={{ fontSize: 13 }}>{title}</span>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.45 }}>{by}</span>
        </div>
        {!rows && <div style={{ fontSize: 11.5, opacity: 0.5, padding: '6px 0' }}>Loading…</div>}
        {rows && rows.length === 0 && <div style={{ fontSize: 11.5, opacity: 0.5, padding: '6px 0' }}>No sessions.</div>}
        {rows?.map((r, i) => (
          <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '16px 1fr auto', gap: 8, alignItems: 'center', padding: '5px 0', borderTop: i ? '1px solid var(--c-wash2)' : 'none', fontSize: 12.5 }}>
            <span className="c-arch" style={{ opacity: 0.3, fontSize: 12 }}>{i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <b style={{ fontWeight: 700 }}>{r.title}</b>
              {r.lakers > 0 && <span title="Lakers games this season" style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: 'var(--c-st-tenant)', color: 'var(--c-chip-ink)', marginLeft: 6 }}>🏀 {r.lakers}</span>}
              <span style={{ display: 'block', fontSize: 10.5, opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {[r.sub.length ? r.sub.join(', ') : null, `${r.days} day${r.days === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
              </span>
              <span style={{ display: 'block', height: 3, borderRadius: 2, background: 'var(--c-st-booked)', opacity: 0.7, marginTop: 3, width: `${(r.sessions / max) * 100}%` }} />
            </span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              <b style={{ fontWeight: 800 }}>{r.sessions} session{r.sessions === 1 ? '' : 's'}</b>
              <span style={{ display: 'block', fontSize: 10.5, opacity: 0.55 }}>{money(r.dollars)}</span>
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.45, marginRight: 'auto' }}>Top clients</span>
        <button className="c-bmore" onClick={() => setYm(shift(ym, -1))} aria-label="Previous month">‹</button>
        <b style={{ fontSize: 12, minWidth: 110, textAlign: 'center' }}>{label(ym)}</b>
        <button className="c-bmore" disabled={ym >= thisMonth} onClick={() => setYm(shift(ym, 1))} aria-label="Next month">›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
        <Box title="COD" by="by client" rows={data?.cod} />
        <Box title="Label / Billing" by="by label · A&R" rows={data?.label} />
      </div>
    </div>
  )
}
