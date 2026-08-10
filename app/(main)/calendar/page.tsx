'use client'
import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { STUDIO_LOCATIONS, parseLocation } from '@/lib/studios'
import { type FormData, emptyForm } from '@/components/calendar/sessionFormData'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { createWorkOrderForBooking, bookingShouldHaveWorkOrder } from '@/lib/createWorkOrder'
import { deleteSessionAndWO } from '@/lib/deleteSession'
import { dateRange } from '@/lib/time'
import { useIsMobile } from '@/hooks/useIsMobile'
import { SessionCardBody, CARD_FULL_H, initials, sessionFillClass } from '@/components/calendar/SessionCard'
import { StatusDot, StatusPill } from '@/components/carved'

// ─── LOCATIONS ───────────────────────────────────────────────────────────────

const LOCATIONS = STUDIO_LOCATIONS

// Short codes shown in the grid location headers on mobile only
const LOCATION_CODES: Record<string, string> = {
  Paramount: 'PRS',
  Ameraycan: 'ARS',
  Encore: 'ERS',
  Track: 'TRS',
}

// ─── COLOR TOKENS ────────────────────────────────────────────────────────────

// Booking status -> carved status slot (§5). The calendar is the one surface
// where every slot appears, so this is the canonical mapping.
// Only the hover card's StatusPill still needs this — it takes a status NAME,
// not a fill class. Chip colour comes from sessionFillClass (one decision, one
// place). Do not reintroduce a second status→colour map here.
const STATUS_SLOT: Record<string, string> = {
  confirmed:  'confirmed',
  tentative:  'tentative',
  cancelled:  'cancelled',
  tour:       'tour',
  tech:       'tech',
  open_hours: 'open_hours',
}

// ─── LAYOUT CONSTANTS ────────────────────────────────────────────────────────

const LABEL_W = 148
const COL_W = 120  // minimum day-column width; forces horizontal scroll when cols × days > viewport
// ROW HEIGHT — two modes, not a ladder. VERTICAL ONLY (column width is the
// horizontal zoom, below; the two were confused once and bumping this made every
// row taller instead of the cells wider).
//
// The old five-step ladder went because four steps were useless: 'Fit' and the
// 80px step looked identical (the fit calculation was floored at one card's
// height, so it never actually squeezed anything), and taller than 80 bought
// nothing — the card's content is fixed, so extra height is just empty chip.
// The only direction anyone wanted was SMALLER.
//   'card'  — one card's natural height. The default. Never changes.
//   'rooms' — divide the viewport by the visible room count so the whole
//             calendar fits with no vertical scrolling; cards shed content
//             through the ladder in SessionCardBody as they shrink.
const ROW_H_CARD = 80
type RowMode = 'card' | 'rooms'
// Mobile row height — one full card, since mobile has no mode switch.
const CHIP_MIN_H = 79

// COLUMN WIDTH — the horizontal zoom, in px per day.
// This replaced the Week / 2 Wks / Month buttons. Those were only ever three
// fixed column widths wearing different names, and picking a named window is a
// worse fit for the actual question ("how much do I want to see at once?") than
// simply spreading the days apart. Pinch on a trackpad drives it directly.
//   MIN — below this a card can't show its anatomy legibly.
//   MAX — beyond this you're reading one day at a time; use Day view.
const COL_ZOOM_MIN = 48
const COL_ZOOM_MAX = 320
const COL_ZOOM_DEFAULT = 120  // ≈ the old 2-week feel, which was the default view
const COL_ZOOM_STEP = 24      // one press of the +/- buttons or [ / ]
const clampColZoom = (w: number) => Math.min(COL_ZOOM_MAX, Math.max(COL_ZOOM_MIN, Math.round(w)))
// Mobile has no pinch (the whole page zooms instead), so it keeps fit-to-width
// with a floor.
const COL_FLOOR_MOBILE = 76
// Height of the month rail. The day header sticks BELOW it, so this has to be a
// constant both can read — a mismatch overlaps the two sticky rows.
const MONTH_RAIL_H = 22
const BUFFER_WEEKS = 2 // weeks of buffer rendered on each side for endless horizontal scroll

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  const day = r.getDay()
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1))
  return r
}

function getSunday(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  r.setDate(r.getDate() - r.getDay())
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parse(s: string): Date {
  const [y, m, dd] = s.split('-').map(Number)
  return new Date(y, m - 1, dd)
}

function dayDiff(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000,
  )
}

function isWeekend(d: Date) {
  const n = d.getDay()
  return n === 0 || n === 6
}

function isToday(d: Date) {
  const t = new Date()
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()
}


function genInvoice(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function fmtTime(t: string): string {
  if (!t) return ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!m) return t
  let h = parseInt(m[1])
  const min = m[2]
  const ap = m[3]?.toUpperCase()
  if (ap) return `${h}${min !== '00' ? ':' + min : ''}${ap === 'AM' ? 'A' : 'P'}`
  const suf = h >= 12 ? 'P' : 'A'
  if (h > 12) h -= 12
  if (h === 0) h = 12
  return `${h}${min !== '00' ? ':' + min : ''}${suf}`
}

// "Aug 6" from a YYYY-MM-DD string. Parsed at noon so a timezone offset can't
// roll the date backwards, the same guard the runner pages use.
function shortDate(d: string): string {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function rangeLabel(start: Date, totalDays: number): string {
  const end = addDays(start, totalDays - 1)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const a = start.toLocaleDateString('en-US', opts)
  const b = end.toLocaleDateString('en-US', opts)
  const y = end.getFullYear()
  if (start.getMonth() === end.getMonth())
    return `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${y}`
  return `${a} – ${b}, ${y}`
}

// dateRange now comes from lib/time (canonical). ─────────────────────────────

// ─── LANE ASSIGNMENT ─────────────────────────────────────────────────────────

// Deliberately LOCAL, not lib/time's timeToMins: this is a sort key for lane
// assignment, where unparseable times must yield 0 (stable sort), not NaN.
function timeToMins(t: string | null | undefined): number {
  if (!t) return 0
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!m) return 0
  let h = parseInt(m[1])
  const min = parseInt(m[2])
  const ap = m[3]?.toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}

function bookingDateOverlaps(a: Booking, b: Booking): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date
}

function assignLanes(bookings: Booking[]): Map<string, { lane: number; numLanes: number }> {
  if (bookings.length === 0) return new Map()
  const sorted = [...bookings].sort((a, b) => {
    if (a.start_date < b.start_date) return -1
    if (a.start_date > b.start_date) return 1
    const dt = timeToMins(a.from_time) - timeToMins(b.from_time)
    if (dt !== 0) return dt
    if (a.end_date < b.end_date) return -1
    if (a.end_date > b.end_date) return 1
    return 0
  })
  const lanes: number[] = new Array(sorted.length).fill(0)
  for (let i = 0; i < sorted.length; i++) {
    const used = new Set<number>()
    for (let j = 0; j < i; j++) {
      if (bookingDateOverlaps(sorted[i], sorted[j])) used.add(lanes[j])
    }
    let lane = 0
    while (used.has(lane)) lane++
    lanes[i] = lane
  }
  const result = new Map<string, { lane: number; numLanes: number }>()
  for (let i = 0; i < sorted.length; i++) {
    let maxLane = lanes[i]
    for (let j = 0; j < sorted.length; j++) {
      if (i !== j && bookingDateOverlaps(sorted[i], sorted[j])) maxLane = Math.max(maxLane, lanes[j])
    }
    result.set(sorted[i].id, { lane: lanes[i], numLanes: maxLane + 1 })
  }
  return result
}

// ─── BOOKING BLOCK ───────────────────────────────────────────────────────────

