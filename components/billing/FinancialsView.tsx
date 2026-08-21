'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Financials — revenue over time, inside the billing hub, owners only.
//
// Eli, 2026-08-20: "most important is YoY, month by month, room by room… costs
// over the months plus a graph of how much we are bringing in." Those are not
// four charts. They are one chart with three controls, so the ranking above is
// the ranking of the controls: the year-over-year toggle sits first and is on
// by default, grain second, rooms third.
//
// (The four streams were described as "costs". They are what the client is
// CHARGED — room, assistant, engineering, rental — so they are revenue, and
// stacked they ARE "how much we are bringing in". Confirmed with Eli before
// building. `financial_history.direction` leaves room for real outgoings later.)
//
// NO CHART LIBRARY, DELIBERATELY. Recharts is not installed, and this is a
// stacked bar with a comparison line — perhaps eighty lines of SVG. A dependency
// would arrive with its own colour, radius, font and tooltip opinions, every one
// of which fights the carved system, and the fight would be won with override
// CSS. Hand-drawn SVG reads the tokens directly.
//
// Carved laws honoured: no borders anywhere (the chart's baseline reference is a
// WASH BAND, not a hairline — Law 1 admits no exception for gridlines); the plot
// area is carved IN (`c-inset2`), every control sticks OUT (`c-control`); the
// compact scale of the density ruling, not the mock's ceiling.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/format'
import { getLocalToday } from '@/lib/time'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  fetchFinancialLines, filterLines, bucketLines, roomsIn, sumLines,
  sumByCategory, pctChange, priorYearKey, roomKey,
  CATEGORIES, CATEGORY_LABEL, CATEGORY_VAR,
  type FinLine, type FinCategory, type Grain, type FinBucket,
} from '@/lib/financials'

type Span = 12 | 24 | 36 | 60

const SPANS: { key: Span; label: string }[] = [
  { key: 12, label: '1y' },
  { key: 24, label: '2y' },
  { key: 36, label: '3y' },
  { key: 60, label: '5y' },
]

const GRAINS: { key: Grain; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
]

/** First of the month, `months` back from today. */
function startOfSpan(todayISO: string, months: number): string {
  const y = Number(todayISO.slice(0, 4))
  const m = Number(todayISO.slice(5, 7))
  const total = y * 12 + (m - 1) - (months - 1)
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/**
 * `formatCurrency` is typed for DISPLAY STRINGS — it is the formatter for money
 * that arrives out of a form field. Everything here is a computed number, so it
 * goes through one adapter rather than nine casts. The shared signature is left
 * alone deliberately: other chats are open on this repo and a widened parameter
 * type on a helper this widely imported is not this change's business.
 */
const usd = (n: number) => formatCurrency(String(n))

/** $12,400 → "$12.4k". Axis and bar labels only; tiles print the real figure. */
function compact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  return `$${Math.round(n)}`
}

