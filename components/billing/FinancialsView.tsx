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
  fetchFinancialLines, fetchHistory, fetchSeries, buildSeries, buildDrawPoints,
  roomOptions, scopeMatches, scopeLabel, autoGrain, shiftBack, bucketStart,
  pctChange, compareLabel, monthLabel, GRAINS,
  METRICS,
  type FinLine, type HistMonth, type Metric, type RoomScope, type Compare,
  type SeriesPoint, type Grain, type DrawPoint,
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

  // null = follow the zoom. The archive is DAILY for nine years, and the first
  // build reduced all of it to 116 monthly points — Eli: "I have you day by day
  // numbers for 9 years, should be much clearer." So the grain follows the
  // window, with a manual override for when you want a specific one.
  const [grainOverride, setGrainOverride] = useState<Grain | null>(null)
  const [series, setSeries] = useState<DrawPoint[]>([])

  // SHARED Y SCALE (Eli, 2026-08-20): "when that axis changes when selecting
  // different rooms it's very confusing as the graph lines are similar sizes
  // but represent very different amounts of money."
  //
  // Exactly right, and it is the standard autoscaling trap — an axis that fits
  // whatever is selected makes every selection look the same size. Encore A at
  // $40k a month and Track North at $4k drew identical shapes. So the ceiling is
  // held at the ALL-ROOMS maximum by default: a room earning a tenth as much now
  // draws a line a tenth as tall, which is the honest picture and the whole
  // point of being able to switch rooms.
  //
  // `Fit` is still there for when the question is a small room's SHAPE rather
  // than its size — at the shared scale a quiet room is a flat squiggle along
  // the floor, and sometimes you do want to see its own peaks and troughs.
  const [sameScale, setSameScale] = useState(true)
  const [refMax, setRefMax] = useState(0)

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

  // Land on the last three years — enough to read the arc without the 2017 tail
  // squeezing recent months into noise. `all` is MONTHLY: it drives the brush
  // and the year overlay, and the brush window is expressed as indices into it.
  const bounds = win ?? { a: Math.max(0, all.length - 37), b: all.length - 1 }

  // The visible window, as real dates. `all` is monthly and drives the brush;
  // the DRAWN line is fetched separately at whatever grain suits this window.
  const winFrom = all[Math.max(0, Math.min(bounds.a, all.length - 1))]?.key ?? from.slice(0, 7)
  const winToKey = all[Math.max(0, Math.min(bounds.b, all.length - 1))]?.key ?? today.slice(0, 7)
  const fromISO = `${winFrom}-01`
  // End of the last month in the window, clamped to today — asking the archive
  // for future dates is harmless but asking for a partial month's real end is
  // what makes the partial-period comparison line up.
  const winEnd = winToKey >= today.slice(0, 7)
    ? today
    : new Date(Date.UTC(Number(winToKey.slice(0, 4)), Number(winToKey.slice(5, 7)), 0))
        .toISOString().slice(0, 10)
  // STOP AT THE LAST REAL DAY. Running the window to today when the data ends
  // on the 18th emitted a run of empty buckets, which drew the line down to
  // zero and along the floor — a flat tail that reads as a collapse rather than
  // as an absence.
  const toISO = latest && latest < winEnd ? latest : winEnd

  const monthsInWindow = bounds.b - bounds.a + 1
  const grain: Grain = grainOverride ?? autoGrain(monthsInWindow)

  // Refetch the drawn line whenever the window, grain, metric or room changes.
  // Each request is bounded by construction (see the migration header) so it
  // can never hit the 1,000-row cap regardless of how far the archive grows.
  //
  // DEBOUNCED, AND THAT IS NOT A POLISH DETAIL (bug, 2026-08-20).
  //
  // The first version fetched on every change of the window. A trackpad pinch
  // or two-finger scroll emits dozens of wheel events per second, each moving
  // the window, so each gesture opened dozens of concurrent RPC pairs and
  // drained Supabase's connection pool — "Timed out acquiring connection from
  // connection pool", over and over. The zoom looked broken because the
  // requests were failing, not because the gesture was not registering.
  //
  // 220ms is long enough that a whole gesture collapses into one request and
  // short enough to feel immediate on release. The chart keeps drawing the
  // previous series meanwhile, so the gesture stays smooth — the resolution
  // catches up a fifth of a second after your fingers stop.
  useEffect(() => {
    if (mode !== 'timeline') return
    let cancelled = false
    const timer = setTimeout(() => {
      const priorFrom = shiftBack(fromISO, grain)
      const priorTo = shiftBack(toISO, grain)
      Promise.all([
        fetchSeries(scope, metric, grain, fromISO, toISO),
        compare ? fetchSeries(scope, metric, grain, priorFrom, priorTo) : Promise.resolve([]),
        // The all-rooms ceiling for this same window and metric — only when a
        // room is actually selected, since otherwise it is the same request.
        scope && sameScale
          ? fetchSeries('', metric, grain, fromISO, toISO)
          : Promise.resolve([]),
      ]).then(([cur, prev, refAll]) => {
        if (cancelled) return
        setRefMax(refAll.reduce((m, r) => (r.amount > m ? r.amount : m), 0))
        // An empty result means the RPC is missing or failed. Keep whatever is
        // already drawn rather than dropping to the coarse fallback mid-gesture,
        // which would make the chart flicker between resolutions.
        if (cur.length === 0) return
        setSeries(buildDrawPoints(
          cur, prev, scoped, metric, grain, fromISO, toISO, latest || today,
        ))
      })
    }, 220)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [mode, scope, metric, grain, fromISO, toISO, compare, scoped, latest, today, sameScale])

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

  // THE DRAWN LINE is the fetched variable-grain series. It falls back to the
  // monthly rollup when that has not arrived — on first paint, or on a database
  // where `financial_series` has not been created yet. A chart that blanks
  // because a finer grain is unavailable is worse than a coarser one.
  const view: DrawPoint[] = series.length > 0
    ? series
    : all.slice(bounds.a, bounds.b + 1).map(p => ({
        key: p.key, label: p.label, value: p.value, prior: p.prior, partial: p.partial,
      }))

  const totalShown = view.reduce((s, p) => s + p.value, 0)
  const priorShown = view.reduce((s, p) => s + (p.prior ?? 0), 0)

  const active = hover !== null && view[hover] ? view[hover] : view[view.length - 1]

  // ── Geometry ──────────────────────────────────────────────────────────────
  const W = 1000
  // Taller than the first build (300). Eli asked for height, and while height
  // alone does not fix a rescaling axis, it does buy real room: at a shared
  // scale a quiet room's line lives in the bottom fifth, and 380 gives that
  // fifth enough pixels to still have a readable shape.
  const H = isMobile ? 230 : 380
  const PL = 54, PR = 10, PT = 14, PB = 24
  const pw = W - PL - PR
  const ph = H - PT - PB

  const max = useMemo(() => {
    let m = 0
    for (const p of view) {
      if (p.value > m) m = p.value
      if (compare && p.prior && p.prior > m) m = p.prior
    }
    // Hold the ceiling at the all-rooms maximum so switching rooms changes the
    // HEIGHT of the line rather than the meaning of the axis. Never scale DOWN
    // below the selection's own peak — that would clip the line off the top.
    if (sameScale && refMax > m) m = refMax
    return (m || 1) * 1.1
  }, [view, compare, sameScale, refMax])

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

  // ── Pinch / scroll to zoom ────────────────────────────────────────────────
  //
  // Eli, 2026-08-20: "i want to be able to zoom in zoom out with pinching and
  // spreading my touch pad."
  //
  // A trackpad pinch arrives as a `wheel` event with `ctrlKey` set — that is how
  // browsers have reported it since they mapped pinch onto page zoom, and it is
  // the only way to read the gesture without a touch device. Plain two-finger
  // scroll stays as PAN, which is the pairing every map and charting tool uses.
  //
  // Bound through `addEventListener` with `passive: false` rather than React's
  // `onWheel`, because React attaches wheel listeners passively and a passive
  // listener cannot `preventDefault()` — without which a pinch zooms the whole
  // page instead of the chart.
  const plotRef = useRef<HTMLDivElement>(null)
  const lenRef = useRef(all.length)
  lenRef.current = all.length

  useEffect(() => {
    const el = plotRef.current
    if (!el || mode !== 'timeline') return

    const onWheel = (e: WheelEvent) => {
      const len = lenRef.current
      if (len < 3) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))

      setWin(prev => {
        const cur = prev ?? { a: Math.max(0, len - 37), b: len - 1 }
        const width = cur.b - cur.a

        if (e.ctrlKey) {
          // PINCH. Exponential so each notch scales rather than adds — linear
          // steps crawl when zoomed out and overshoot when zoomed in.
          const factor = Math.exp(e.deltaY * 0.012)
          let next = width * factor
          // A pinch arrives as many SMALL deltas. `exp(1 × 0.012)` is 1.012, so
          // on a 37-month window that is 37.4 — which rounds straight back to 37
          // and the gesture does nothing at all. Force at least one unit of
          // movement per event so small deltas accumulate instead of vanishing.
          if (Math.round(next) === width) next = width + (factor > 1 ? 1 : -1)
          // Floor of 2 months: below that the window is finer than the brush
          // can express, since the brush indexes months.
          const w = Math.max(2, Math.min(len - 1, Math.round(next)))
          // Zoom about the cursor, so whatever is under the pointer stays put.
          let a = Math.round(cur.a + width * frac - w * frac)
          a = Math.max(0, Math.min(len - 1 - w, a))
          return { a, b: a + w }
        }

        // PAN. Horizontal intent on a trackpad shows up as deltaX; a mouse
        // wheel only has deltaY, so fall back to it and let a plain wheel scrub.
        const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        if (raw === 0) return cur
        const shift = Math.max(1, Math.round(width * 0.04)) * (raw > 0 ? 1 : -1)
        const a = Math.max(0, Math.min(len - 1 - width, cur.a + shift))
        return { a, b: a + width }
      })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode])

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

        {/* Only meaningful once a room narrows the data — with All rooms
            selected the two scales are the same number. */}
        {mode === 'timeline' && scope !== '' && (
          <button
            className={`c-control c-soft${sameScale ? ' c-on' : ''}`}
            style={chip}
            onClick={() => setSameScale(v => !v)}
            aria-pressed={sameScale}
            title={sameScale
              ? 'The axis is held at the all-rooms maximum, so this room\'s size is comparable'
              : 'The axis fits this room alone — good for its shape, misleading about its size'}
          >
            {sameScale ? 'Same scale' : 'Fit to room'}
          </button>
        )}

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

        {/* GRAIN. Auto follows the zoom, which is what you want almost always;
            the explicit buttons are for pinning it. The auto choice is shown on
            the button so the chart never silently changes resolution under you
            without saying which one it picked. */}
        {mode === 'timeline' && (
          <span style={{ display: 'flex', gap: 4 }}>
            <button
              className={`c-control c-soft${grainOverride === null ? ' c-on' : ''}`}
              style={chip}
              onClick={() => setGrainOverride(null)}
              aria-pressed={grainOverride === null}
              title="Pick the resolution automatically from how far you are zoomed in"
            >
              Auto · {grain}
            </button>
            {GRAINS.map(g => (
              <button
                key={g.key}
                className={`c-control c-soft${grainOverride === g.key ? ' c-on' : ''}`}
                style={chip}
                onClick={() => setGrainOverride(g.key)}
                aria-pressed={grainOverride === g.key}
              >
                {g.label}
              </button>
            ))}
          </span>
        )}

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
              v={grain === 'month'
                ? `${monthLabel(active.key)} ${active.key.slice(0, 4)}`
                : grain === 'week'
                  ? `Week of ${active.label}`
                  : `${active.label} ${active.key.slice(0, 4)}`}
              note={active.partial ? `partial ${grain}` : undefined}
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
              k={`vs previous ${grain}`}
              v={(() => {
                const i = view.findIndex(p => p.key === active.key)
                const prev = i > 0 ? view[i - 1] : null
                // A partial period against a whole previous one would report a
                // fall that is only the calendar. Like for like, or not at all.
                if (!prev || active.partial) return '—'
                return pctText(pctChange(active.value, prev.value))
              })()}
              tone={(() => {
                const i = view.findIndex(p => p.key === active.key)
                const prev = i > 0 ? view[i - 1] : null
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
      <div ref={plotRef} className="c-panel c-inset2" style={{ padding: '8px 10px 2px' }}>
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
              // EVENLY SPACED BY INDEX, always. Two earlier attempts picked
              // labels by calendar boundary — first Januaries, then the first
              // week of each month — and both produced overlapping text
              // ("20202024" printed on top of "20182026"), because boundaries
              // are not evenly spaced in index terms and a step across them
              // clusters. Spacing by index cannot collide by construction; the
              // YEAR is carried in the text instead of by position.
              const target = Math.min(9, n)
              const step = Math.max(1, Math.round(n / target))
              return view.map((p, i) => {
                if (i % step !== 0) return null
                const isJan = p.key.slice(5, 7) === '01'
                const first = i === 0
                const label = grain === 'month'
                  ? (isJan || first ? `${p.label} ${p.key.slice(0, 4)}` : p.label)
                  : `${monthLabel(p.key)}${isJan || first ? ` ${p.key.slice(0, 4)}` : ''}`
                return (
                  <text key={p.key} x={xOf(i)} y={H - 6} textAnchor="middle"
                    fontSize={9.5} fill="var(--c-fg)"
                    fillOpacity={hover === i ? 0.85 : isJan ? 0.62 : 0.42}
                    fontWeight={isJan ? 700 : 400}>
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
            Pinch the graph to zoom · two-finger scroll to pan · or drag the handles below
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
