'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Financials — revenue over time, inside the billing hub, owners only.
//
// ONE LINE. Eli, 2026-08-20, on the first build's stacked bars: "I don't really
// need to see engineering against the room or rentals against the engineering.
// It's really just to help me with historical sliding." So the chart draws a
// single series and the metric pills change WHICH one — each on its own scale,
// where its movement is actually legible. Room revenue is ~85% of the total; a
// stack made engineering and rentals two flat smears at the bottom of the axis.
//
// THE COMPARISON IS ALWAYS ON, NEVER A MODE. "How does this July compare to
// last July" is the question he asks first, so hovering any month prints that
// month, its figure, the same month a year earlier, and the change from the
// month before. Nothing to switch into. The dashed line is last year shadowing
// this one; where they separate is where something changed.
//
// THE PARTIAL MONTH IS COMPARED LIKE FOR LIKE. See lib/financials buildSeries —
// an August that has run to the 18th is set against August 1–18 of last year,
// not against all 31 days. The point renders hollow on a dashed segment so it
// is visibly unfinished. No projection: a forecast drawn in the same ink as
// measured data is worse than an obvious gap.
//
// NO CHART LIBRARY, DELIBERATELY. Recharts is not installed, and this is one
// path, one dashed path and a brush. A dependency would arrive with its own
// colour, radius, font and tooltip opinions, every one of which fights the
// carved system, and the fight would be won with override CSS.
//
// NO <table> ANYWHERE. The first build put the figures in one, styled with
// `.c-table-row` — which is `display: grid` in globals.css, so it destroyed the
// table layout and stacked every cell into the first column. The readout is a
// flex row now; there is no table to break.
//
// Carved laws honoured: no borders (the chart's levels come from WASH BANDS,
// not hairlines — Law 1 admits no exception for gridlines); the plot is carved
// IN (`c-inset2`), controls stick OUT (`c-control`); compact scale per the
// density ruling.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/format'
import { getLocalToday } from '@/lib/time'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  fetchFinancialLines, fetchHistory, buildSeries, roomOptions, scopeMatches, scopeLabel,
  pctChange, compareLabel, monthLabel,
  METRICS,
  type FinLine, type HistMonth, type Metric, type RoomScope, type Compare,
  type SeriesPoint,
} from '@/lib/financials'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * `formatCurrency` is typed for DISPLAY STRINGS — the formatter for money that
 * arrives out of a form field. Everything here is a computed number, so it goes
 * through one adapter rather than a cast at every call. The shared signature is
 * left alone: other chats are open on this repo, and widening a parameter type
 * on a helper this widely imported is not this change's business.
 */
const usd = (n: number) => formatCurrency(String(n))

/** $12,400 → "$12.4k". Axis labels only; the readout prints the real figure. */
function compact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  return `$${Math.round(n)}`
}