function BookingBlock({
  booking, gridStart, totalDays, lane, numLanes, rowH, onClick, isMobile = false, staffByDay = {},
  onHover, onHoverEnd, colW = 0,
}: {
  booking: Booking; gridStart: Date; totalDays: number
  lane: number; numLanes: number; rowH: number; onClick: () => void
  // work_order_id|date -> staff for that day (F-9 Option B). Empty for legacy rows.
  staffByDay?: Record<string, { eng?: string; asst?: string }>
  onHover?: (booking: Booking, day: string, rect: DOMRect, cursorX: number) => void
  onHoverEnd?: () => void
  // Horizontal scroll offset + day-column width, so a long bar can slide its
  // payload along to stay on screen.
  colW?: number
  isMobile?: boolean
}) {
  const bStart = parse(booking.start_date)
  const bEnd = parse(booking.end_date)
  const gridEnd = addDays(gridStart, totalDays - 1)
  const visStart = bStart < gridStart ? gridStart : bStart
  const visEnd = bEnd > gridEnd ? gridEnd : bEnd
  const offset = dayDiff(gridStart, visStart)
  const dur = dayDiff(visStart, visEnd) + 1
  const left = (offset / totalDays) * 100
  const width = (dur / totalDays) * 100
  // Visible span in days — used to map the cursor's x-position to a day column
  // for the hover card.
  const spanDays = dur

  const isCancelled = booking.status === 'cancelled'
  const isBilling = booking.payment_type === 'billing'

  // Only needed for the repeated payload copies on long bars; the card itself
  // derives its own.
  const primaryName = isBilling
    ? (booking.artist || booking.label || booking.client_name || '')
    : (booking.client_name || '')

  // Line 2: label name — billing only, only when label differs from primaryName
  const labelLine = isBilling && booking.label && booking.label !== primaryName
    ? booking.label : ''

  const timeStr = booking.from_time && booking.to_time
    ? `${fmtTime(booking.from_time)}–${fmtTime(booking.to_time)}`
    : booking.from_time ? fmtTime(booking.from_time) : ''

  // Per-day staffing (F-9 Option B). A chip can span days, so it shows the staff
  // for its FIRST day; the hover card reports the exact day under the cursor.
  // Falls back to the projection's collapsed names when the booking has no
  // studio_time_rows at all (legacy / pre-WO) — never blank.
  function staffFor(dateStr: string): { eng: string; asst: string } {
    const hit = booking.work_order_id ? staffByDay[`${booking.work_order_id}|${dateStr}`] : undefined
    if (hit) return { eng: initials(hit.eng ?? null), asst: initials(hit.asst ?? null) }
    return { eng: initials(booking.engineer_name), asst: initials(booking.assistant_name) }
  }
  const { eng, asst } = staffFor(booking.start_date)

  const slotH = rowH / numLanes
  const blockTop = lane * slotH + 2
  const blockHeight = slotH - 3
  // Fields drop by HEIGHT inside SessionCardBody — see the ladder there. This
  // component only supplies the measurement.

  // ── Long bars: repeat the payload, don't chase the scroll ─────────────────
  // Three attempts to slide the payload with the scroll position all drifted and
  // dropped it mid-scroll. The cause is that the calendar re-anchors its grid as
  // you scroll (infinite scroll), so any position derived from scroll offset can
  // desync. A static repeat has NO scroll dependency, so it cannot drift: the
  // payload is simply drawn again every 7 days along the bar. Whatever part of a
  // long bar is on screen, a copy is within a week of it.
  const REPEAT_DAYS = 7
  const repeatOffsets = spanDays > REPEAT_DAYS * 1.5
    ? Array.from({ length: Math.floor(spanDays / REPEAT_DAYS) }, (_, i) => (i + 1) * REPEAT_DAYS)
        .filter(d => d < spanDays - 1)
    : []

  return (
    <div
      onClick={e => { e.stopPropagation(); onClick() }}
      onMouseMove={onHover ? e => {
        // Which day column is under the cursor — so a month-long bar reports the
        // day being pointed at, not the day the bar happens to start on.
        const r = e.currentTarget.getBoundingClientRect()
        const frac = (e.clientX - r.left) / Math.max(1, r.width)
        const idx = Math.min(spanDays - 1, Math.max(0, Math.floor(frac * spanDays)))
        onHover(booking, fmt(addDays(visStart, idx)), r, e.clientX)
      } : undefined}
      onMouseLeave={onHoverEnd}
      className={`c-ev c-control c-raised-chip ${sessionFillClass(booking.status)}${isCancelled ? ' c-ev-cancelled' : ''}`}
      style={{
        position: 'absolute', top: blockTop, height: blockHeight,
        minHeight: isMobile ? 44 : undefined,
        left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)`,
        boxSizing: 'border-box',
        // Padding moves to the payload: the footer band and COD strip are
        // full-bleed to the chip's edges, so the chip itself can't be inset.
        padding: 0,
        cursor: 'pointer', overflow: 'hidden',
        zIndex: 2, minWidth: 0,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <SessionCardBody booking={booking} height={blockHeight} eng={eng} asst={asst} isMobile={isMobile}>
        {/* Repeated copies of the payload every 7 days along a long bar, so the
            session stays identifiable wherever you're scrolled. Static — no
            scroll maths, nothing to drift. */}
        {repeatOffsets.map(d => (
          <div key={d} aria-hidden style={{
            position: 'absolute', top: 4, left: `calc(${(d / spanDays) * 100}% + 6px)`,
            pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 0,
          }}>
            <div className="c-arch" style={{ fontSize: 12, lineHeight: 1.3 }}>{primaryName}</div>
            {labelLine && <div className="c-ev-meta" style={{ fontSize: 10, lineHeight: 1.2 }}>{labelLine}</div>}
            <div className="c-ev-2 c-mono" style={{ fontSize: 9.5, lineHeight: 1.25 }}>{timeStr}</div>
          </div>
        ))}
      </SessionCardBody>
    </div>
  )
}


// ─── DAY VIEW ────────────────────────────────────────────────────────────────

function DayView({
  dayViewDate,
  setDayViewDate,
  locFilter,
  onOpenEdit,
  reloadKey,
  isMobile = false,
}: {
  dayViewDate: Date
  setDayViewDate: (d: Date) => void
  locFilter: string
  onOpenEdit: (b: Booking) => void
  reloadKey: number
  isMobile?: boolean
}) {
  const [dayBookings, setDayBookings] = useState<Booking[]>([])
  const [miniMonthStart, setMiniMonthStart] = useState(
    () => new Date(dayViewDate.getFullYear(), dayViewDate.getMonth(), 1)
  )

  const dateStr = fmt(dayViewDate)
  const todayStr = fmt(new Date())

  useEffect(() => {
    supabase.from('bookings').select('*')
      .lte('start_date', dateStr)
      .gte('end_date', dateStr)
      .then(({ data }) => setDayBookings(data ?? []))
  }, [dateStr, reloadKey])

  // Sync mini calendar month when day nav crosses a month boundary
  const monthKey = `${dayViewDate.getFullYear()}-${dayViewDate.getMonth()}`
  useEffect(() => {
    setMiniMonthStart(new Date(dayViewDate.getFullYear(), dayViewDate.getMonth(), 1))
  }, [monthKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build mini calendar grid
  const miniCells: (Date | null)[] = []
  const firstWeekday = miniMonthStart.getDay()
  const daysInMonth = new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth() + 1, 0).getDate()
  for (let i = 0; i < firstWeekday; i++) miniCells.push(null)
  for (let d = 1; d <= daysInMonth; d++)
    miniCells.push(new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth(), d))

  const filteredLocs = locFilter === 'All' ? LOCATIONS : LOCATIONS.filter(l => l.name === locFilter)
  const allStudios = filteredLocs.flatMap(loc => loc.rooms.map(room => ({ loc: loc.name, room })))

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

      {/* ── LEFT: mini month calendar — hidden on mobile (no room for it) ── */}
      {!isMobile && (
      <div style={{
        width: 216, flexShrink: 0, overflowY: 'auto',
        background: 'var(--c-bg)',
        padding: '16px 14px',
      }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button
            onClick={() => setMiniMonthStart(new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth() - 1, 1))}
            style={{ background: 'none', color: 'var(--c-fg-2)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
          >‹</button>
          <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 12, color: 'var(--c-fg)', letterSpacing: '0.04em' }}>
            {miniMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => setMiniMonthStart(new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth() + 1, 1))}
            style={{ background: 'none', color: 'var(--c-fg-2)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
          >›</button>
        </div>

        {/* Weekday labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 9, fontFamily: 'Inter', color: 'var(--c-fg-3)', padding: '2px 0' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px 0' }}>
          {miniCells.map((cell, i) => {
            if (!cell) return <div key={`e-${i}`} />
            const cellStr = fmt(cell)
            const isSelected = cellStr === dateStr
            const isTodayCell = cellStr === todayStr
            return (
              <div key={cellStr} onClick={() => setDayViewDate(cell)}
                style={{ textAlign: 'center', cursor: 'pointer', padding: '2px 0' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', margin: '0 auto',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontFamily: 'Inter',
                  background: isSelected ? 'var(--c-fg)' : isTodayCell ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: isSelected ? 'var(--c-bg)' : 'var(--c-fg-2)',
                  fontWeight: isSelected || isTodayCell ? 700 : 400,
                  outline: isTodayCell && !isSelected ? '1px solid rgba(255,255,255,0.2)' : 'none',
                }}>
                  {cell.getDate()}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      )}

      {/* ── RIGHT: date header + studio cards ─────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', flexShrink: 0,
          }}>
          <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 15, color: 'var(--c-fg)' }}>
            {dayViewDate.toLocaleDateString('en-US', isMobile
              ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
              : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setDayViewDate(addDays(dayViewDate, -1))}
              style={{ background: 'var(--c-wash)', color: 'var(--c-fg)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>‹</button>
            <button onClick={() => setDayViewDate(new Date())}
              style={{ background: 'var(--c-wash)', color: 'var(--c-fg-2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'Inter', cursor: 'pointer' }}>Today</button>
            <button onClick={() => setDayViewDate(addDays(dayViewDate, 1))}
              style={{ background: 'var(--c-wash)', color: 'var(--c-fg)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>›</button>
          </div>
        </div>

        {/* Studio cards grid — single column (rooms as rows) on mobile */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
            {allStudios.map(({ loc, room }) => {
              const cards = dayBookings
                .filter(b => b.location === loc && b.studio === room)
                .sort((a, b) => timeToMins(a.from_time) - timeToMins(b.from_time))
              return (
                <div key={`${loc}|${room}`} style={{
                  position: 'relative',
                  background: 'var(--c-bg)',
                  borderRadius: 6, overflow: 'hidden',
                  }}>
                  {cards.length > 0 && (
                    /* 2px teal top bar */
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--c-st-booked)', zIndex: 3 }} />
                  )}
                  {/* Card header */}
                  <div style={{ padding: '6px 10px', background: 'var(--c-wash)' }}>
                    <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, color: 'var(--c-fg-2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {loc} {room}
                    </span>
                  </div>

                  {/* Booking blocks */}
                  {cards.map(b => {
                    const isCancelled = b.status === 'cancelled'
                    // Height is fixed here — the day view has room, so the card
                    // always renders its full anatomy.
                    return (
                      <div
                        key={b.id}
                        onClick={() => onOpenEdit(b)}
                        className={`c-ev c-control c-raised-chip ${sessionFillClass(b.status)}${isCancelled ? ' c-ev-cancelled' : ''}`}
                        style={{ padding: 0, cursor: 'pointer', minHeight: CARD_FULL_H }}
                      >
                        <SessionCardBody
                          booking={b}
                          height={CARD_FULL_H}
                          eng={initials(b.engineer_name)}
                          asst={initials(b.assistant_name)}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── STUDIO VIEW ─────────────────────────────────────────────────────────────

function StudioView({
  locFilter,
  onOpenEdit,
  onOpenNew,
  reloadKey,
}: {
  locFilter: string
  onOpenEdit: (b: Booking) => void
  onOpenNew: (location?: string, studio?: string, date?: string) => void
  reloadKey: number
}) {
  const [loc, room] = locFilter.includes('|') ? locFilter.split('|') : ['', '']
  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [studioBookings, setStudioBookings] = useState<Booking[]>([])

  const year = monthStart.getFullYear()
  const month = monthStart.getMonth()

  useEffect(() => {
    if (!loc || !room) return
    const start = fmt(new Date(year, month, 1))
    const end = fmt(new Date(year, month + 1, 0))
    supabase.from('bookings').select('*')
      .eq('location', loc)
      .eq('studio', room)
      .lte('start_date', end)
      .gte('end_date', start)
      .then(({ data }) => setStudioBookings(data ?? []))
  }, [year, month, loc, room, reloadKey])

  // Build month grid cells
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const numWeeks = cells.length / 7
  const todayStr = fmt(new Date())

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', flexShrink: 0,
        }}>
        <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 15, color: 'var(--c-fg)' }}>
          <span style={{ color: 'var(--c-fg)', textTransform: 'uppercase' }}>{loc} {room}</span>
          <span style={{ color: 'var(--c-fg-3)', margin: '0 8px' }}>—</span>
          {monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setMonthStart(new Date(year, month - 1, 1))}
            style={{ background: 'var(--c-wash)', color: 'var(--c-fg)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >‹</button>
          <button
            onClick={() => { const t = new Date(); setMonthStart(new Date(t.getFullYear(), t.getMonth(), 1)) }}
            style={{ background: 'var(--c-wash)', color: 'var(--c-fg-2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'Inter', cursor: 'pointer' }}
          >Today</button>
          <button
            onClick={() => setMonthStart(new Date(year, month + 1, 1))}
            style={{ background: 'var(--c-wash)', color: 'var(--c-fg)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >›</button>
        </div>
      </div>

      {/* Weekday labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', flexShrink: 0 }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{
            textAlign: 'center', padding: '5px 0',
            fontFamily: 'Inter', fontSize: 10, color: 'var(--c-fg-3)',
            letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>{d}</div>
        ))}
      </div>

      {/* Month grid */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateRows: `repeat(${numWeeks}, minmax(80px, auto))`,
        gridTemplateColumns: 'repeat(7, 1fr)',
        overflow: 'auto',
        alignContent: 'start',
      }}>
        {cells.map((cell, i) => {
          if (!cell) return (
            <div key={`empty-${i}`} style={{
              background: 'rgba(0,0,0,0.15)',
              minHeight: 80,
            }} />
          )
          const cellStr = fmt(cell)
          const isTodayCell = cellStr === todayStr
          const cellBookings = studioBookings
            .filter(b => b.start_date <= cellStr && b.end_date >= cellStr)
            .sort((a, b) => timeToMins(a.from_time) - timeToMins(b.from_time))
          return (
            <div
              key={cellStr}
              onDoubleClick={() => onOpenNew(loc, room, cellStr)}
              style={{
                padding: '4px 5px',
                background: isTodayCell ? 'var(--c-wash2)' : 'transparent',
              }}
            >
              {/* Date number */}
              <div style={{
                width: 22, height: 22, borderRadius: '50%', marginBottom: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isTodayCell ? 'var(--c-fg)' : 'transparent',
                color: isTodayCell ? 'var(--c-bg)' : 'var(--c-fg-3)',
                fontSize: 11, fontFamily: 'Inter', fontWeight: isTodayCell ? 700 : 400,
              }}>
                {cell.getDate()}
              </div>
              {/* Booking blocks */}
              {cellBookings.map(b => {
                // §10b anatomy, as in the grid and day views. Name/time/payment
                // derivation lives in SessionCardBody now — this view used to
                // build a different display name ("Label / Artist") from the
                // grid's, which is exactly the drift the shared card ends.
                const isCancelled = b.status === 'cancelled'
                return (
                  <div
                    key={b.id}
                    onClick={e => { e.stopPropagation(); onOpenEdit(b) }}
                    className={`c-ev c-control c-raised-chip ${sessionFillClass(b.status)}${isCancelled ? ' c-ev-cancelled' : ''}`}
                    style={{ marginBottom: 3, padding: 0, cursor: 'pointer', minHeight: CARD_FULL_H }}
                  >
                    <SessionCardBody
                      booking={b}
                      height={CARD_FULL_H}
                      eng={initials(b.engineer_name)}
                      asst={initials(b.assistant_name)}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

// 'grid' replaced 'week' | '2wks' | 'month' — those were three fixed column
// widths, and the horizontal zoom covers all of them continuously.
type ViewType = 'day' | 'studio' | 'grid'

export default function CalendarPage() {
  return <Suspense><CalendarPageInner /></Suspense>
}

function CalendarPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  // Default to Day view on mobile, 2 Wks on desktop. This component renders client-only
  // (behind Suspense + useSearchParams), so reading matchMedia in the initializer is
  // safe — no SSR/hydration mismatch. The effect below is a backup for late breakpoint
  // resolution / resize.
  const [view, setView] = useState<ViewType>(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 768px)').matches) return 'day'
    return 'grid'
  })
  const [startDate, setStartDate] = useState(() => getSunday(new Date()))
  const [bookings, setBookings] = useState<Booking[]>([])
  // Step 6/8: the calendar opens the Work Order directly for ALL sessions and
  // blocks (BookingForm deleted — legacy WO-less blocks use the WO's block view).
  const [woBooking, setWoBooking] = useState<Booking | null>(null)
  // The CRM lead this WO came from, when opened via "Start Booking". Handed to
  // the WO so it can mark the lead booked once the session is actually saved.
  // Cleared whenever a WO is opened by any other route.
  const [woLeadId, setWoLeadId] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(() => new Set())
  const [locFilter, setLocFilter] = useState('All')
  const [dayViewDate, setDayViewDate] = useState<Date>(() => new Date())
  const [reloadKey, setReloadKey] = useState(0)
  const [woWarning, setWoWarning] = useState<string | null>(null)
  const [rowMode, setRowMode] = useState<RowMode>('card')
  // COLUMN WIDTH — px per day. Driven by trackpad pinch, the +/- buttons, and
  // [ / ]. Persisted so the calendar reopens at the density you left it at.
  const [colZoom, setColZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return COL_ZOOM_DEFAULT
    const saved = Number(window.localStorage.getItem('prsflo-cal-colzoom'))
    return saved >= COL_ZOOM_MIN && saved <= COL_ZOOM_MAX ? saved : COL_ZOOM_DEFAULT
  })
  useEffect(() => {
    try { window.localStorage.setItem('prsflo-cal-colzoom', String(colZoom)) } catch {}
  }, [colZoom])
  const [gridH, setGridH] = useState(700)
  const [gridW, setGridW] = useState(1200)
  const gridRef = useRef<HTMLDivElement>(null)
  // Horizontal scroll offset, used only to keep long-bar payloads visible.
  const [scrollX, setScrollX] = useState(0)
  // Visible width of the DAY area (grid minus the sticky label column).
  const [viewportW, setViewportW] = useState(0)
  const scrollRaf = useRef<number | null>(null)
  useEffect(() => () => { if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current) }, [])
  const lastWheelStep = useRef(0)
  const scrollCorrectionRef = useRef<number | null>(null)
  const shiftingRef = useRef(false)
  const isMobile = useIsMobile()

  // Carved ground for this route — without it the page sits on the legacy
  // background while its content is carved paper.
  useEffect(() => {
    document.documentElement.classList.add('c-page')
    return () => document.documentElement.classList.remove('c-page')
  }, [])
  // Narrower room-label column on mobile so day columns keep usable width
  const labelW = isMobile ? 80 : LABEL_W


  // The window is derived from the zoom, not chosen: enough whole weeks to fill
  // the viewport at the current column width. WHOLE weeks matters — startDate
  // stays a Sunday, which is what keeps the heavy week ticks landing on real week
  // boundaries and the infinite-scroll shift (±7 days) aligned.
  const zoomColW = isMobile
    ? 0 // computed below from viewport; mobile doesn't zoom
    : Math.min(COL_ZOOM_MAX, Math.max(COL_ZOOM_MIN, colZoom))
  const totalDays = isMobile
    ? 7
    : Math.max(7, Math.ceil(Math.ceil(Math.max(1, gridW - labelW) / zoomColW) / 7) * 7)
  // No horizontal-scroll buffer on mobile: the week fits the viewport exactly, so
  // there's no native horizontal scroll or infinite-scroll shifting to fight with
  // the touch swipe handler (which is then the sole, discrete week navigator).
  const bufDays = isMobile ? 0 : BUFFER_WEEKS * 7
  const totalRenderDays = totalDays + bufDays * 2
  const gridRenderStart = addDays(startDate, -bufDays)
  const days = Array.from({ length: totalRenderDays }, (_, i) => addDays(gridRenderStart, i))

  const usableW = Math.max(gridW - labelW, isMobile ? 200 : 400)
  // Desktop: the zoom IS the column width. Mobile: fit a week to the viewport.
  const colW = isMobile
    ? Math.max(COL_FLOOR_MOBILE, Math.floor(usableW / 7))
    : zoomColW
  // How many days are actually on screen — used for the header label, so it
  // describes what you're looking at rather than the rendered window.
  const visibleDays = Math.max(1, Math.round(usableW / colW))

  // ── Hover card (F-11) ─────────────────────────────────────────────────────
  // Built entirely from data already on the page (projection + the Option B
  // per-day staffing map) — no new queries. `position: fixed` so the card can
  // never be clipped by the calendar's overflow, and clamped to the viewport.
  const [hoverCard, setHoverCard] = useState<
    { booking: Booking; day: string; x: number; y: number; below: boolean } | null
  >(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastHoverEnd = useRef<number>(0)
  const canHover = useRef(false)
  useEffect(() => {
    // Touch devices get no hover behaviour at all — tap stays click-to-open.
    canHover.current = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
  }, [])

  function showHover(booking: Booking, day: string, rect: DOMRect, cursorX: number) {
    if (!canHover.current) return
    const CARD_H = 190, CARD_W = 300, GAP = 10
    const below = rect.top - CARD_H - GAP < 8
    // Anchored to the CURSOR, not the chip's left edge — on a long bar that edge
    // can be weeks off-screen, which pinned the card to the far left and clipped
    // it. Nudged left so the pointer sits just inside the card, then clamped.
    const x = Math.min(Math.max(8, cursorX - 24), window.innerWidth - CARD_W - 8)
    const y = below ? rect.bottom + GAP : rect.top - GAP
    const next = { booking, day, x, y, below }
    // Moving between chips inside 300ms shows the next card immediately.
    const immediate = Date.now() - lastHoverEnd.current < 300
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (immediate) { setHoverCard(next); return }
    hoverTimer.current = setTimeout(() => setHoverCard(next), 250)
  }
  function hideHover() {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
    lastHoverEnd.current = Date.now()
    setHoverCard(null)
  }
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) }, [])

  // work_order_id|date -> { eng, asst } for the visible range. Empty when a
  // booking predates the WO rebuild; the chip falls back to the projection names.
  const [staffByDay, setStaffByDay] = useState<Record<string, { eng?: string; asst?: string }>>({})

  const load = useCallback(async () => {
    const buf = BUFFER_WEEKS * 7
    const total = totalDays + buf * 2
    const renderStart = addDays(startDate, -buf)
    const end = addDays(renderStart, total - 1)
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .lte('start_date', fmt(end))
      .gte('end_date', fmt(renderStart))
    setBookings(data ?? [])

    // ── Per-day staffing (F-9 / Option B) ──────────────────────────────────
    // §10 BEHAVIOURAL EXCEPTION, Eli-approved, DISPLAY ONLY.
    //
    // A `bookings` row is a projection card and the projection deliberately FOLDS
    // every studio-time row's staff into one card — so a Mon–Wed run with LR on
    // Monday and JC on Tuesday stores both names, and the chip showed both on
    // every day. Per-day truth lives in `studio_time_rows` (the WO is source of
    // truth), so this is a display problem and gets a display-layer fix.
    //
    // Option A (splitting the run in projectBookingCards) was REJECTED: it edits
    // the atomic WO save path and rewrites booking data to correct a label, and
    // WO regressions are the standing top hazard on this project.
    //
    // ONE batched read for the whole visible range — never per-chip queries.
    const woIds = Array.from(new Set((data ?? []).map((b: any) => b.work_order_id).filter(Boolean)))
    if (woIds.length) {
      const { data: stRows } = await supabase
        .from('studio_time_rows')
        .select('work_order_id, date, eng_name, eng_role')
        .in('work_order_id', woIds)
      const map: Record<string, { eng?: string; asst?: string }> = {}
      for (const r of stRows ?? []) {
        const name = (r as any).eng_name
        if (!name || !(r as any).date) continue
        const key = `${(r as any).work_order_id}|${(r as any).date}`
        const slot = (r as any).eng_role === 'engineer' ? 'eng' : 'asst'
        map[key] = { ...(map[key] || {}), [slot]: name }
      }
      setStaffByDay(map)
    } else {
      setStaffByDay({})
    }
  }, [startDate, view])

  useEffect(() => { load() }, [load])

  // On mobile, default to Day view (all rooms as rows, vertically scrollable).
  // Fires once when the breakpoint resolves to mobile; only overrides the initial
  // 'grid' default, never a view the user has since chosen.
  const didSetMobileDefaultView = useRef(false)
  useEffect(() => {
    if (isMobile && !didSetMobileDefaultView.current && view === 'grid') {
      didSetMobileDefaultView.current = true
      setView('day')
    }
  }, [isMobile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep loadRef current so the subscription callback always calls the latest load
  // (load changes identity when startDate/view changes from navigation)
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  // Subscribe to bookings — re-render calendar blocks on any insert/update/delete
  useEffect(() => {
    const channel = supabase
      .channel('calendar-bookings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        loadRef.current()
      })
      .subscribe()
    // Staffing edits land on studio_time_rows, not bookings — without this the
    // per-day names would go stale until something else touched a booking.
    const stChannel = supabase
      .channel('calendar-studio-time-rows')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_time_rows' }, () => {
        loadRef.current()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel); supabase.removeChannel(stChannel) }
  }, [])

  // Restore collapse state on mount (client only — must be useEffect to avoid SSR hydration mismatch)
  useEffect(() => {
    try { const s = localStorage.getItem('cal_collapsed_locs'); if (s) setCollapsed(new Set(JSON.parse(s))) } catch {}
    try { const s = localStorage.getItem('cal_collapsed_rooms'); if (s) setCollapsedRooms(new Set(JSON.parse(s))) } catch {}
  }, [])

  // Persist collapse state — skip the very first render so the restore above isn't immediately overwritten
  const skipFirstCollapsed = useRef(true)
  const skipFirstRooms = useRef(true)
  useEffect(() => {
    if (skipFirstCollapsed.current) { skipFirstCollapsed.current = false; return }
    try { localStorage.setItem('cal_collapsed_locs', JSON.stringify(Array.from(collapsed))) } catch {}
  }, [collapsed])
  useEffect(() => {
    if (skipFirstRooms.current) { skipFirstRooms.current = false; return }
    try { localStorage.setItem('cal_collapsed_rooms', JSON.stringify(Array.from(collapsedRooms))) } catch {}
  }, [collapsedRooms])

  // Synchronous initial measurement — fires before useEffect so colW is correct when scroll effect runs
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const { height, width } = el.getBoundingClientRect()
    if (height > 0) setGridH(height)
    if (width > 0) setGridW(width)
  }, [])

  // Ongoing resize tracking
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    let pendingRaf = 0
    const ro = new ResizeObserver(([e]) => {
      cancelAnimationFrame(pendingRaf)
      const { height, width } = e.contentRect
      pendingRaf = requestAnimationFrame(() => {
        if (height > 0) setGridH(height)
        if (width > 0) setGridW(width)
      })
    })
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(pendingRaf) }
  }, [])

  // Zoom: keyboard (+/-/0) and Cmd+trackpad scroll
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setRowMode('card') }
      if (e.key === '-') { e.preventDefault(); setRowMode('rooms') }
      if (e.key === '0') { e.preventDefault(); setRowMode('rooms') }
      // [ / ] — the horizontal twin of - / +, for anyone without a trackpad.
      if (e.key === '[') { e.preventDefault(); setColZoom(w => clampColZoom(w - COL_ZOOM_STEP)) }
      if (e.key === ']') { e.preventDefault(); setColZoom(w => clampColZoom(w + COL_ZOOM_STEP)) }
    }
    function onWheel(e: WheelEvent) {
      // TRACKPAD PINCH. A pinch gesture arrives as a wheel event with ctrlKey
      // set — that's how browsers report it, and it's the same signal the page's
      // own zoom listens for, so preventDefault is required or the whole page
      // scales instead of the calendar. Continuous, not stepped: pinch is an
      // analogue gesture and stepping it feels broken.
      if (e.ctrlKey) {
        e.preventDefault()
        // Multiplicative so the gesture feels the same at every density —
        // a fixed px delta crawls when columns are wide and lurches when narrow.
        setColZoom(w => clampColZoom(Math.round(w * (1 - e.deltaY * 0.012))))
        return
      }
      if (!e.metaKey) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelStep.current < 200) return
      lastWheelStep.current = now
      setRowMode(e.deltaY > 0 ? 'rooms' : 'card')
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  // ZOOM ANCHORING. Changing the column width changes the whole content width,
  // so a fixed scrollLeft would land on a different date every pinch step and the
  // grid would appear to fly sideways while you zoom. Scaling scrollLeft by the
  // same ratio as the column keeps the leftmost visible day put.
  // Runs BEFORE paint (layout effect), so the corrected position is never drawn.
  const prevColW = useRef(colW)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el || prevColW.current === colW || prevColW.current <= 0) { prevColW.current = colW; return }
    const ratio = colW / prevColW.current
    prevColW.current = colW
    const next = el.scrollLeft * ratio
    el.scrollLeft = next
    setScrollX(next)
  }, [colW])

  // Scroll to put startDate (Sunday) at the left edge whenever startDate/view changes
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    if (scrollCorrectionRef.current !== null) {
      // Infinite-scroll correction: consume stored target, don't block handler
      shiftingRef.current = false
      const target = scrollCorrectionRef.current
      scrollCorrectionRef.current = null
      el.scrollLeft = target
      // Infinite scroll re-anchors the grid: startDate moves, every chip's offset
      // is recomputed, and scrollLeft is corrected imperatively here. scrollX must
      // be re-synced in the SAME breath or it stays measured against the previous
      // origin — an error of 7*colW per shift that ACCUMULATES, which is what made
      // long-bar payloads drift off the chip and vanish. Any feature reading
      // scrollLeft inherits this bug unless it's fixed here.
      setScrollX(target)
      setViewportW(Math.max(0, el.clientWidth - labelW))
    } else {
      // View/date switch: block scroll handler until rAF sets the correct position,
      // preventing transitional scroll events (from content-width change) from
      // triggering infinite scroll with a stale scrollLeft value.
      shiftingRef.current = true
      const target = bufDays * colW
      requestAnimationFrame(() => {
        setScrollX(target)
        setViewportW(Math.max(0, (gridRef.current?.clientWidth ?? 0) - labelW))
        if (el) el.scrollLeft = target
        shiftingRef.current = false
      })
    }
  }, [startDate, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation, shared by the prev/next buttons and mobile swipe. One screenful
  // per press — which used to be "one week" or "one month" and now follows the
  // zoom, since there is no named window any more. totalDays is already a whole
  // number of weeks, so startDate stays a Sunday.
  function goPrev() { setStartDate(d => addDays(d, -totalDays)) }
  function goNext() { setStartDate(d => addDays(d, totalDays)) }

  function handleGridScroll() {
    if (!gridRef.current) return
    const el = gridRef.current

    // Long-bar readability: publish scrollLeft so each chip can slide its payload
    // to stay on screen. rAF-throttled and quantised to 4px — this re-renders
    // every visible chip, so it must not fire per scroll event.
    if (!scrollRaf.current) {
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null
        const el2 = gridRef.current
        if (!el2) return
        const next = el2.scrollLeft
        setScrollX(prev => (Math.abs(prev - next) > 4 ? next : prev))
        const vw = Math.max(0, el2.clientWidth - labelW)
        setViewportW(prev => (Math.abs(prev - vw) > 4 ? vw : prev))
      })
    }

    // Infinite extension: shift window when nearing edges
    if (bufDays > 0 && !shiftingRef.current) {
      const weekW = 7 * colW
      if (el.scrollLeft < weekW) {
        shiftingRef.current = true
        scrollCorrectionRef.current = el.scrollLeft + weekW
        setStartDate(d => addDays(d, -7))
        return
      } else if (el.scrollLeft > el.scrollWidth - el.clientWidth - weekW) {
        shiftingRef.current = true
        scrollCorrectionRef.current = el.scrollLeft - weekW
        setStartDate(d => addDays(d, 7))
        return
      }
    }
  }

  // Compute row height: fit-all (level 0) or fixed step
  const filteredLocations = locFilter === 'All'
    ? LOCATIONS
    : locFilter.includes('|')
      ? LOCATIONS.filter(l => l.name === locFilter.split('|')[0])
      : LOCATIONS.filter(l => l.name === locFilter)
  const DAY_HDR_H = 30
  const LOC_HDR_H = 29
  const COLLAPSED_ROOM_H = 22
  const expandedRoomCount = filteredLocations.reduce((s, l) => {
    if (collapsed.has(l.name)) return s
    return s + l.rooms.filter(r => !collapsedRooms.has(`${l.name}|${r}`)).length
  }, 0)
  const indivCollapsedCount = filteredLocations.reduce((s, l) => {
    if (collapsed.has(l.name)) return s
    return s + l.rooms.filter(r => collapsedRooms.has(`${l.name}|${r}`)).length
  }, 0)
  // NO FLOOR. The floor was CHIP_MIN_H, which is precisely why 'fit' never
  // looked different from the fixed step — it refused to go below one card's
  // height, so it never fit anything that didn't already fit. Squeezing is the
  // entire point of this mode; the card handles being short.
  const roomsRowH = Math.max(24, Math.floor(
    (gridH - DAY_HDR_H - filteredLocations.length * LOC_HDR_H - indivCollapsedCount * COLLAPSED_ROOM_H) / Math.max(1, expandedRoomCount)
  ))
  // Mobile uses a fixed comfortable row height (zoom is hidden) so single-lane
  // booking chips clear the 44px tap target; the grid scrolls vertically instead.
  const rowH = isMobile ? CHIP_MIN_H : (rowMode === 'rooms' ? roomsRowH : ROW_H_CARD)

  // (Step 8: the old cal_form_draft restore died with BookingForm.)

  // Auto-open booking form when navigated from Start Booking
  useEffect(() => {
    const clientId = searchParams.get('clientId')
    const leadId = searchParams.get('leadId')
    if (!searchParams.get('newBooking') || !clientId) return
    router.replace('/calendar')
    const clientQ = supabase.from('clients').select('id,type,name,fname,lname,email,phone,artists').eq('id', clientId).single()
    const leadQ = leadId
      ? supabase.from('leads').select('quote,rate_daily,location,session_date,session_end_date,session_start,session_end,fname,lname,artist_name,email,phone,notes,staff_role,staff_name').eq('id', parseInt(leadId, 10)).single()
      : Promise.resolve({ data: null as any, error: null })
    Promise.all([clientQ, leadQ]).then(([{ data: c }, { data: l }]) => {
      const initial = emptyForm()
      if (c) {
        const isBilling = c.type === 'label'
        initial.client_db_id = c.id
        initial.payment_type = isBilling ? 'billing' : 'COD'
        initial.client_name = isBilling
          ? `${c.fname || ''} ${c.lname || ''}`.trim()
          : c.name || `${c.fname || ''} ${c.lname || ''}`.trim()
        initial.label = isBilling ? (c.name || '') : ''
        initial.email = c.email || ''
        initial.phone = c.phone || ''
        if (!isBilling) initial.artist = (c.artists && c.artists.length > 0) ? c.artists[0] : ''
      }
      if (l) {
        if (l.session_date) {
          initial.start_date = l.session_date
          // A lead may carry a multi-day hold (client asked for a week). Seed the
          // session's end_date from it so the WO opens on the full range instead
          // of one day; guard against an end that isn't after the start.
          initial.end_date = l.session_end_date && l.session_end_date > l.session_date
            ? l.session_end_date
            : l.session_date
        }
        if (l.session_start) initial.from_time = l.session_start
        if (l.session_end) initial.to_time = l.session_end
        if (l.rate_daily) { initial.rate_daily = l.rate_daily; initial.rate_type = 'daily' }
        else if (l.quote) { initial.rate = l.quote; initial.rate_type = 'hourly' }
        if (l.location) {
          const loc = parseLocation(l.location)
          initial.location = loc.venue
          initial.studio = loc.studio
        }
        // A&R name + contact info stored on the lead for billing leads
        const anrName = `${l.fname || ''} ${l.lname || ''}`.trim()
        if (anrName && initial.payment_type === 'billing') {
          initial.ordered_by = anrName
          initial.client_name = anrName
        }
        if (l.email && initial.payment_type === 'billing') initial.email = l.email
        if (l.phone && initial.payment_type === 'billing') initial.phone = l.phone
        // Use the specific artist from the lead rather than the roster's first entry
        if (l.artist_name) initial.artist = l.artist_name
        if (l.notes) initial.notes = l.notes
        // Carry the lead's staffing decision onto the booking — the signal the WO
        // reads when it seeds every studio-time row's staff sub-row, so nobody
        // has to type an engineer or assistant onto each line by hand.
        // A name is optional; "engineer, TBD" seeds the role with a blank name.
        const mode = (l.staff_role as 'engineer' | 'assistant' | 'none' | null) || 'assistant'
        initial.staff_mode = mode
        if (mode === 'engineer') {
          initial.engineer_name = l.staff_name || ''
          initial.engineer_status = 'hold'
        } else if (mode === 'assistant') {
          initial.assistant_name = l.staff_name || ''
          initial.assistant_status = 'hold'
        }
      }
      // Create the session + WO from the lead prefill, then open the WO directly.
      // Remember the lead so the WO can mark it booked on save.
      setWoLeadId(leadId ? parseInt(leadId, 10) : null)
      createBookingAndOpenWO(initial)
    })
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open a blank booking form pre-filled with a room when navigated from the
  // dashboard empty-room cards: /calendar?newBooking=1&location=&studio=&date=
  // (the clientId-based newBooking flow above handles the Start Booking path).
  useEffect(() => {
    if (!searchParams.get('newBooking') || searchParams.get('clientId')) return
    const location = searchParams.get('location') || undefined
    const studio = searchParams.get('studio') || undefined
    const date = searchParams.get('date') || undefined
    if (!location && !studio) return
    router.replace('/calendar')
    openNew(location, studio, date)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Empty-day / dashboard "new booking": create the session + WO and open the WO
  // directly (Step 6). No BookingForm intermediary.
  function openNew(location?: string, studio?: string, date?: string) {
    setWoLeadId(null)
    createBookingAndOpenWO({ location, studio, start_date: date, end_date: date })
  }

  // Delete a session opened as a WO — removes the WO + its line items, then ALL
  // of its booking cards. Shared helper (lib/deleteSession.ts) — the dashboard's
  // WO popup uses the same one.
  async function deleteSessionFromWO(b: Booking) {
    await deleteSessionAndWO(b)
    setWoBooking(null)
    await load()
  }

  // Step 8: EVERYTHING opens the Work Order view — sessions, blocks with WOs,
  // and legacy WO-less blocks (WorkOrderPopup renders its simple block editor
  // for those without creating a WO). BookingForm is gone.
  function openEdit(b: Booking) {
    // Opening an existing session — no lead hand-off, and clear any stale one so
    // a previously-opened lead can't be marked booked by an unrelated save.
    setWoLeadId(null)
    setWoBooking(b)
  }

  function buildBookingPayload(data: FormData) {
    return {
      status: data.status,
      session_type: data.session_type,
      payment_type: data.payment_type,
      cod_method: data.cod_method || null,
      location: data.location,
      studio: data.studio,
      start_date: data.start_date,
      end_date: data.end_date,
      from_time: data.from_time || null,
      to_time: data.to_time || null,
      rate: data.rate || null,
      rate_daily: data.rate_daily || null,
      rate_type: data.rate_type === 'daily' ? 'day' : 'hour',
      invoice_num: data.invoice_num || null,
      client_id: data.client_db_id || null,
      client_name: data.client_name || null,
      artist: data.artist || null,
      label: data.label || null,
      ordered_by: data.ordered_by || null,
      phone: data.phone || null,
      email: data.email || null,
      po: data.po || null,
      producer: data.producer || null,
      food_budget: data.food_budget,
      food_amount: data.food_amount || null,
      staff_mode: data.staff_mode || 'assistant',
      engineer_name: data.engineer_name || null,
      engineer_rate: data.engineer_rate || null,
      engineer_status: data.engineer_status,
      assistant_name: data.assistant_name || null,
      assistant_status: data.assistant_status,
      notes: data.notes || null,
      is_srs: data.is_srs,
      // TODO: calculate srs_fee_amount from studio_time table once WO digitization is complete
      srs_fee_amount: null as number | null,
      anr_contact_id: data.anr_contact_id || null,
      anr_admin_contact_id: data.anr_admin_contact_id || null,
    }
  }

  // Step 6: create a booking from prefilled form data (lead Start Booking, etc.),
  // create its WO, then open the WO directly — no BookingForm in the middle.
  async function createBookingAndOpenWO(seed: Partial<FormData>) {
    const data = emptyForm(seed)
    const payload = buildBookingPayload(data)
    const { data: inserted, error } = await supabase.from('bookings').insert(payload).select('*').single()
    if (error || !inserted) {
      console.error('[CalendarPage] createBookingAndOpenWO insert error:', error)
      setWoWarning(`Could not create the session${error?.message ? ': ' + error.message : ''}.`)
      return
    }
    if (data.is_srs) await supabase.from('srs_log').insert({ booking_id: inserted.id, paid: false })
    const newBooking = { ...payload, id: inserted.id } as Booking
    if (bookingShouldHaveWorkOrder(newBooking)) {
      try { await createWorkOrderForBooking(newBooking) } catch (woErr: any) {
        console.error('[CalendarPage] WO creation failed for booking', inserted.id, woErr)
        setWoWarning(`Session saved, but its work order could not be created${woErr?.message ? ': ' + woErr.message : ''}.`)
      }
    }
    await load()
    setWoBooking(inserted as Booking)
  }


  function toggleCollapse(loc: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(loc) ? next.delete(loc) : next.add(loc)
      return next
    })
  }

  // ── 2-week / week grid ─────────────────────────────────────────────────────

  function renderGrid() {
    const DAYS = totalRenderDays
    // Bounds of the actually-rendered grid window. `load` fetches a wider ±buffer
    // range than mobile renders (bufDays=0 on mobile), so bookings outside this
    // window must be excluded — otherwise off-window blocks clamp to left=0 /
    // width≤0 and render as slivers stuck against the left edge. On desktop the
    // rendered window equals the fetched range, so this filter is a no-op there.
    const winStart = fmt(gridRenderStart)
    const winEnd = fmt(addDays(gridRenderStart, DAYS - 1))

    // ── MONTH RAIL (§10b) ────────────────────────────────────────────────────
    // Segments are derived from `days` — the exact array the header and grid
    // render from, which is itself rebuilt from gridRenderStart on every
    // infinite-scroll re-anchor. That is deliberate: the scrollX desync bug
    // (O-10) happened because a feature derived a position from scrollLeft,
    // which survives a re-anchor while the grid's origin moves underneath it.
    // O-10 is the long-bar payload incident — three failed attempts at sliding
    // the payload with the scroll position, written up in docs/PROJECT_LOG.md;
    // search the log for O-10 before reworking anything on this axis.
    // Anything measured in DAYS re-renders correctly for free; anything measured
    // in scroll pixels does not. Do not "optimise" this into a scroll listener.
    const monthSegs: { key: string; label: string; count: number; alt: boolean }[] = []
    days.forEach(d => {
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const last = monthSegs[monthSegs.length - 1]
      if (last && last.key === key) { last.count++; return }
      monthSegs.push({
        key,
        label: `${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getFullYear()}`,
        count: 1,
        // Parity of the absolute month number, not of the array index — index
        // parity flips every time the window re-anchors across a boundary, which
        // would make the tint blink as you scroll.
        alt: (d.getFullYear() * 12 + d.getMonth()) % 2 === 1,
      })
    })
    const monthTint = (d: Date) =>
      (d.getFullYear() * 12 + d.getMonth()) % 2 === 1 ? 'var(--c-month-tint)' : 'transparent'
    return (
      <div
        ref={gridRef}
        onScroll={handleGridScroll}
        style={{ flex: 1, overflow: 'auto', minHeight: 0, borderRadius: 6, WebkitOverflowScrolling: 'touch' }}
      >
        <div style={{ minWidth: labelW + DAYS * colW }}>
        {/* MONTH RAIL — one segment per month, each exactly as wide as its days.
            The name is position:sticky inside its own segment, so it pins to the
            viewport's left edge while any of that month's days are visible and
            is then pushed out by the next segment: the contact-list header
            mechanic. Offset by labelW the same way the day ticks are. */}
        <div style={{
          display: 'flex', position: 'sticky', top: 0, zIndex: 12,
          height: MONTH_RAIL_H, background: 'var(--c-bg)',
        }}>
          {/* Spacer under the sticky room-label column, so the rail starts where
              the grid starts rather than under the labels. */}
          <div style={{
            width: labelW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 13,
            background: 'var(--c-bg)',
          }} />
          {monthSegs.map(m => (
            <div
              key={m.key}
              style={{
                width: m.count * colW, flexShrink: 0, display: 'flex', alignItems: 'center',
                background: m.alt ? 'var(--c-month-tint)' : 'transparent',
                boxShadow: 'inset -2px 0 0 var(--c-grid-tick-strong)',
                // NO `overflow: hidden` HERE. An ancestor with a clipping
                // overflow becomes the scroll container for a sticky descendant,
                // and since this box doesn't scroll, the name gets zero sticky
                // range and just scrolls away — which is exactly what happened.
                // (Same trap as the long-bar chip payload: chips clip, so CSS
                // sticky could never have worked there either.)
                // Clipping isn't needed anyway: a sticky element is already
                // clamped to its containing block, so the name stops at this
                // segment's right edge on its own. That IS the push-out.
                position: 'relative',
              }}
            >
              <span
                className="c-monthname"
                // `left` is the label column: the rail scrolls under it, so
                // pinning at 0 would park month names beneath the room labels.
                style={{ position: 'sticky', left: labelW + 8 }}
              >
                {m.label}
              </span>
            </div>
          ))}
        </div>

        {/* Day header row */}
        <div style={{
          display: 'flex', position: 'sticky', top: MONTH_RAIL_H, zIndex: 10,
          background: 'var(--c-bg)', }}>
          {/* Empty corner. It used to print the month abbreviation; the month
              rail above is the single authority on month position now, so that
              was redundant chrome saying the same thing twice. */}
          <div style={{ width: labelW, flexShrink: 0, position: 'sticky', left: 0, zIndex: 11, background: 'var(--c-bg)' }} />
          {days.map((d, i) => {
            const todayFlag = isToday(d)
            const wknd = isWeekend(d)
            const isMonthStart = d.getDate() === 1
            const isWeekStart = d.getDay() === 1 && i > 0
            // inset box-shadow draws a left-edge stripe without affecting layout
            const shadow = isMonthStart
              ? 'inset 2px 0 0 var(--c-fg)'
              : isWeekStart ? 'inset 2px 0 0 rgba(255,255,255,0.35)' : 'none'
            return (
              <div key={fmt(d)} style={{
                flex: 1, minWidth: colW, textAlign: 'center', padding: '2px 2px',
                background: wknd ? 'rgba(255,255,255,0.015)' : monthTint(d),
                boxShadow: shadow,
                position: 'relative',
              }}>
                {isMonthStart && (
                  <div style={{
                    position: 'absolute', top: 2, left: 5,
                    fontSize: 6, fontFamily: 'Inter', color: 'var(--c-fg)',
                    letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
                  }}>
                    {d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                  </div>
                )}
                <div style={{
                  fontSize: isMobile ? 9 : 8, fontFamily: 'Inter', color: 'var(--c-fg-3)',
                  letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1.2,
                }}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', margin: '2px auto 0',
                  background: todayFlag ? 'var(--c-fg)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontFamily: 'Inter', fontWeight: todayFlag ? 700 : 400,
                  color: todayFlag ? 'var(--c-bg)' : wknd ? 'var(--c-fg-2)' : 'var(--c-fg)',
                }}>
                  {d.getDate()}
                </div>
              </div>
            )
          })}
        </div>

        {/* Location sections */}
        {filteredLocations.map(loc => (
          <div key={loc.name}>
            {/* Location header — collapsible */}
            <div className="c-calloc">
              {/* Sticky label cell — always visible in the left column */}
              <div
                onClick={() => toggleCollapse(loc.name)}
                style={{
                  width: labelW, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                  cursor: 'pointer', userSelect: 'none',
                  position: 'sticky', left: 0, zIndex: 6,
                }}
              >
                <span style={{
                  fontSize: 8, fontFamily: 'Inter', color: 'var(--c-fg-3)',
                  display: 'inline-block', transition: 'transform 0.15s', flexShrink: 0,
                  transform: collapsed.has(loc.name) ? 'rotate(-90deg)' : 'rotate(0deg)',
                }}>▼</span>
                <span style={{
                  fontSize: 10, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400,
                  color: 'var(--c-fg-2)', letterSpacing: '0.06em', textTransform: 'uppercase',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{isMobile ? (LOCATION_CODES[loc.name] ?? loc.name) : loc.name}</span>
              </div>
              {/* Separator band fills the rest of the row */}
              <div onClick={() => toggleCollapse(loc.name)} style={{ flex: 1, cursor: 'pointer' }} />
            </div>

            {/* Room rows */}
            {!collapsed.has(loc.name) && loc.rooms.map((room, roomIdx) => {
              const roomKey = `${loc.name}|${room}`
              const isRoomCollapsed = collapsedRooms.has(roomKey)
              const roomBookings = bookings.filter(b =>
                b.location === loc.name && b.studio === room &&
                b.start_date <= winEnd && b.end_date >= winStart
              )
              const laneMap = assignLanes(roomBookings)
              // ROW HEIGHT IS FIXED. Growing the row to fit stacked sessions was
              // tried and rejected: a doubled row is permanent visual damage to
              // the grid's rhythm, paid every day of the year, to solve something
              // that happens occasionally and never exceeds three. Stacked cards
              // share the normal cell and shed content instead — see the tier
              // ladder in BookingBlock.
              const roomRowH = isRoomCollapsed ? COLLAPSED_ROOM_H : rowH
              return (
                <div key={room} className={roomIdx % 2 === 0 ? 'c-calrow c-calrow-alt' : 'c-calrow'} style={{
                  display: 'flex',
                  height: roomRowH,
                  // Three background layers, all offset by the label column so the
                  // grid's ink starts where the grid does:
                  //   1. the row's bottom line (was a border-bottom, which ran
                  //      through the label column — see .c-calrow in globals.css)
                  //   2. heavy tick every 7th column (week boundary)
                  //   3. light tick every column
                  backgroundImage: `linear-gradient(var(--c-grid-line), var(--c-grid-line)), repeating-linear-gradient(to right, var(--c-grid-tick-strong) 0 1px, transparent 1px ${colW * 7}px), repeating-linear-gradient(to right, var(--c-grid-tick) 0 1px, transparent 1px ${colW}px)`,
                  backgroundPosition: `${labelW}px bottom, ${labelW}px 0, ${labelW}px 0`,
                  backgroundSize: '100% 1px, auto, auto',
                  backgroundRepeat: 'repeat-x',
                }}>
                  {/* Room label — click to collapse/expand. On mobile the column is
                      only 80px, so trim padding/gap so "Studio A" fits without truncating. */}
                  <div
                    onClick={() => setCollapsedRooms(prev => {
                      const next = new Set(prev)
                      next.has(roomKey) ? next.delete(roomKey) : next.add(roomKey)
                      return next
                    })}
                    style={{
                      width: labelW, flexShrink: 0, display: 'flex', alignItems: 'center', gap: isMobile ? 3 : 5,
                      padding: isMobile ? '0 6px' : '0 12px', fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)',
                      cursor: 'pointer', userSelect: 'none',
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      position: 'sticky', left: 0, zIndex: 5, background: 'var(--c-bg)',
                    }}
                  >
                    <span style={{
                      fontSize: 7, color: 'var(--c-fg-3)', flexShrink: 0,
                      display: 'inline-block', transition: 'transform 0.15s',
                      transform: isRoomCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}>▼</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{room}</span>
                  </div>

                  {/* Booking area — hidden when room is collapsed */}
                  {!isRoomCollapsed && (
                    <div style={{ flex: 1, position: 'relative' }}>
                      {/* Day cell backgrounds + dbl-click zones */}
                      {days.map((d, i) => {
                        const cellIsMonthStart = d.getDate() === 1
                        const cellIsWeekStart = d.getDay() === 1 && i > 0
                        return (
                          <div
                            key={i}
                            onDoubleClick={() => openNew(loc.name, room, fmt(d))}
                            style={{
                              position: 'absolute', top: 0, bottom: 0,
                              left: `${(i / DAYS) * 100}%`, width: `${(1 / DAYS) * 100}%`,
                              background: isWeekend(d) ? 'rgba(255,255,255,0.012)' : monthTint(d),
                              boxShadow: cellIsMonthStart
                                ? 'inset 2px 0 0 var(--c-wash2)'
                                : cellIsWeekStart ? 'inset 2px 0 0 rgba(255,255,255,0.12)' : 'none',
                              cursor: 'crosshair',
                            }}
                          />
                        )
                      })}

                      {/* Booking blocks */}
                      {roomBookings.map(b => {
                        const { lane, numLanes } = laneMap.get(b.id) ?? { lane: 0, numLanes: 1 }
                        return (
                          <BookingBlock
                            key={b.id} booking={b}
                            gridStart={gridRenderStart} totalDays={DAYS}
                            lane={lane} numLanes={numLanes} rowH={roomRowH}
                            onClick={() => openEdit(b)}
                            isMobile={isMobile}
                            staffByDay={staffByDay}
                            onHover={showHover}
                            onHoverEnd={hideHover}
                            colW={colW}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        </div>{/* end inner min-width wrapper */}
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // maxHeight, not height: the fixed height dated from the top-nav frame and
  // forced the grid to stretch past its last row, leaving a black slab of dead
  // ground below TRACK. Cap = fills tall content, hugs short content.
  // (44px ≈ the rail-era page-main padding.)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 44px)', overflow: 'hidden' }}>

      {/* Work-order creation warning — booking saved, but its WO failed to create (non-blocking) */}
      {woWarning && (
        <div style={{
          flexShrink: 0, marginBottom: 12, padding: '10px 14px', borderRadius: 8,
          background: 'rgba(240,78,122,0.10)', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 12,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <span>{woWarning}</span>
          <button
            onClick={() => setWoWarning(null)}
            style={{ background: 'none', color: 'var(--c-fg-2)', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}
          >×</button>
        </div>
      )}

      {/* Top bar */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: 10, paddingBottom: 12,
        flexShrink: 0, flexWrap: isMobile ? 'nowrap' : 'wrap',
      }}>
        {/* Row 1 on mobile: date range + prev/today/next. `display: contents` on
            desktop keeps these as direct flex children so the desktop bar is
            byte-identical; on mobile they group into their own flex row. */}
        <div style={isMobile
          ? { display: 'flex', alignItems: 'center', gap: 8 }
          : { display: 'contents' }}>
        {/* Prev / Today / Next */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={goPrev}
            style={{ background: 'var(--c-wash)', color: 'var(--c-fg)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >‹</button>
          <button
            onClick={() => {
              const t = new Date()
              if (view === 'day') {
                setDayViewDate(t)
              } else {
                const thisSunday = getSunday(t)
                if (fmt(startDate) === fmt(thisSunday)) {
                  // Already on this week — force scroll reset
                  const el = gridRef.current
                  if (el) el.scrollLeft = bufDays * colW
                } else {
                  setStartDate(thisSunday)
                }
              }
            }}
            style={{ background: 'var(--c-wash)', color: 'var(--c-fg-2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'Inter', cursor: 'pointer' }}
          >Today</button>
          <button
            onClick={goNext}
            style={{ background: 'var(--c-wash)', color: 'var(--c-fg)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >›</button>
        </div>

        {/* Range label — on mobile a transparent native date input is overlaid
            directly over the text, so a tap lands on the input itself (iOS Safari
            won't open a picker from a programmatic .click()). Picking a date jumps
            to that date's week. Desktop is plain text (no picker), unchanged. */}
        {isMobile ? (
          <div style={{ flex: 1, position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <span style={{
              fontSize: 14, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, color: 'var(--c-fg)',
              textDecoration: 'underline', textDecorationColor: 'var(--c-fg-3)', textUnderlineOffset: 3,
              cursor: 'pointer',
            }}>
              {rangeLabel(startDate, totalDays)}
            </span>
            <input
              type="date"
              value={fmt(startDate)}
              onChange={e => {
                const v = e.target.value
                if (!v) return
                const picked = parse(v)
                setStartDate(getSunday(picked))
                setDayViewDate(picked)
              }}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, padding: 0, margin: 0, background: 'transparent', cursor: 'pointer' }}
            />
          </div>
        ) : (
          <div style={{ flex: 1, fontSize: 14, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, color: 'var(--c-fg)' }}>
            {rangeLabel(startDate, totalDays)}
          </div>
        )}
        </div>{/* end mobile row 1 */}

        {/* Row 2 on mobile: location filter + view toggles (+ zoom, hidden on
            mobile). `display: contents` on desktop preserves the original bar. */}
        <div style={isMobile
          ? { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
          : { display: 'contents' }}>

        {/* "All" pill — only shown when a specific studio is selected */}
        {locFilter.includes('|') && (
          <button
            onClick={() => { setLocFilter('All'); setView('grid') }}
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 10, fontFamily: 'Inter',
              fontWeight: 700, cursor: 'pointer', background: 'var(--c-wash)', color: 'var(--c-fg-2)',
              letterSpacing: '0.04em',
            }}
          >All</button>
        )}

        {/* Location filter */}
        <select
          value={locFilter}
          onChange={e => {
            const val = e.target.value
            setLocFilter(val)
            if (val.includes('|')) setView('studio')
            else if (view === 'studio') setView('day')
          }}
          style={{
            background: locFilter.includes('|') ? 'var(--c-wash2)' : 'var(--c-wash)',
            color: locFilter.includes('|') ? 'var(--c-fg)' : 'var(--c-fg-2)',
            borderRadius: 4, padding: '4px 10px',
            fontSize: 10, fontFamily: 'Inter', cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="All">All Locations</option>
          {LOCATIONS.map(l => (
            <optgroup key={l.name} label={l.name}>
              <option value={l.name}>All {l.name}</option>
              {l.rooms.map(room => (
                <option key={room} value={`${l.name}|${room}`}>{room}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* View switcher */}
        <div style={{
          display: 'flex', background: 'var(--c-wash)',
          borderRadius: 6, overflow: 'hidden',
        }}>
          {(['day', 'grid'] as ViewType[]).map(v => (
            <button key={v} onClick={() => {
              const today = new Date()
              const thisSunday = getSunday(today)
              if (v === 'day') setDayViewDate(today)
              const alreadyHere = view === v && fmt(startDate) === fmt(thisSunday)
              setStartDate(thisSunday)
              setView(v)
              // If state won't change, force scroll directly (React won't re-run the effect)
              if (alreadyHere) {
                const el = gridRef.current
                if (el) el.scrollLeft = bufDays * colW
              }
            }} style={{
              padding: '4px 12px', fontSize: 10, fontFamily: 'Inter',
              cursor: 'pointer', background: view === v ? 'var(--c-wash2)' : 'transparent',
              color: view === v ? 'var(--c-fg)' : 'var(--c-fg-2)',
              fontWeight: view === v ? 700 : 400,
            }}>
              {v === 'grid' ? 'Grid' : 'Day'}
            </button>
          ))}
        </div>

        {/* HORIZONTAL zoom — days across. The pinch gesture's visible twin, so
            the feature is discoverable without knowing the gesture exists.
            Hidden in Day view, which has no columns to spread. */}
        <div style={{ display: isMobile || view !== 'grid' ? 'none' : 'flex', alignItems: 'center', background: 'var(--c-wash)', borderRadius: 6, overflow: 'hidden' }}>
          <button
            onClick={() => setColZoom(w => clampColZoom(w - COL_ZOOM_STEP))}
            title="Show more days (pinch in, or [)"
            style={{ padding: '4px 9px', fontSize: 14, lineHeight: 1, background: 'transparent', color: colZoom <= COL_ZOOM_MIN ? 'var(--c-fg-3)' : 'var(--c-fg)', cursor: colZoom <= COL_ZOOM_MIN ? 'default' : 'pointer' }}
          >−</button>
          <span
            onClick={() => setColZoom(COL_ZOOM_DEFAULT)}
            title="Reset density"
            style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--c-fg-2)', minWidth: 30, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
          >{visibleDays}d</span>
          <button
            onClick={() => setColZoom(w => clampColZoom(w + COL_ZOOM_STEP))}
            title="Show fewer, wider days (pinch out, or ])"
            style={{ padding: '4px 9px', fontSize: 14, lineHeight: 1, background: 'transparent', color: colZoom >= COL_ZOOM_MAX ? 'var(--c-fg-3)' : 'var(--c-fg)', cursor: colZoom >= COL_ZOOM_MAX ? 'default' : 'pointer' }}
          >+</button>
        </div>

        {/* VERTICAL — two modes. See ROW_H_CARD / RowMode for why this stopped
            being a five-step ladder. */}
        <div style={{ display: isMobile || view !== 'grid' ? 'none' : 'flex', alignItems: 'center', background: 'var(--c-wash)', borderRadius: 6, overflow: 'hidden' }}>
          {([['card', 'Card'], ['rooms', 'All rooms']] as [RowMode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setRowMode(m)}
              title={m === 'card' ? 'Full-height cards (+)' : 'Squeeze every room onto one screen (−)'}
              style={{
                padding: '4px 10px', fontSize: 9, fontFamily: 'Inter',
                background: rowMode === m ? 'var(--c-wash2)' : 'transparent',
                color: rowMode === m ? 'var(--c-fg)' : 'var(--c-fg-2)',
                fontWeight: rowMode === m ? 700 : 400, cursor: 'pointer',
              }}
            >{label}</button>
          ))}
        </div>
        </div>{/* end mobile row 2 */}

        {/* New booking — full-width lime button below the controls on mobile */}
        <button
          onClick={() => openNew()}
          style={{
            padding: isMobile ? '12px 16px' : '6px 16px',
            borderRadius: isMobile ? 8 : 4,
            fontSize: isMobile ? 13 : 11, fontFamily: 'Inter',
            fontWeight: 700, cursor: 'pointer',
            background: 'var(--c-fg)',
            color: 'var(--c-bg)',
            width: isMobile ? '100%' : undefined,
            minHeight: isMobile ? 44 : undefined,
            letterSpacing: isMobile ? '0.04em' : undefined,
          }}
        >+ New Booking</button>
      </div>

      {/* Calendar content */}
      {view === 'grid' && renderGrid()}

      {view === 'day' && (
        <DayView
          dayViewDate={dayViewDate}
          setDayViewDate={setDayViewDate}
          locFilter={locFilter}
          onOpenEdit={openEdit}
          reloadKey={reloadKey}
          isMobile={isMobile}
        />
      )}

      {view === 'studio' && (
        <StudioView
          locFilter={locFilter}
          onOpenEdit={openEdit}
          onOpenNew={openNew}
          reloadKey={reloadKey}
        />
      )}

      {/* ── Hover card (F-11) ────────────────────────────────────────────────
          Glanceable summary for anyone near a screen, so deliberately NO
          financial data — no rate, quote or invoice number. Staffing follows the
          day column under the cursor via the Option B map. Fixed-positioned and
          pointer-events:none so it can never be clipped by the calendar's
          overflow, and can never intercept the click that opens the WO. */}
      {hoverCard && (() => {
        const b = hoverCard.booking
        const bill = b.payment_type === 'billing'
        const artist = bill ? (b.artist || b.label || b.client_name || '—') : (b.client_name || '—')
        const client = bill && b.label && b.label !== artist ? b.label : (bill ? '' : (b.artist || ''))
        const st = hoverCard.booking.work_order_id
          ? staffByDay[`${b.work_order_id}|${hoverCard.day}`]
          : undefined
        const engN = st?.eng ?? b.engineer_name
        const asstN = st?.asst ?? b.assistant_name
        const times = b.from_time ? `${fmtTime(b.from_time)}${b.to_time ? `–${fmtTime(b.to_time)}` : ''}` : ''
        const dates = b.start_date === b.end_date
          ? shortDate(b.start_date)
          : `${shortDate(b.start_date)} – ${shortDate(b.end_date)}`
        return (
          <div
            className="c-hovercard"
            style={{
              left: hoverCard.x,
              top: hoverCard.below ? hoverCard.y : undefined,
              bottom: hoverCard.below ? undefined : `calc(100vh - ${hoverCard.y}px)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="c-arch" style={{ fontSize: 15, letterSpacing: '-0.02em' }}>{artist}</span>
              <StatusPill status={STATUS_SLOT[b.status] ?? 'confirmed'} />
            </div>
            {client && <div className="c-sub" style={{ marginTop: 2 }}>{client}</div>}
            <div className="c-label" style={{ marginTop: 8 }}>{b.location} · {b.studio}</div>
            <div className="c-mono" style={{ fontSize: 11.5, opacity: .75, marginTop: 4 }}>
              {dates}{times ? ` · ${times}` : ''}
            </div>
            {(engN || asstN) && (
              <div className="c-mono" style={{ fontSize: 11.5, opacity: .75, marginTop: 3 }}>
                {[engN && `1ST ${engN}`, asstN && `2ND ${asstN}`].filter(Boolean).join('   ')}
              </div>
            )}
            {/* Identifiers (F-18/5). WO# and Invoice# are IDs, not amounts — the
                no-financials rule bars rates and totals, not identifiers. Both are
                already on the booking projection, so no extra query. */}
            {(b.wo_number || b.invoice_num) && (
              <div className="c-mono" style={{ fontSize: 11, opacity: .55, marginTop: 6 }}>
                {[b.wo_number && `WO ${b.wo_number}`, b.invoice_num && `INV ${b.invoice_num}`]
                  .filter(Boolean).join('   ')}
              </div>
            )}
            {/* Payment, COD only — same silence-means-billing rule as the card.
                The card already carries this; the hover repeats it with the full
                method spelled out rather than abbreviated. */}
            {!bill && (
              <div style={{ marginTop: 8 }}>
                <span className="c-pill c-pill-hot c-fill-hot">
                  {b.cod_method ? `COD · ${b.cod_method} — collect` : 'COD — collect'}
                </span>
              </div>
            )}
            <div className="c-hovercard-hint">Click to open WO</div>
          </div>
        )
      })()}

      {/* Work Order — opened directly from the calendar (Step 6; Step 8 made it
          the ONLY session/block editor — BookingForm deleted) */}
      {woBooking && (
        <WorkOrderPopup
          booking={woBooking}
          leadId={woLeadId}
          onClose={() => { setWoBooking(null); setWoLeadId(null); loadRef.current(); setReloadKey(k => k + 1) }}
          onSaved={() => { loadRef.current(); setReloadKey(k => k + 1) }}
          onDelete={() => deleteSessionFromWO(woBooking)}
        />
      )}
    </div>
  )
}