export function FinancialsView() {
  const isMobile = useIsMobile()

  const [lines, setLines] = useState<FinLine[]>([])
  const [loading, setLoading] = useState(true)

  const [span, setSpan] = useState<Span>(24)
  const [grain, setGrain] = useState<Grain>('month')
  // YoY DEFAULTS ON. It is the question Eli said he asks first; a control that
  // answers the main question but starts off is a control most people never find.
  const [yoy, setYoy] = useState(true)
  const [rooms, setRooms] = useState<Set<string>>(new Set())
  const [cats, setCats] = useState<Set<FinCategory>>(new Set())
  const [hover, setHover] = useState<number | null>(null)

  const today = getLocalToday()
  // Fetch a year MORE than is charted, always: the year-over-year overlay needs
  // the prior period, and re-fetching when the toggle flips would make a
  // display option cost a round trip.
  const chartFrom = startOfSpan(today, span)
  const fetchFrom = startOfSpan(today, span + 12)

  const load = useCallback(async () => {
    const data = await fetchFinancialLines(fetchFrom, today)
    setLines(data)
    setLoading(false)
  }, [fetchFrom, today])

  useEffect(() => {
    load()
    // Standing rule: every fetch pairs with a channel. Three tables feed this
    // screen, so all three are watched; the history table is included because a
    // service-role import should light the chart up without a refresh.
    const ch = supabase
      .channel('billing-financials')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_time_rows' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_rows' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_history' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const allRooms = useMemo(() => roomsIn(lines), [lines])

  const shown = useMemo(
    () => filterLines(lines, { rooms, categories: cats }),
    [lines, rooms, cats],
  )

  const buckets = useMemo(
    () => bucketLines(shown, grain, chartFrom, today),
    [shown, grain, chartFrom, today],
  )

  // Prior-year lookup, keyed by bucket. Built from the SAME filtered lines, so
  // narrowing to one room narrows its comparison too — a compare that ignored
  // the filter would silently answer a different question than the one on screen.
  const priorByKey = useMemo(() => {
    const all = bucketLines(shown, grain, fetchFrom, today)
    const m = new Map<string, number>()
    for (const b of all) m.set(b.key, b.total)
    return m
  }, [shown, grain, fetchFrom, today])

  const activeCats = cats.size === 0 ? CATEGORIES : CATEGORIES.filter(c => cats.has(c))

  // ── Tiles ─────────────────────────────────────────────────────────────────
  const inRange = useMemo(
    () => shown.filter(l => l.date >= chartFrom && l.date <= today),
    [shown, chartFrom, today],
  )
  const total = sumLines(inRange)
  const priorTotal = useMemo(
    () => buckets.reduce((s, b) => s + (priorByKey.get(priorYearKey(b.key)) ?? 0), 0),
    [buckets, priorByKey],
  )
  const delta = pctChange(total, priorTotal)

  const topRoom = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of inRange) {
      const k = roomKey(l.venue, l.room)
      if (k) m.set(k, (m.get(k) ?? 0) + l.amount)
    }
    let best = ''; let bestV = -Infinity
    for (const [k, v] of m) if (v > bestV) { best = k; bestV = v }
    return best ? { key: best, value: bestV } : null
  }, [inRange])

  const catTotals = useMemo(() => sumByCategory(inRange), [inRange])
  const topCat = useMemo(() => {
    let best: FinCategory = 'room'; let bestV = -Infinity
    for (const c of CATEGORIES) if (catTotals[c] > bestV) { best = c; bestV = catTotals[c] }
    return bestV > 0 ? { key: best, value: bestV } : null
  }, [catTotals])

  // ── Chart geometry ────────────────────────────────────────────────────────
  const W = 1000
  const H = isMobile ? 210 : 260
  const PAD_L = 4
  const PAD_R = 4
  const PAD_T = 14
  const PAD_B = 22
  const plotH = H - PAD_T - PAD_B
  const plotW = W - PAD_L - PAD_R

  const maxVal = useMemo(() => {
    let m = 0
    for (const b of buckets) {
      const stack = activeCats.reduce((s, c) => s + b.byCategory[c], 0)
      if (stack > m) m = stack
      if (yoy) {
        const p = priorByKey.get(priorYearKey(b.key)) ?? 0
        if (p > m) m = p
      }
    }
    return m || 1
  }, [buckets, activeCats, yoy, priorByKey])

  const n = Math.max(buckets.length, 1)
  const slot = plotW / n
  const barW = Math.max(2, Math.min(slot * 0.62, 54))
  const yOf = (v: number) => PAD_T + plotH - (v / maxVal) * plotH
  const xOf = (i: number) => PAD_L + slot * i + slot / 2

  const priorPath = useMemo(() => {
    if (!yoy) return ''
    return buckets
      .map((b, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(priorByKey.get(priorYearKey(b.key)) ?? 0).toFixed(1)}`)
      .join(' ')
  }, [buckets, yoy, priorByKey, maxVal, slot])

  const toggle = <T,>(set: Set<T>, v: T): Set<T> =>
    set.has(v) ? new Set([...set].filter(x => x !== v)) : new Set([...set, v])

  function exportCsv() {
    const head = ['Period', ...CATEGORIES.map(c => CATEGORY_LABEL[c]), 'Total', 'Prior year']
    const rows = buckets.map(b => [
      b.key,
      ...CATEGORIES.map(c => b.byCategory[c].toFixed(2)),
      b.total.toFixed(2),
      (priorByKey.get(priorYearKey(b.key)) ?? 0).toFixed(2),
    ])
    const csv = [head, ...rows].map(r => r.join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `prsflo-revenue-${chartFrom}-to-${today}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const chipStyle: React.CSSProperties = { fontSize: 11, padding: '4px 10px', borderRadius: 99 }

  return (
    <div>
      {/* CONTROLS — ordered by Eli's stated priority, not by convention.
          Year-over-year leads because it is the question he asks first. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button
          className={`c-control c-soft${yoy ? ' c-on' : ''}`}
          style={chipStyle}
          onClick={() => setYoy(v => !v)}
          aria-pressed={yoy}
          title="Overlay the same period one year earlier"
        >
          vs last year
        </button>

        <span style={{ display: 'flex', gap: 4 }}>
          {GRAINS.map(g => (
            <button
              key={g.key}
              className={`c-control c-soft${grain === g.key ? ' c-on' : ''}`}
              style={chipStyle}
              onClick={() => setGrain(g.key)}
            >
              {g.label}
            </button>
          ))}
        </span>

        <span style={{ display: 'flex', gap: 4 }}>
          {SPANS.map(s => (
            <button
              key={s.key}
              className={`c-control c-soft${span === s.key ? ' c-on' : ''}`}
              style={chipStyle}
              onClick={() => setSpan(s.key)}
            >
              {s.label}
            </button>
          ))}
        </span>

        <span style={{ flex: 1 }} />

        <button className="c-control c-soft" style={chipStyle} onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {/* TILES — the same numbers the chart draws, never a second computation. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
        gap: 8, marginBottom: 10,
      }}>
        <Tile label="Billed, this range" value={usd(total)} />
        <Tile
          label="vs same range last year"
          value={delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`}
          tone={delta === null ? undefined : delta >= 0 ? 'var(--c-st-booked)' : 'var(--c-st-hot)'}
        />
        <Tile
          label={topRoom ? `Top room · ${topRoom.key.replace(' · ', ' ')}` : 'Top room'}
          value={topRoom ? usd(topRoom.value) : '—'}
        />
        <Tile
          label={topCat ? `Top stream · ${CATEGORY_LABEL[topCat.key]}` : 'Top stream'}
          value={topCat ? usd(topCat.value) : '—'}
        />
      </div>

      {/* CHART */}
      <div className="c-panel c-inset2" style={{ padding: '10px 12px 6px', position: 'relative' }}>
        {loading ? (
          <div style={{ height: H, display: 'grid', placeItems: 'center', opacity: 0.5, fontSize: 12 }}>
            Loading revenue…
          </div>
        ) : total === 0 ? (
          <div style={{ height: H, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 20 }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>No billed revenue in this range.</div>
              <div style={{ fontSize: 11.5, opacity: 0.45, marginTop: 4 }}>
                Widen the range, clear the room filter, or import the spreadsheet years.
              </div>
            </div>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label="Revenue by period and stream"
          >
            {/* Reference bands, not gridlines. Law 1 admits no hairlines, so the
                eye gets its levels from alternating wash fills instead. */}
            {[0, 1, 2, 3].map(i => (
              <rect
                key={i}
                x={PAD_L} y={PAD_T + (plotH / 4) * i}
                width={plotW} height={plotH / 4}
                fill={i % 2 === 0 ? 'var(--c-wash)' : 'transparent'}
              />
            ))}

            {buckets.map((b, i) => {
              let acc = 0
              const stackTotal = activeCats.reduce((s, c) => s + b.byCategory[c], 0)
              return (
                <g key={b.key}>
                  {/* Full-slot hit area — hovering between bars must still
                      target the period, or thin bars become unhoverable. */}
                  <rect
                    x={PAD_L + slot * i} y={PAD_T} width={slot} height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                  />
                  {activeCats.map(c => {
                    const v = b.byCategory[c]
                    if (v <= 0) return null
                    const h = (v / maxVal) * plotH
                    const y = PAD_T + plotH - acc - h
                    acc += h
                    return (
                      <rect
                        key={c}
                        x={xOf(i) - barW / 2} y={y}
                        width={barW} height={Math.max(h, 0.7)}
                        fill={CATEGORY_VAR[c]}
                        opacity={hover === null || hover === i ? 1 : 0.35}
                        pointerEvents="none"
                      />
                    )
                  })}
                  {stackTotal > 0 && slot > 34 && (
                    <text
                      x={xOf(i)} y={PAD_T + plotH - acc - 4}
                      textAnchor="middle" fontSize={9.5}
                      fill="var(--c-fg)" opacity={0.5} pointerEvents="none"
                    >
                      {compact(stackTotal)}
                    </text>
                  )}
                  <text
                    x={xOf(i)} y={H - 7}
                    textAnchor="middle" fontSize={9.5}
                    fill="var(--c-fg)" opacity={hover === i ? 0.85 : 0.4}
                    pointerEvents="none"
                  >
                    {/* Month labels thin out on long spans rather than
                        overlapping into mush. */}
                    {grain === 'month' && n > 26 && i % 3 !== 0 ? '' : b.label}
                  </text>
                </g>
              )
            })}

            {/* Prior year as a LINE over the stack, not a second set of bars.
                Bars are this year's composition; the line is the benchmark it is
                being read against. Two bar sets would make them look like peers. */}
            {yoy && priorPath && (
              <>
                <path
                  d={priorPath} fill="none"
                  stroke="var(--c-fg)" strokeOpacity={0.55}
                  strokeWidth={1.6} strokeDasharray="4 3"
                  pointerEvents="none"
                />
                {buckets.map((b, i) => (
                  <circle
                    key={b.key}
                    cx={xOf(i)} cy={yOf(priorByKey.get(priorYearKey(b.key)) ?? 0)}
                    r={hover === i ? 3 : 1.8}
                    fill="var(--c-fg)" opacity={0.6} pointerEvents="none"
                  />
                ))}
              </>
            )}
          </svg>
        )}

        {/* Hover readout. A panel under the chart rather than a floating
            tooltip: it never covers the bars it describes, and it holds still
            long enough to read four figures off it. */}
        {hover !== null && buckets[hover] && (
          <div style={{
            display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline',
            padding: '6px 2px 2px', fontSize: 11.5,
          }}>
            <strong className="c-mono" style={{ fontSize: 12 }}>{buckets[hover].key}</strong>
            {activeCats.map(c => (
              <span key={c} style={{ opacity: 0.8 }}>
                <span style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: 2,
                  background: CATEGORY_VAR[c], marginRight: 5,
                }} />
                {CATEGORY_LABEL[c]} {usd(buckets[hover].byCategory[c])}
              </span>
            ))}
            <span style={{ fontWeight: 700 }}>Total {usd(buckets[hover].total)}</span>
            {yoy && (
              <span style={{ opacity: 0.6 }}>
                Last year {usd(priorByKey.get(priorYearKey(buckets[hover].key)) ?? 0)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* LEGEND — clickable, so the legend IS the category filter. A separate
          filter control next to a legend that shows the same four words is two
          controls for one job. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {CATEGORIES.map(c => {
          const on = cats.size === 0 || cats.has(c)
          return (
            <button
              key={c}
              className="c-control c-soft"
              style={{ ...chipStyle, opacity: on ? 1 : 0.4 }}
              onClick={() => setCats(prev => {
                // Clicking one of "all on" ISOLATES it. Turning the last one off
                // would chart nothing, so it resets to all instead.
                if (prev.size === 0) return new Set(CATEGORIES.filter(x => x !== c))
                const next = toggle(prev, c)
                return next.size === 0 ? new Set() : next
              })}
              aria-pressed={on}
            >
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                background: CATEGORY_VAR[c], marginRight: 6,
              }} />
              {CATEGORY_LABEL[c]}
              <span style={{ opacity: 0.5, marginLeft: 6 }}>{compact(catTotals[c])}</span>
            </button>
          )
        })}
      </div>

      {/* ROOMS */}
      {allRooms.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <span className="c-label" style={{ display: 'block', marginBottom: 5 }}>
            Rooms {rooms.size > 0 && `· ${rooms.size} of ${allRooms.length}`}
          </span>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button
              className={`c-control c-soft${rooms.size === 0 ? ' c-on' : ''}`}
              style={chipStyle}
              onClick={() => setRooms(new Set())}
            >
              All rooms
            </button>
            {allRooms.map(k => (
              <button
                key={k}
                className={`c-control c-soft${rooms.has(k) ? ' c-on' : ''}`}
                style={chipStyle}
                onClick={() => setRooms(prev => toggle(prev, k))}
              >
                {k.replace(' · ', ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TABLE — the chart's own numbers, readable. Not a second query. */}
      {!loading && buckets.length > 0 && (
        <div className="c-panel c-inset2" style={{ padding: '8px 10px', overflowX: 'auto' }}>
          <table className="c-table" style={{ fontSize: 11.5, minWidth: 520 }}>
            <thead>
              <tr style={{ opacity: 0.55, textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Period</th>
                {activeCats.map(c => (
                  <th key={c} style={{ padding: '4px 8px', fontWeight: 600 }}>{CATEGORY_LABEL[c]}</th>
                ))}
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Total</th>
                {yoy && <th style={{ padding: '4px 8px', fontWeight: 600 }}>Last yr</th>}
                {yoy && <th style={{ padding: '4px 8px', fontWeight: 600 }}>Δ</th>}
              </tr>
            </thead>
            <tbody>
              {[...buckets].reverse().map(b => {
                const prior = priorByKey.get(priorYearKey(b.key)) ?? 0
                const d = pctChange(b.total, prior)
                return (
                  <tr key={b.key} className="c-table-row" style={{ textAlign: 'right' }}>
                    <td className="c-mono" style={{ textAlign: 'left', padding: '4px 8px' }}>{b.key}</td>
                    {activeCats.map(c => (
                      <td key={c} style={{ padding: '4px 8px', opacity: b.byCategory[c] ? 1 : 0.3 }}>
                        {usd(b.byCategory[c])}
                      </td>
                    ))}
                    <td style={{ padding: '4px 8px', fontWeight: 700 }}>{usd(b.total)}</td>
                    {yoy && <td style={{ padding: '4px 8px', opacity: 0.6 }}>{usd(prior)}</td>}
                    {yoy && (
                      <td style={{
                        padding: '4px 8px',
                        color: d === null ? undefined
                          : d >= 0 ? 'var(--c-st-booked)' : 'var(--c-st-hot)',
                        opacity: d === null ? 0.4 : 1,
                      }}>
                        {d === null ? (b.total > 0 ? 'new' : '—') : `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The rental approximation, stated where it can be acted on rather than
          buried in a source comment. */}
      <p style={{ fontSize: 10.5, opacity: 0.45, margin: '8px 4px 0', lineHeight: 1.5 }}>
        Billed amounts by session date — not payments received. Rentals attach to a work
        order rather than to a room, so a rental is counted against the room its work order
        started in; totals across all rooms are exact.
      </p>
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="c-bstat">
      <div className="c-arch" style={{ fontSize: 19, letterSpacing: '-0.02em', color: tone }}>
        {value}
      </div>
      <div style={{
        fontSize: 10, opacity: 0.55, marginTop: 1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
    </div>
  )
}