/** ISO of the first of the month, `months` back from today. */
function startOfSpan(todayISO: string, months: number): string {
  const total = Number(todayISO.slice(0, 4)) * 12 + (Number(todayISO.slice(5, 7)) - 1) - (months - 1)
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

// Ten years back covers the whole archive. The window the user actually sees is
// the brush, so this is fetched once and never re-fetched by a control.
const SPAN_MONTHS = 132

export function FinancialsView() {
  const isMobile = useIsMobile()

  const [lines, setLines] = useState<FinLine[]>([])
  const [hist, setHist] = useState<HistMonth[]>([])
  const [histRooms, setHistRooms] = useState<{ venue: string; room: string }[]>([])
  const [latest, setLatest] = useState('')
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<Metric>('total')
  const [scope, setScope] = useState<RoomScope>('')
  // 'prev' rides one year behind whatever you are looking at; a year string
  // pins the dashed line to that year as a fixed baseline.
  const [compare, setCompare] = useState<Compare>('prev')
  const [hover, setHover] = useState<number | null>(null)
  const [win, setWin] = useState<{ a: number; b: number } | null>(null)

  // TWO WAYS TO READ THE SAME NUMBERS (Eli, 2026-08-20).
  //
  // TIMELINE is the arc — where the company has been and where it is going,
  // one continuous line across nine years.
  //
  // YEARS is the overlay every financial tool converges on: one Jan–Dec axis
  // with a line per year stacked on top of each other. December 2024 and
  // December 2025 sit twelve columns apart on a timeline and the eye cannot
  // hold them together; on the overlay they are the same column. It is the only
  // way to see SEASONALITY, and it answers "26 against 25 and 24 and 23" in one
  // picture rather than as five separate comparisons.
  //
  // They are modes rather than two charts because they share every control —
  // metric, room, the data itself. Only the axis changes.
  const [mode, setMode] = useState<'timeline' | 'years'>('timeline')
  const [activeYears, setActiveYears] = useState<Set<string>>(new Set())

  const today = getLocalToday()
  const from = startOfSpan(today, SPAN_MONTHS)

  // The archive is scoped and summed by Postgres; the live half comes back as
  // daily rows because it is small and the day detail is still needed. `scope`
  // is a dependency of the fetch for that reason — changing the room re-asks
  // the database rather than re-filtering 55,000 rows in the browser.
  const load = useCallback(async () => {
    const live = await fetchFinancialLines(from, today)
    // The day cap is the newest day ANY source holds — the archive may end
    // mid-month while live work orders run past it, or the reverse.
    const liveLatest = live.reduce((m, l) => (l.date > m ? l.date : m), '')
    const firstPass = await fetchHistory(scope, 31)
    const newest = firstPass.latest > liveLatest ? firstPass.latest : liveLatest
    const cap = newest ? Number(newest.slice(8, 10)) : 31
    // Re-ask only when the cap actually narrows anything. A month that ended on
    // the 31st needs no second pass.
    const h = cap < 31 ? await fetchHistory(scope, cap) : firstPass

    setLines(live)
    setHist(h.months)
    setHistRooms(h.rooms)
    setLatest(newest)
    setLoading(false)
  }, [from, today, scope])

  useEffect(() => {
    load()
    // Standing rule: every fetch pairs with a channel. Three tables feed this
    // screen; the history table is included so a service-role import lights the
    // chart up without a refresh.
    const ch = supabase
      .channel('billing-financials')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_time_rows' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_rows' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_history' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const venues = useMemo(() => roomOptions(lines, histRooms), [lines, histRooms])

  // Only the LIVE half is filtered here — the archive was already scoped by the
  // database when it was fetched.
  const scoped = useMemo(
    () => (scope ? lines.filter(l => scopeMatches(scope, l)) : lines),
    [lines, scope],
  )

  // The full series is always built; the brush only chooses what is DRAWN. That
  // keeps zooming instant and keeps the year-over-year lookup able to see
  // outside the visible window.
  const all = useMemo(
    () => buildSeries(scoped, hist, metric, from, today, latest || today, compare),
    [scoped, hist, metric, from, today, latest, compare],
  )

  /** Years the data actually covers, newest first. */
  const years = useMemo(() => {
    const seen = new Set<string>()
    for (const h of hist) seen.add(h.month.slice(0, 4))
    for (const l of lines) if (l.date) seen.add(l.date.slice(0, 4))
    return [...seen].sort().reverse()
  }, [hist, lines])

  // Default the overlay to the three most recent years — enough to see a trend,
  // few enough to still tell the lines apart. Everything else is one click.
  const shownYears = useMemo(() => {
    const picked = activeYears.size > 0
      ? years.filter(y => activeYears.has(y))
      : years.slice(0, 3)
    return picked.sort()
  }, [years, activeYears])

  /** month index 0–11 → value, per year. Built from the same series the
   *  timeline draws, so the two views can never disagree. */
  const byYear = useMemo(() => {
    const m = new Map<string, (SeriesPoint | undefined)[]>()
    for (const p of all) {
      const arr = m.get(p.year) ?? new Array(12).fill(undefined)
      arr[Number(p.key.slice(5, 7)) - 1] = p
      m.set(p.year, arr)
    }
    return m
  }, [all])

  // Land on the last three years — enough to read the arc without the 2017 tail
  // squeezing recent months into noise.
  const bounds = win ?? { a: Math.max(0, all.length - 37), b: all.length - 1 }
  const view = all.slice(bounds.a, bounds.b + 1)

  const totalShown = view.reduce((s, p) => s + p.value, 0)
  const priorShown = view.reduce((s, p) => s + (p.prior ?? 0), 0)

  const active = hover !== null && view[hover] ? view[hover] : view[view.length - 1]

  // ── Geometry ──────────────────────────────────────────────────────────────
  const W = 1000
  const H = isMobile ? 210 : 300
  const PL = 54, PR = 10, PT = 14, PB = 24
  const pw = W - PL - PR
  const ph = H - PT - PB

  const max = useMemo(() => {
    let m = 0
    for (const p of view) {
      if (p.value > m) m = p.value
      if (compare && p.prior && p.prior > m) m = p.prior
    }
    return (m || 1) * 1.1
  }, [view, compare])

  const n = Math.max(view.length, 1)
  const step = n > 1 ? pw / (n - 1) : 0
  const xOf = (i: number) => PL + step * i
  const yOf = (v: number) => PT + ph - (v / max) * ph

  const path = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

  // The partial month is split off so its segment can be dashed. It is the last
  // point, so the solid line stops one short and a two-point dashed run closes
  // the gap.
  const lastPartial = view.length > 0 && view[view.length - 1].partial
  const solidCount = lastPartial ? view.length - 1 : view.length
  const solid = view.slice(0, solidCount).map((p, i) => [xOf(i), yOf(p.value)] as [number, number])
  const tail: [number, number][] = lastPartial && view.length > 1
    ? [[xOf(view.length - 2), yOf(view[view.length - 2].value)],
       [xOf(view.length - 1), yOf(view[view.length - 1].value)]]
    : []

  const priorPts = view
    .map((p, i) => (p.prior === null ? null : [xOf(i), yOf(p.prior)] as [number, number]))
    .filter((p): p is [number, number] => p !== null)

  // ── Brush ─────────────────────────────────────────────────────────────────
  const brushRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ mode: 'l' | 'r' | 'm'; from: number } | null>(null)

  const brushMax = useMemo(() => all.reduce((m, p) => Math.max(m, p.value), 0) || 1, [all])
  const brushPath = useMemo(
    () => path(all.map((p, i) => [(i / Math.max(all.length - 1, 1)) * 1000, 42 - (p.value / brushMax) * 36 - 3])),
    [all, brushMax],
  )

  function brushIndex(clientX: number): number {
    const el = brushRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return ((clientX - r.left) / r.width) * (all.length - 1)
  }

  /**
   * FUNCTIONAL UPDATE, NOT `win ?? bounds` (bug, 2026-08-20).
   *
   * The first version read `win` out of the closure. `setWin` is async and
   * pointermove fires faster than React re-renders, so several moves in a row
   * all computed their next window from the same stale one — the range jumped
   * around while dragging and the month labels appeared to go out of order.
   * Reading `prev` inside the setter makes each move build on the one before it.
   *
   * `d` is captured per call, so `d.from` stays put even though the ref is
   * reassigned below for the next move.
   */
  function onBrushMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const f = brushIndex(e.clientX)
    const last = all.length - 1

    setWin(prev => {
      const cur = prev ?? { a: Math.max(0, all.length - 37), b: last }
      if (d.mode === 'l') {
        return { a: Math.max(0, Math.min(cur.b - 2, Math.round(f))), b: cur.b }
      }
      if (d.mode === 'r') {
        return { a: cur.a, b: Math.min(last, Math.max(cur.a + 2, Math.round(f))) }
      }
      const shift = Math.round(f - d.from)
      if (shift === 0) return cur
      const width = cur.b - cur.a
      const a = Math.max(0, Math.min(last - width, cur.a + shift))
      return { a, b: a + width }
    })

    if (d.mode === 'm') dragRef.current = { mode: 'm', from: f }
  }

  const chip: React.CSSProperties = { fontSize: 11.5, padding: '4px 11px', borderRadius: 99 }
  const pctColor = (p: number | null) =>
    p === null ? undefined : p >= 0 ? 'var(--c-st-booked)' : 'var(--c-st-hot)'
  const pctText = (p: number | null, blank = '—') =>
    p === null ? blank : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`

  return (
    <div>
      {/* CONTROLS. Metric first — it decides what the whole chart is about. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {METRICS.map(m => (
            <button
              key={m.key}
              className={`c-control c-soft${metric === m.key ? ' c-on' : ''}`}
              style={chip}
              onClick={() => setMetric(m.key)}
              aria-pressed={metric === m.key}
            >
              {m.label}
            </button>
          ))}
        </span>

        <select
          className="c-input"
          value={scope}
          onChange={e => setScope(e.target.value)}
          style={{ fontSize: 11.5, padding: '4px 8px', maxWidth: 210 }}
          aria-label="Room"
        >
          <option value="">All rooms</option>
          {venues.map(v => (
            <optgroup key={v.venue} label={v.venue}>
              <option value={`venue:${v.venue}`}>{v.venue} — all rooms</option>
              {v.rooms.map(r => (
                <option key={r} value={`${v.venue} · ${r}`}>{v.venue} {r}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <span style={{ flex: 1 }} />

        <span style={{ display: 'flex', gap: 4 }}>
          {(['timeline', 'years'] as const).map(m => (
            <button
              key={m}
              className={`c-control c-soft${mode === m ? ' c-on' : ''}`}
              style={chip}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={m === 'timeline'
                ? 'One continuous line across every year'
                : 'One line per year on a Jan–Dec axis'}
            >
              {m === 'timeline' ? 'Timeline' : 'Years'}
            </button>
          ))}
        </span>

        {/* THE DASHED LINE IS A PICKER, NOT A TOGGLE (Eli, 2026-08-20).
            "Previous year" slides with the data — always one year behind
            whatever you are looking at. A specific year PINS it, so the peak
            years can be used as a baseline directly instead of counting
            backwards from wherever you happen to be zoomed. */}
        {/* Hidden in Years mode: the overlay IS the comparison, so a second
            comparison control there would be answering a question the chart
            has already answered. */}
        {mode === 'timeline' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="c-label">Compare to</span>
            <select
              className="c-input"
              value={compare ?? 'off'}
              onChange={e => setCompare(e.target.value === 'off' ? null : e.target.value as Compare)}
              style={{ fontSize: 11.5, padding: '4px 8px' }}
            >
              <option value="prev">Previous year</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
              <option value="off">Nothing</option>
            </select>
          </label>
        )}
      </div>

      {/* YEAR PICKER — only in overlay mode. Every year is one click, so
          "26 against 25, 24, 23, 22 and 21" is five clicks and one picture. */}
      {mode === 'years' && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
          <span className="c-label" style={{ marginRight: 3 }}>Years</span>
          {years.map(y => {
            const on = shownYears.includes(y)
            return (
              <button
                key={y}
                className={`c-control c-soft${on ? ' c-on' : ''}`}
                style={{ ...chip, fontSize: 11 }}
                aria-pressed={on}
                onClick={() => setActiveYears(prev => {
                  // Starting from the default three, the first click has to
                  // materialise that set — otherwise clicking an already-lit
                  // year would appear to do nothing.
                  const base = prev.size > 0 ? prev : new Set(years.slice(0, 3))
                  const next = new Set(base)
                  if (next.has(y)) next.delete(y)
                  else next.add(y)
                  // Never leave the chart with nothing to draw.
                  return next.size === 0 ? base : next
                })}
              >
                {y}
              </button>
            )
          })}
          {activeYears.size > 0 && (
            <button className="c-control c-soft" style={{ ...chip, fontSize: 11, opacity: 0.6 }}
              onClick={() => setActiveYears(new Set())}>
              Reset
            </button>
          )}
        </div>
      )}

      {/* READOUT, OVERLAY MODE — every selected year for the hovered month,
          ranked. On a timeline the question is "versus last year"; on the
          overlay it is "how do all of these Julys compare", so the readout
          answers that one instead. */}
      {mode === 'years' && (
        <div
          className="c-panel c-inset2"
          style={{
            display: 'flex', gap: isMobile ? 14 : 22, flexWrap: 'wrap', alignItems: 'baseline',
            padding: '9px 13px', marginBottom: 10, minHeight: 40,
          }}
        >
          <div>
            <span className="c-label" style={{ display: 'block', marginBottom: 2 }}>
              {hover !== null ? 'Hovering' : 'Month'}
            </span>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {MONTH_ABBR[hover ?? 11]}
            </span>
          </div>
          {[...shownYears].reverse().map((y, idx, arr) => {
            const p = byYear.get(y)?.[hover ?? 11]
            const older = arr[idx + 1] ? byYear.get(arr[idx + 1])?.[hover ?? 11] : undefined
            const d = p && older ? pctChange(p.value, older.value) : null
            return (
              <div key={y}>
                <span className="c-label" style={{ display: 'block', marginBottom: 2 }}>
                  {y}{p?.partial ? ` · to ${p.throughDay}` : ''}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{p ? usd(p.value) : '—'}</span>
                {d !== null && (
                  <span style={{ fontSize: 11, marginLeft: 6, color: pctColor(d) }}>
                    {pctText(d)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* READOUT — always answering. Shows the newest month at rest, whatever is
          under the cursor while hovering. An empty state here would mean the
          comparison is a thing you have to go and get. */}
      {mode === 'timeline' && (
      <div
        className="c-panel c-inset2"
        style={{
          display: 'flex', gap: isMobile ? 16 : 26, flexWrap: 'wrap', alignItems: 'baseline',
          padding: '9px 13px', marginBottom: 10, minHeight: 40,
        }}
      >
        {active ? (
          <>
            <Field
              k={hover !== null ? 'Hovering' : 'Latest'}
              v={active.partial
                ? `${monthLabel(active.key)} 1–${active.throughDay}`
                : `${monthLabel(active.key)} ${active.year}`}
              note={active.partial ? 'partial month' : undefined}
            />
            <Field k={METRICS.find(m => m.key === metric)?.label ?? ''} v={usd(active.value)} />
            <Field
              k={compare
                ? `vs ${compareLabel(active.key, compare)}${active.partial ? ' same days' : ''}`
                : 'vs — '}
              v={pctText(pctChange(active.value, active.prior), active.value > 0 ? 'new' : '—')}
              tone={pctColor(pctChange(active.value, active.prior))}
              note={active.prior !== null ? usd(active.prior) : undefined}
              small
            />
            <Field
              k="vs last month"
              v={(() => {
                const i = all.findIndex(p => p.key === active.key)
                const prev = i > 0 ? all[i - 1] : null
                // A partial month against a whole previous month would report a
                // fall that is only the calendar. Compared like for like or not
                // at all.
                if (!prev || active.partial) return '—'
                return pctText(pctChange(active.value, prev.value))
              })()}
              tone={(() => {
                const i = all.findIndex(p => p.key === active.key)
                const prev = i > 0 ? all[i - 1] : null
                if (!prev || active.partial) return undefined
                return pctColor(pctChange(active.value, prev.value))
              })()}
              small
            />
          </>
        ) : (
          <span style={{ fontSize: 12, opacity: 0.5 }}>No data in this range.</span>
        )}
      </div>
      )}

      {/* CHART */}
      <div className="c-panel c-inset2" style={{ padding: '8px 10px 2px' }}>
        {loading ? (
          <div style={{ height: H, display: 'grid', placeItems: 'center', opacity: 0.5, fontSize: 12 }}>
            Loading revenue…
          </div>
        ) : mode === 'years' ? (
          <YearOverlay
            years={shownYears}
            byYear={byYear}
            W={W} H={H} PL={PL} PR={PR} PT={PT} PB={PB}
            hover={hover}
            setHover={setHover}
            compactFn={compact}
          />
        ) : totalShown === 0 ? (
          <div style={{ height: H, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 20 }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>No billed revenue in this range.</div>
              <div style={{ fontSize: 11.5, opacity: 0.45, marginTop: 4 }}>
                Widen the window, choose All rooms, or import the spreadsheet years.
              </div>
            </div>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            preserveAspectRatio="none"
            style={{ display: 'block', cursor: 'crosshair' }}
            role="img"
            aria-label={`${METRICS.find(m => m.key === metric)?.label} by month, ${scopeLabel(scope)}`}
            onMouseMove={e => {
              const r = e.currentTarget.getBoundingClientRect()
              const x = ((e.clientX - r.left) / r.width) * W
              setHover(Math.max(0, Math.min(n - 1, Math.round((x - PL) / (step || 1)))))
            }}
            onMouseLeave={() => setHover(null)}
          >
            {/* Levels from wash bands — Law 1 admits no hairlines. */}
            {[0, 1, 2, 3].map(i => (
              <g key={i}>
                {i % 2 === 0 && (
                  <rect x={PL} y={PT + (ph / 4) * i} width={pw} height={ph / 4}
                    fill="var(--c-wash)" opacity={0.5} />
                )}
                <text x={PL - 8} y={PT + (ph / 4) * i + 3} textAnchor="end"
                  fontSize={9.5} fill="var(--c-fg)" fillOpacity={0.42}>
                  {compact(max * (1 - i / 4))}
                </text>
              </g>
            ))}

            {compare && priorPts.length > 1 && (
              <path d={path(priorPts)} fill="none" stroke="var(--c-fg)" strokeOpacity={0.42}
                strokeWidth={1.5} strokeDasharray="5 4" />
            )}

            {solid.length > 1 && (
              <>
                <path
                  d={`${path(solid)} L${solid[solid.length - 1][0].toFixed(1)},${PT + ph} L${solid[0][0].toFixed(1)},${PT + ph} Z`}
                  fill="var(--c-fg)" fillOpacity={0.08}
                />
                <path d={path(solid)} fill="none" stroke="var(--c-fg)" strokeWidth={2.2} strokeLinejoin="round" />
              </>
            )}
            {tail.length === 2 && (
              <path d={path(tail)} fill="none" stroke="var(--c-fg)" strokeWidth={2.2} strokeDasharray="4 3" />
            )}

            {n <= 40 && view.map((p, i) => (
              <circle
                key={p.key}
                cx={xOf(i)} cy={yOf(p.value)} r={hover === i ? 4 : 2.3}
                fill={p.partial ? 'var(--c-bg)' : 'var(--c-fg)'}
                stroke={p.partial ? 'var(--c-fg)' : 'none'} strokeWidth={p.partial ? 1.6 : 0}
              />
            ))}

            {hover !== null && view[hover] && (
              <line x1={xOf(hover)} x2={xOf(hover)} y1={PT} y2={PT + ph}
                stroke="var(--c-fg)" strokeOpacity={0.35} strokeWidth={1} />
            )}

            {/* AXIS LABELS.
                The first version filtered by `i % every` and THEN asked whether
                the month was January — so on any long range almost every
                January was thrown away before it could be labelled, and the
                chart showed no years at all. You could not tell where you were.
                Now the decision is made once, per range length:
                  · long ranges label JANUARIES (thinned if there are many years)
                  · short ranges label months, with the year on each January
                so a year marker is always present either way. */}
            {(() => {
              const januaries = view.filter(p => p.key.slice(5) === '01').length
              const yearStep = Math.max(1, Math.ceil(januaries / 8))
              const monthStep = Math.max(1, Math.ceil(n / 13))
              let seenJan = -1
              return view.map((p, i) => {
                const isJan = p.key.slice(5) === '01'
                if (isJan) seenJan += 1
                let label = ''
                if (n > 30) {
                  if (isJan && seenJan % yearStep === 0) label = p.year
                } else {
                  if (i % monthStep === 0) label = isJan ? `${p.label} ${p.year}` : p.label
                }
                if (!label) return null
                return (
                  <text key={p.key} x={xOf(i)} y={H - 6} textAnchor="middle"
                    fontSize={9.5} fill="var(--c-fg)"
                    fillOpacity={hover === i ? 0.85 : isJan ? 0.6 : 0.42}
                    fontWeight={isJan && n > 30 ? 700 : 400}>
                    {label}
                  </text>
                )
              })
            })()}
          </svg>
        )}
      </div>

      {/* BRUSH — the whole archive, with the drawn window carved out of it.
          Timeline only: the overlay's axis is always exactly twelve months, so
          there is no window to choose. */}
      {!loading && mode === 'timeline' && all.length > 2 && (
        <>
          <div className="c-label" style={{ margin: '11px 0 5px' }}>
            Drag the handles to zoom · drag the middle to pan
          </div>
          <div
            ref={brushRef}
            className="c-panel c-inset2"
            style={{ position: 'relative', height: 42, padding: 0, overflow: 'hidden', touchAction: 'none' }}
            onPointerMove={onBrushMove}
            onPointerUp={() => { dragRef.current = null }}
            onPointerLeave={() => { dragRef.current = null }}
          >
            <svg viewBox="0 0 1000 42" width="100%" height={42} preserveAspectRatio="none" style={{ display: 'block' }}>
              <path d={`${brushPath} L1000,42 L0,42 Z`} fill="var(--c-fg)" fillOpacity={0.14} />
              <path d={brushPath} fill="none" stroke="var(--c-fg)" strokeOpacity={0.5} strokeWidth={1.2} />
            </svg>
            {([['left', 0, bounds.a], ['right', bounds.b + 1, all.length - 1]] as const).map(([side, s, e]) => (
              <div
                key={side}
                style={{
                  position: 'absolute', top: 0, bottom: 0,
                  [side]: 0,
                  width: `${(Math.max(e - s, 0) / Math.max(all.length - 1, 1)) * 100}%`,
                  background: 'rgba(0,0,0,0.55)', pointerEvents: 'none',
                }}
              />
            ))}
            <div
              style={{
                position: 'absolute', top: 0, bottom: 0, cursor: 'grab',
                left: `${(bounds.a / Math.max(all.length - 1, 1)) * 100}%`,
                width: `${((bounds.b - bounds.a) / Math.max(all.length - 1, 1)) * 100}%`,
              }}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId)
                dragRef.current = { mode: 'm', from: brushIndex(e.clientX) }
              }}
            >
              {(['l', 'r'] as const).map(h => (
                <div
                  key={h}
                  onPointerDown={e => {
                    e.stopPropagation()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    dragRef.current = { mode: h, from: brushIndex(e.clientX) }
                  }}
                  style={{
                    position: 'absolute', top: 0, bottom: 0, width: 14,
                    [h === 'l' ? 'left' : 'right']: -7, cursor: 'ew-resize',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 8, bottom: 8, left: 5, width: 3,
                    borderRadius: 2, background: 'var(--c-fg)', opacity: 0.8,
                  }} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Range summary + the one approximation, stated where it can be acted on. */}
      {!loading && view.length > 0 && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline', margin: '10px 2px 0', fontSize: 11.5 }}>
          <span style={{ opacity: 0.55 }}>
            {view[0].key} → {view[view.length - 1].key} · {scopeLabel(scope)}
          </span>
          <span><strong>{usd(totalShown)}</strong></span>
          {compare && priorShown > 0 && (
            <span style={{ color: pctColor(pctChange(totalShown, priorShown)) }}>
              {pctText(pctChange(totalShown, priorShown))} vs the year before
            </span>
          )}
        </div>
      )}

      <p style={{ fontSize: 10.5, opacity: 0.45, margin: '8px 2px 0', lineHeight: 1.5 }}>
        Billed by session date — not payments received. Rentals attach to a work order rather
        than a room, so a rental counts against the room its work order started in; totals
        across all rooms are exact.
      </p>
    </div>
  )
}

/**
 * The year overlay — one line per year on a shared Jan–Dec axis.
 *
 * A SINGLE-HUE RAMP, NOT A PALETTE. Every financial tool that draws this reaches
 * for one colour at descending strength rather than a different hue per year,
 * for two reasons: hues imply CATEGORIES, and years are ordered, so a ramp says
 * "older" where a rainbow says "different". It also keeps the carved law that
 * colour is status and nothing else — this is ink at varying weight, not a
 * second palette. The newest selected year is at full strength; each older one
 * steps back, so the current year reads first without a legend.
 *
 * Years are labelled at the END of their line rather than in a legend below.
 * The line is already there and already distinguishable by position; a legend
 * makes you look away from the chart to decode it and then look back.
 */
function YearOverlay({ years, byYear, W, H, PL, PR, PT, PB, hover, setHover, compactFn }: {
  years: string[]
  byYear: Map<string, (SeriesPoint | undefined)[]>
  W: number; H: number; PL: number; PR: number; PT: number; PB: number
  hover: number | null
  setHover: (i: number | null) => void
  compactFn: (n: number) => string
}) {
  const pw = W - PL - PR - 34   // room on the right for the year labels
  const ph = H - PT - PB
  const xOf = (m: number) => PL + (pw / 11) * m

  let max = 0
  for (const y of years) {
    for (const p of byYear.get(y) ?? []) if (p && p.value > max) max = p.value
  }
  max = (max || 1) * 1.1
  const yOf = (v: number) => PT + ph - (v / max) * ph

  const ordered = [...years].sort()   // oldest → newest, so newest paints last

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
      style={{ display: 'block', cursor: 'crosshair' }}
      role="img" aria-label={`Revenue by month, ${ordered.join(', ')}`}
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - r.left) / r.width) * W
        setHover(Math.max(0, Math.min(11, Math.round((x - PL) / (pw / 11)))))
      }}
      onMouseLeave={() => setHover(null)}
    >
      {[0, 1, 2, 3].map(i => (
        <g key={i}>
          {i % 2 === 0 && (
            <rect x={PL} y={PT + (ph / 4) * i} width={pw} height={ph / 4}
              fill="var(--c-wash)" opacity={0.5} />
          )}
          <text x={PL - 8} y={PT + (ph / 4) * i + 3} textAnchor="end"
            fontSize={9.5} fill="var(--c-fg)" fillOpacity={0.42}>
            {compactFn(max * (1 - i / 4))}
          </text>
        </g>
      ))}

      {hover !== null && (
        <line x1={xOf(hover)} x2={xOf(hover)} y1={PT} y2={PT + ph}
          stroke="var(--c-fg)" strokeOpacity={0.3} strokeWidth={1} />
      )}

      {ordered.map((year, idx) => {
        const newest = idx === ordered.length - 1
        // Older years step back in strength. Floor at 0.22 so a ten-year
        // selection still shows its oldest line rather than fading to nothing.
        const depth = ordered.length > 1 ? idx / (ordered.length - 1) : 1
        const opacity = newest ? 1 : 0.22 + depth * 0.4
        const row = byYear.get(year) ?? []
        const pts: [number, number][] = []
        for (let m = 0; m < 12; m++) {
          const p = row[m]
          // A month with no data ends the line rather than being drawn as zero
          // — a year that has not reached October has not billed nothing in
          // October.
          if (!p || (p.value === 0 && !p.partial)) continue
          pts.push([xOf(m), yOf(p.value)])
        }
        if (pts.length === 0) return null
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
        const last = pts[pts.length - 1]
        const partialAt = row.findIndex(p => p?.partial)
        return (
          <g key={year}>
            <path d={d} fill="none" stroke="var(--c-fg)" strokeOpacity={opacity}
              strokeWidth={newest ? 2.4 : 1.5} strokeLinejoin="round" />
            {hover !== null && row[hover] && (
              <circle cx={xOf(hover)} cy={yOf(row[hover]!.value)} r={newest ? 4 : 3}
                fill={partialAt === hover ? 'var(--c-bg)' : 'var(--c-fg)'}
                stroke="var(--c-fg)" strokeWidth={partialAt === hover ? 1.6 : 0}
                strokeOpacity={opacity} fillOpacity={partialAt === hover ? 1 : opacity} />
            )}
            <text x={last[0] + 6} y={last[1] + 3} fontSize={10} fill="var(--c-fg)"
              fillOpacity={newest ? 0.9 : opacity} fontWeight={newest ? 700 : 400}>
              {year}
            </text>
          </g>
        )
      })}

      {MONTH_ABBR.map((m, i) => (
        <text key={m} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize={9.5}
          fill="var(--c-fg)" fillOpacity={hover === i ? 0.85 : 0.42}>
          {m}
        </text>
      ))}
    </svg>
  )
}

function Field({ k, v, tone, note, small }: {
  k: string; v: string; tone?: string; note?: string; small?: boolean
}) {
  return (
    <div>
      <span className="c-label" style={{ display: 'block', marginBottom: 2 }}>{k}</span>
      <span style={{ fontSize: small ? 13 : 17, fontWeight: 700, letterSpacing: '-0.02em', color: tone }}>
        {v}
      </span>
      {note && <span style={{ fontSize: 11, opacity: 0.45, marginLeft: 6 }}>{note}</span>}
    </div>
  )
}
