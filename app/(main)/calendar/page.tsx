'use client'
import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { STUDIO_LOCATIONS, parseLocation } from '@/lib/studios'
import { BookingForm, type FormData, bookingToForm, emptyForm } from '@/components/calendar/BookingForm'

// ─── LOCATIONS ───────────────────────────────────────────────────────────────

const LOCATIONS = STUDIO_LOCATIONS

// ─── COLOR TOKENS ────────────────────────────────────────────────────────────

const STATUS_TOP_COLORS: Record<string, string> = {
  confirmed:  '#22c55e',
  tentative:  '#f97316',
  cancelled:  '#ef4444',
  tour:       '#a855f7',
  tech:       '#6b7280',
  open_hours: '#e2e8f0',
}

const COLOR_COD = '#7BBFFF'
const COLOR_LABEL = '#96A9FF'

// ─── LAYOUT CONSTANTS ────────────────────────────────────────────────────────

const LABEL_W = 148
const COL_W = 120  // minimum day-column width; forces horizontal scroll when cols × days > viewport
const ZOOM_FIXED = [60, 80, 88, 110, 132] // zoom levels 1–5; level 0 = fit-all (≈44px)
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

function initials(name: string | null): string {
  if (!name?.trim()) return ''
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
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

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  const d = new Date(s)
  while (d <= e) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1) }
  return dates
}

// ─── LANE ASSIGNMENT ─────────────────────────────────────────────────────────

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
  booking, gridStart, totalDays, lane, numLanes, rowH, onClick,
}: {
  booking: Booking; gridStart: Date; totalDays: number
  lane: number; numLanes: number; rowH: number; onClick: () => void
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

  const isBilling = booking.payment_type === 'billing'
  const nameColor = isBilling ? COLOR_LABEL : COLOR_COD
  const topColor = STATUS_TOP_COLORS[booking.status] ?? STATUS_TOP_COLORS.confirmed
  const sessionBorder = booking.session_type !== 'recording'

  // Line 1: artist (billing) or client name (COD)
  const primaryName = isBilling
    ? (booking.artist || booking.label || booking.client_name || '')
    : (booking.client_name || '')

  // Line 2: label name — billing only, only when label differs from primaryName
  const labelLine = isBilling && booking.label && booking.label !== primaryName
    ? booking.label : ''

  const timeStr = booking.from_time && booking.to_time
    ? `${fmtTime(booking.from_time)}–${fmtTime(booking.to_time)}`
    : booking.from_time ? fmtTime(booking.from_time) : ''

  const eng = initials(booking.engineer_name)
  const asst = initials(booking.assistant_name)
  const engColor = booking.engineer_status === 'confirmed' ? '#4ef0a2'
    : booking.engineer_status === 'hold' ? '#f0a24e'
    : 'rgba(255,255,255,0.4)'
  const asstColor = booking.assistant_status === 'confirmed' ? '#4ef0a2'
    : booking.assistant_status === 'hold' ? '#f0a24e'
    : 'rgba(255,255,255,0.4)'

  const slotH = rowH / numLanes
  const blockTop = lane * slotH + 2
  const blockHeight = slotH - 3
  const micro = blockHeight < 30
  const compact = !micro && blockHeight < 60
  const codLabel = booking.cod_method === 'Credit Card' ? 'CC' : (booking.cod_method ?? '').toUpperCase()

  return (
    <div
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        position: 'absolute', top: blockTop, height: blockHeight,
        left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)`,
        background: '#0d0f14', boxSizing: 'border-box',
        borderTop: `${micro ? 3 : 4}px solid ${topColor}`,
        borderLeft: sessionBorder ? '2px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
        borderRight: sessionBorder ? '2px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
        borderBottom: sessionBorder ? '2px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        padding: micro ? '1px 4px' : compact ? '3px 5px' : '4px 6px',
        cursor: 'pointer', overflow: 'hidden',
        display: 'flex', flexDirection: micro ? 'row' : 'column',
        alignItems: micro ? 'center' : undefined,
        justifyContent: micro ? 'flex-start' : 'space-between',
        gap: micro ? 4 : undefined,
        zIndex: 2, minWidth: 0,
      }}
    >
      {micro ? (
        <>
          <div style={{ color: nameColor, fontSize: 8, fontFamily: 'DM Serif Display', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', minWidth: 0 }}>
            {primaryName}
          </div>
          {timeStr && (
            <div style={{ fontSize: 7, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {timeStr}
            </div>
          )}
        </>
      ) : compact ? (
        <>
          {/* Row 1: name + inline COD badge + invoice# */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0, overflow: 'hidden' }}>
            <div style={{
              color: nameColor, fontSize: blockHeight >= 48 ? 12 : 10,
              fontFamily: 'DM Serif Display', lineHeight: 1.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              flex: '1 1 0', minWidth: 0,
            }}>
              {primaryName}
            </div>
            {!isBilling && codLabel && (
              <span style={{ fontSize: 7, fontFamily: 'DM Mono', fontWeight: 700, color: '#f87171', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>
                {codLabel}
              </span>
            )}
          </div>
          {/* Row 2: time + eng/asst */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', overflow: 'hidden' }}>
            <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
              {timeStr}
            </div>
            {(eng || asst) && (
              <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 4 }}>
                {eng  && <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: engColor, whiteSpace: 'nowrap' }}>1ST-{eng}</div>}
                {asst && <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: asstColor, whiteSpace: 'nowrap' }}>2ND-{asst}</div>}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{
            color: nameColor, fontSize: 13, fontFamily: 'DM Serif Display', lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {primaryName}
          </div>
          {labelLine && (
            <div style={{
              fontSize: 10, fontFamily: 'DM Mono', lineHeight: 1.2, marginTop: 1,
              color: 'rgba(255,255,255,0.45)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {labelLine}
            </div>
          )}
          {timeStr && (
            <div style={{ fontSize: 9, fontFamily: 'DM Mono', lineHeight: 1.2, marginTop: 2, color: 'rgba(255,255,255,0.85)' }}>
              {timeStr}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto' }}>
            <div>
              {!isBilling && booking.cod_method && (
                <div style={{ fontSize: 8, fontFamily: 'DM Mono', fontWeight: 700, lineHeight: 1.3, color: '#f87171' }}>
                  {booking.cod_method.toUpperCase()}
                </div>
              )}
            </div>
            {(eng || asst) && (
              <div style={{ textAlign: 'right' }}>
                {eng  && <div style={{ fontSize: 8, fontFamily: 'DM Mono', lineHeight: 1.3, color: engColor }}>1ST-{eng}</div>}
                {asst && <div style={{ fontSize: 8, fontFamily: 'DM Mono', lineHeight: 1.3, color: asstColor }}>2ND-{asst}</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}


// ─── DAY VIEW ────────────────────────────────────────────────────────────────

const DAY_STATUS_BG: Record<string, string> = {
  confirmed:  '#1e40af',
  tentative:  '#c2410c',
  cancelled:  '#b91c1c',
  tour:       '#6d28d9',
  tech:       '#374151',
  open_hours: '#111827',
}

function DayView({
  dayViewDate,
  setDayViewDate,
  locFilter,
  onOpenEdit,
  reloadKey,
}: {
  dayViewDate: Date
  setDayViewDate: (d: Date) => void
  locFilter: string
  onOpenEdit: (b: Booking) => void
  reloadKey: number
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

      {/* ── LEFT: mini month calendar ──────────────────────────────────── */}
      <div style={{
        width: 216, flexShrink: 0, overflowY: 'auto',
        background: 'var(--surface)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        padding: '16px 14px',
      }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button
            onClick={() => setMiniMonthStart(new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth() - 1, 1))}
            style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
          >‹</button>
          <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 12, color: 'var(--text)', letterSpacing: '0.04em' }}>
            {miniMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => setMiniMonthStart(new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth() + 1, 1))}
            style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
          >›</button>
        </div>

        {/* Weekday labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)', padding: '2px 0' }}>
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
                  fontSize: 11, fontFamily: 'DM Mono',
                  background: isSelected ? '#c8f04e' : isTodayCell ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: isSelected ? '#0d0f14' : 'var(--text2)',
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

      {/* ── RIGHT: date header + studio cards ─────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
            {dayViewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setDayViewDate(addDays(dayViewDate, -1))}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>‹</button>
            <button onClick={() => setDayViewDate(new Date())}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer' }}>Today</button>
            <button onClick={() => setDayViewDate(addDays(dayViewDate, 1))}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>›</button>
          </div>
        </div>

        {/* Studio cards grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {allStudios.map(({ loc, room }) => {
              const cards = dayBookings
                .filter(b => b.location === loc && b.studio === room)
                .sort((a, b) => timeToMins(a.from_time) - timeToMins(b.from_time))
              return (
                <div key={`${loc}|${room}`} style={{
                  background: 'var(--surface)', borderRadius: 6, overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  {/* Card header */}
                  <div style={{ padding: '6px 10px', background: 'var(--surface2)', borderBottom: cards.length > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                    <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 11, color: '#c8f04e', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {loc} {room}
                    </span>
                  </div>

                  {/* Booking blocks */}
                  {cards.map(b => {
                    const isBilling = b.payment_type === 'billing'
                    const nameColor = isBilling ? '#96A9FF' : '#7BBFFF'
                    const displayName = isBilling
                      ? (b.artist && b.label ? `${b.label} / ${b.artist}` : b.artist || b.label || b.client_name || '')
                      : (b.client_name || '')
                    const timeStr = b.from_time && b.to_time
                      ? `${fmtTime(b.from_time)}–${fmtTime(b.to_time)}`
                      : b.from_time ? fmtTime(b.from_time) : ''
                    const eng = b.engineer_name ? `1ST-${initials(b.engineer_name)}` : ''
                    const asst = b.assistant_name ? `2ND-${initials(b.assistant_name)}` : ''
                    const codLabel = !isBilling && b.cod_method ? `COD ${b.cod_method.toUpperCase()}` : null
                    const hasSessionBorder = b.session_type !== 'recording'

                    return (
                      <div key={b.id} onClick={() => onOpenEdit(b)} style={{
                        padding: '7px 10px', cursor: 'pointer',
                        background: '#0d0f14',
                        borderTop: `3px solid ${STATUS_TOP_COLORS[b.status] ?? STATUS_TOP_COLORS.confirmed}`,
                        borderLeft: hasSessionBorder ? '3px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
                        borderRight: '1px solid rgba(255,255,255,0.08)',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                      }}>
                        {/* Name */}
                        <div style={{ fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700, color: nameColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {displayName}
                        </div>
                        {/* Time */}
                        {timeStr && (
                          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                            {timeStr}
                          </div>
                        )}
                        {/* COD method */}
                        {codLabel && (
                          <div style={{ fontFamily: 'DM Mono', fontSize: 9, fontWeight: 700, color: '#f87171', marginTop: 2 }}>
                            {codLabel}
                          </div>
                        )}
                        {/* Notes */}
                        {b.notes && (
                          <div style={{ fontFamily: 'DM Mono', fontSize: 9, color: 'rgba(255,255,255,0.7)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {b.notes.toUpperCase()}
                          </div>
                        )}
                        {/* Invoice + engineer */}
                        {(b.invoice_num || eng || asst) && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                            <span style={{ fontFamily: 'DM Mono', fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
                              {b.invoice_num ? `#${b.invoice_num}` : ''}
                            </span>
                            <span style={{ fontFamily: 'DM Mono', fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
                              {[eng, asst].filter(Boolean).join(' ')}
                            </span>
                          </div>
                        )}
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
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
          <span style={{ color: '#c8f04e', textTransform: 'uppercase' }}>{loc} {room}</span>
          <span style={{ color: 'var(--text3)', margin: '0 8px' }}>—</span>
          {monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setMonthStart(new Date(year, month - 1, 1))}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >‹</button>
          <button
            onClick={() => { const t = new Date(); setMonthStart(new Date(t.getFullYear(), t.getMonth(), 1)) }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer' }}
          >Today</button>
          <button
            onClick={() => setMonthStart(new Date(year, month + 1, 1))}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >›</button>
        </div>
      </div>

      {/* Weekday labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{
            textAlign: 'center', padding: '5px 0',
            fontFamily: 'DM Mono', fontSize: 10, color: 'var(--text3)',
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
              borderRight: i % 7 < 6 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
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
                borderRight: i % 7 < 6 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                padding: '4px 5px',
                background: isTodayCell ? 'rgba(200,240,78,0.04)' : 'transparent',
              }}
            >
              {/* Date number */}
              <div style={{
                width: 22, height: 22, borderRadius: '50%', marginBottom: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isTodayCell ? '#c8f04e' : 'transparent',
                color: isTodayCell ? '#0d0f14' : 'var(--text3)',
                fontSize: 11, fontFamily: 'DM Mono', fontWeight: isTodayCell ? 700 : 400,
              }}>
                {cell.getDate()}
              </div>
              {/* Booking blocks */}
              {cellBookings.map(b => {
                const isBilling = b.payment_type === 'billing'
                const nameColor = isBilling ? '#96A9FF' : '#7BBFFF'
                const displayName = isBilling
                  ? (b.artist && b.label ? `${b.label} / ${b.artist}` : b.artist || b.label || b.client_name || '')
                  : (b.client_name || '')
                const timeStr = b.from_time && b.to_time
                  ? `${fmtTime(b.from_time)}–${fmtTime(b.to_time)}`
                  : b.from_time ? fmtTime(b.from_time) : ''
                const codLabel = !isBilling && b.cod_method
                  ? (b.cod_method === 'Credit Card' ? 'CC' : b.cod_method.toUpperCase())
                  : null
                const eng = b.engineer_name ? `1ST-${initials(b.engineer_name)}` : ''
                const asst = b.assistant_name ? `2ND-${initials(b.assistant_name)}` : ''
                const engColor = b.engineer_status === 'confirmed' ? '#4ef0a2'
                  : b.engineer_status === 'hold' ? '#f0a24e' : 'rgba(255,255,255,0.4)'
                const asstColor = b.assistant_status === 'confirmed' ? '#4ef0a2'
                  : b.assistant_status === 'hold' ? '#f0a24e' : 'rgba(255,255,255,0.4)'
                return (
                  <div
                    key={b.id}
                    onClick={e => { e.stopPropagation(); onOpenEdit(b) }}
                    style={{
                      marginBottom: 3, padding: '5px 7px', borderRadius: 3,
                      background: '#0d0f14',
                      cursor: 'pointer',
                      borderTop: `3px solid ${STATUS_TOP_COLORS[b.status] ?? STATUS_TOP_COLORS.confirmed}`,
                      borderLeft: b.session_type !== 'recording' ? '2px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
                      borderRight: '1px solid rgba(255,255,255,0.08)',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {/* Name */}
                    <div style={{ fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700, color: nameColor, wordBreak: 'break-word' }}>
                      {displayName}
                    </div>
                    {/* Time */}
                    {timeStr && (
                      <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                        {timeStr}
                      </div>
                    )}
                    {/* COD method + engineer/assistant row */}
                    {(codLabel || eng || asst) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                        <span style={{ fontFamily: 'DM Mono', fontSize: 9, fontWeight: 700, color: '#f87171' }}>
                          {codLabel ?? ''}
                        </span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {eng  && <span style={{ fontFamily: 'DM Mono', fontSize: 9, color: engColor }}>{eng}</span>}
                          {asst && <span style={{ fontFamily: 'DM Mono', fontSize: 9, color: asstColor }}>{asst}</span>}
                        </div>
                      </div>
                    )}
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

type ViewType = 'day' | 'studio' | 'week' | '2wks' | 'month'

export default function CalendarPage() {
  return <Suspense><CalendarPageInner /></Suspense>
}

function CalendarPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [view, setView] = useState<ViewType>('2wks')
  const [startDate, setStartDate] = useState(() => getSunday(new Date()))
  const [bookings, setBookings] = useState<Booking[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editBooking, setEditBooking] = useState<Booking | null>(null)
  const [formInitial, setFormInitial] = useState<FormData>(() => emptyForm())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(() => new Set())
  const [locFilter, setLocFilter] = useState('All')
  const [dayViewDate, setDayViewDate] = useState<Date>(() => new Date())
  const [reloadKey, setReloadKey] = useState(0)
  const [zoomLevel, setZoomLevel] = useState(0) // 0 = fit-all; 1–6 = ZOOM_FIXED steps
  const [gridH, setGridH] = useState(700)
  const [gridW, setGridW] = useState(1200)
  const gridRef = useRef<HTMLDivElement>(null)
  const lastWheelStep = useRef(0)
  const scrollCorrectionRef = useRef<number | null>(null)
  const shiftingRef = useRef(false)


  const totalDays = view === 'month'
    ? new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate()
    : view === 'week' ? 7 : 14
  const bufDays = BUFFER_WEEKS * 7  // same buffer for all grid views
  const totalRenderDays = totalDays + bufDays * 2
  const gridRenderStart = addDays(startDate, -bufDays)
  const days = Array.from({ length: totalRenderDays }, (_, i) => addDays(gridRenderStart, i))

  // Column width fills the viewport for the canonical window; month uses a smaller fixed size
  const usableW = Math.max(gridW - LABEL_W, 400)
  const colW = view === 'week'
    ? Math.max(80, Math.floor(usableW / 7))
    : view === '2wks'
    ? Math.max(60, Math.floor(usableW / 14))
    : Math.max(44, Math.floor(usableW / totalDays))

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
  }, [startDate, view])

  useEffect(() => { load() }, [load])

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
    return () => { supabase.removeChannel(channel) }
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
    const MAX = ZOOM_FIXED.length
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoomLevel(z => Math.min(z + 1, MAX)) }
      if (e.key === '-') { e.preventDefault(); setZoomLevel(z => Math.max(z - 1, 0)) }
      if (e.key === '0') { e.preventDefault(); setZoomLevel(0) }
    }
    function onWheel(e: WheelEvent) {
      if (!e.metaKey) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelStep.current < 200) return
      lastWheelStep.current = now
      if (e.deltaY > 0) setZoomLevel(z => Math.max(z - 1, 0))
      else if (e.deltaY < 0) setZoomLevel(z => Math.min(z + 1, MAX))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

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
    } else {
      // View/date switch: block scroll handler until rAF sets the correct position,
      // preventing transitional scroll events (from content-width change) from
      // triggering infinite scroll with a stale scrollLeft value.
      shiftingRef.current = true
      const target = bufDays * colW
      requestAnimationFrame(() => {
        if (el) el.scrollLeft = target
        shiftingRef.current = false
      })
    }
  }, [startDate, view]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleGridScroll() {
    if (!gridRef.current) return
    const el = gridRef.current

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
  const fitRowH = Math.max(20, Math.floor(
    (gridH - DAY_HDR_H - filteredLocations.length * LOC_HDR_H - indivCollapsedCount * COLLAPSED_ROOM_H) / Math.max(1, expandedRoomCount)
  ))
  const rowH = zoomLevel === 0 ? fitRowH : ZOOM_FIXED[zoomLevel - 1]

  // Restore booking form draft on mount (e.g. user navigated away mid-create)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('cal_form_draft')
      if (!raw) return
      const d = JSON.parse(raw) as { editBooking: Booking | null; formData: FormData }
      setEditBooking(d.editBooking)
      setFormInitial(d.formData)
      setFormOpen(true)
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open booking form when navigated from Start Booking
  useEffect(() => {
    const clientId = searchParams.get('clientId')
    const leadId = searchParams.get('leadId')
    if (!searchParams.get('newBooking') || !clientId) return
    router.replace('/calendar')
    const clientQ = supabase.from('clients').select('id,type,name,fname,lname,email,phone,artists').eq('id', clientId).single()
    const leadQ = leadId
      ? supabase.from('leads').select('quote,rate_daily,location,session_date,session_start,session_end,fname,lname,artist_name,email,phone,notes').eq('id', parseInt(leadId, 10)).single()
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
        if (l.session_date) { initial.start_date = l.session_date; initial.end_date = l.session_date }
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
      }
      setEditBooking(null)
      setFormInitial(initial)
      setFormOpen(true)
    })
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  function openNew(location?: string, studio?: string, date?: string) {
    const initial = emptyForm({ location, studio, start_date: date, end_date: date })
    setEditBooking(null)
    setFormInitial(initial)
    setFormOpen(true)
    try { sessionStorage.setItem('cal_form_draft', JSON.stringify({ editBooking: null, formData: initial })) } catch {}
  }

  function openEdit(b: Booking) {
    const initial = bookingToForm(b)
    setEditBooking(b)
    setFormInitial(initial)
    setFormOpen(true)
    try { sessionStorage.setItem('cal_form_draft', JSON.stringify({ editBooking: b, formData: initial })) } catch {}
  }

  async function handleSave(data: FormData) {
    const payload = {
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
      engineer_name: data.engineer_name || null,
      engineer_rate: data.engineer_rate || null,
      engineer_status: data.engineer_status,
      assistant_name: data.assistant_name || null,
      assistant_status: data.assistant_status,
      notes: data.notes || null,
      is_srs: data.is_srs,
      // TODO: calculate srs_fee_amount from studio_time table once WO digitization is complete
      srs_fee_amount: data.is_srs ? null : null,
      anr_contact_id: data.anr_contact_id || null,
      anr_admin_contact_id: data.anr_admin_contact_id || null,
    }
    const throwIfError = (error: any) => {
      if (!error) return
      console.error('[CalendarPage] booking save error:', error)
      throw new Error([error.message, error.details].filter(Boolean).join(' — '))
    }
    if (editBooking) {
      // A WO "owns" the booking's schedule (dates/times) once it has at least one
      // dated studio_time_row. While it does, the booking form must not overwrite
      // start_date/end_date/from_time/to_time, nor reshape the WO's rows from the
      // form's date range — the WO Close & Save is then the authoritative writer.
      const { data: woRows } = await supabase.from('work_orders').select('id')
        .eq('booking_id', editBooking.id).order('created_at', { ascending: false }).limit(1)
      const woId = woRows?.[0]?.id
      let woOwnsSchedule = false
      if (woId) {
        const { data: datedRows } = await supabase.from('studio_time_rows')
          .select('id').eq('work_order_id', woId)
          .not('date', 'is', null).neq('date', '').limit(1)
        woOwnsSchedule = (datedRows?.length ?? 0) > 0
      }

      const updatePayload: any = { ...payload, updated_at: new Date().toISOString() }
      if (woOwnsSchedule) {
        delete updatePayload.start_date
        delete updatePayload.end_date
        delete updatePayload.from_time
        delete updatePayload.to_time
      }
      const { error } = await supabase.from('bookings').update(updatePayload).eq('id', editBooking.id)
      throwIfError(error)
      // Create srs_log entry if this booking is newly flagged as SRS (wasn't before)
      if (data.is_srs && !editBooking.is_srs) {
        await supabase.from('srs_log').insert({ booking_id: editBooking.id, paid: false })
      }
      // Remove srs_log entry if SRS was toggled off
      if (!data.is_srs && editBooking.is_srs) {
        await supabase.from('srs_log').delete().eq('booking_id', editBooking.id)
      }
      // Sync studio_time_rows date range when booking is saved — only while no WO
      // yet owns the schedule (otherwise the WO is authoritative over its own rows).
      {
        if (woId && !woOwnsSchedule) {
          // Day-rate only: sync date range (add/remove rows)
          if (payload.rate_type === 'day') {
            const newDates = dateRange(data.start_date, data.end_date)
            const { data: existingStRows } = await supabase.from('studio_time_rows')
              .select('id, date, created_at').eq('work_order_id', woId).order('created_at', { ascending: true })

            // Dedup: keep earliest row per date
            const keepByDate: Record<string, string> = {}
            const dupeIds: string[] = []
            for (const r of existingStRows ?? []) {
              if (keepByDate[r.date]) dupeIds.push(r.id)
              else keepByDate[r.date] = r.id
            }
            if (dupeIds.length > 0) await supabase.from('studio_time_rows').delete().in('id', dupeIds)

            const newDateSet = new Set(newDates)
            const coveredDates = new Set(Object.keys(keepByDate))

            // Delete rows for dates no longer in the booking range
            const toRemove = Array.from(coveredDates).filter(d => !newDateSet.has(d)).map(d => keepByDate[d]).filter(Boolean)
            if (toRemove.length > 0) await supabase.from('studio_time_rows').delete().in('id', toRemove)

            // Insert rows for new dates
            const missingDates = newDates.filter(d => !coveredDates.has(d))
            if (missingDates.length > 0) {
              const dayRateNum = parseFloat((payload.rate_daily ?? '').replace(/[^0-9.]/g, ''))
              const studio = payload.studio?.match(/Studio\s+([A-Z])/i)?.[1]?.toUpperCase() ?? payload.studio ?? ''
              await supabase.from('studio_time_rows').insert(missingDates.map((d, i) => ({
                work_order_id: woId,
                studio,
                date: d, session_info: '',
                from_time: payload.from_time ?? '', to_time: payload.to_time ?? '',
                total_hours: null,
                rate: payload.rate_daily ?? '',
                charge: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum : null,
                day_count: 1,
                ot_rate: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum / 10 : null,
                sort_order: coveredDates.size + i,
              })))
            }
          }

        }
      }
    } else {
      const { data: inserted, error } = await supabase.from('bookings').insert(payload).select('id').single()
      throwIfError(error)
      if (data.is_srs && inserted) {
        await supabase.from('srs_log').insert({ booking_id: inserted.id, paid: false })
      }
    }
    try { sessionStorage.removeItem('cal_form_draft') } catch {}
    await load()
  }

  async function handleDelete() {
    if (editBooking) {
      await supabase.from('bookings').delete().eq('id', editBooking.id)
      try { sessionStorage.removeItem('cal_form_draft') } catch {}
      await load()
    }
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
    return (
      <div ref={gridRef} onScroll={handleGridScroll} style={{ flex: 1, overflow: 'auto', minHeight: 0, border: '1px solid var(--border)', borderRadius: 6, WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: LABEL_W + DAYS * colW }}>
        {/* Day header row */}
        <div style={{
          display: 'flex', position: 'sticky', top: 0, zIndex: 10,
          background: 'var(--surface)', borderBottom: '2px solid var(--border)',
        }}>
          <div style={{ width: LABEL_W, flexShrink: 0, borderRight: '1px solid var(--border)', position: 'sticky', left: 0, zIndex: 11, background: 'var(--surface)' }} />
          {days.map((d, i) => {
            const todayFlag = isToday(d)
            const wknd = isWeekend(d)
            const isMonthStart = d.getDate() === 1
            const isWeekStart = d.getDay() === 1 && i > 0
            // inset box-shadow draws a left-edge stripe without affecting layout
            const shadow = isMonthStart
              ? 'inset 2px 0 0 var(--accent)'
              : isWeekStart ? 'inset 2px 0 0 rgba(255,255,255,0.35)' : 'none'
            return (
              <div key={fmt(d)} style={{
                flex: 1, minWidth: colW, textAlign: 'center', padding: '2px 2px',
                background: wknd ? 'rgba(255,255,255,0.015)' : 'transparent',
                borderRight: '1px solid var(--border)',
                boxShadow: shadow,
                position: 'relative',
              }}>
                {isMonthStart && (
                  <div style={{
                    position: 'absolute', top: 2, left: 5,
                    fontSize: 6, fontFamily: 'DM Mono', color: 'var(--accent)',
                    letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
                  }}>
                    {d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                  </div>
                )}
                <div style={{
                  fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)',
                  letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1.2,
                }}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', margin: '2px auto 0',
                  background: todayFlag ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontFamily: 'DM Mono', fontWeight: todayFlag ? 700 : 400,
                  color: todayFlag ? '#0d0f14' : wknd ? 'var(--text2)' : 'var(--text)',
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
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              {/* Sticky label cell — always visible in the left column */}
              <div
                onClick={() => toggleCollapse(loc.name)}
                style={{
                  width: LABEL_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', cursor: 'pointer', userSelect: 'none',
                  background: 'var(--surface2)',
                  position: 'sticky', left: 0, zIndex: 6,
                }}
              >
                <span style={{
                  fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)',
                  display: 'inline-block', transition: 'transform 0.15s', flexShrink: 0,
                  transform: collapsed.has(loc.name) ? 'rotate(-90deg)' : 'rotate(0deg)',
                }}>▼</span>
                <span style={{
                  fontSize: 10, fontFamily: 'Syne', fontWeight: 700,
                  color: 'var(--text2)', letterSpacing: '0.06em', textTransform: 'uppercase',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{loc.name}</span>
              </div>
              {/* Separator band fills the rest of the row */}
              <div onClick={() => toggleCollapse(loc.name)} style={{ flex: 1, cursor: 'pointer' }} />
            </div>

            {/* Room rows */}
            {!collapsed.has(loc.name) && loc.rooms.map(room => {
              const roomKey = `${loc.name}|${room}`
              const isRoomCollapsed = collapsedRooms.has(roomKey)
              const roomBookings = bookings.filter(b => b.location === loc.name && b.studio === room)
              const laneMap = assignLanes(roomBookings)
              return (
                <div key={room} style={{
                  display: 'flex', borderBottom: '1px solid var(--border)',
                  height: isRoomCollapsed ? COLLAPSED_ROOM_H : rowH,
                }}>
                  {/* Room label — click to collapse/expand */}
                  <div
                    onClick={() => setCollapsedRooms(prev => {
                      const next = new Set(prev)
                      next.has(roomKey) ? next.delete(roomKey) : next.add(roomKey)
                      return next
                    })}
                    style={{
                      width: LABEL_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                      padding: '0 12px', fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)',
                      borderRight: '1px solid var(--border)', cursor: 'pointer', userSelect: 'none',
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      position: 'sticky', left: 0, zIndex: 5, background: 'var(--surface)',
                    }}
                  >
                    <span style={{
                      fontSize: 7, color: 'var(--text3)', flexShrink: 0,
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
                              background: isWeekend(d) ? 'rgba(255,255,255,0.012)' : 'transparent',
                              borderRight: '1px solid var(--border)',
                              boxShadow: cellIsMonthStart
                                ? 'inset 2px 0 0 rgba(200,240,78,0.3)'
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
                            lane={lane} numLanes={numLanes} rowH={rowH}
                            onClick={() => openEdit(b)}
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px - 48px)', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12,
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* Prev / Today / Next */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => {
              if (view === 'month') setStartDate(d => addDays(d, -totalDays))
              else setStartDate(d => addDays(d, -7))
            }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
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
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer' }}
          >Today</button>
          <button
            onClick={() => {
              if (view === 'month') setStartDate(d => addDays(d, totalDays))
              else setStartDate(d => addDays(d, 7))
            }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >›</button>
        </div>

        {/* Range label */}
        <div style={{ flex: 1, fontSize: 14, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text)' }}>
          {rangeLabel(startDate, totalDays)}
        </div>

        {/* "All" pill — only shown when a specific studio is selected */}
        {locFilter.includes('|') && (
          <button
            onClick={() => { setLocFilter('All'); setView('2wks') }}
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 10, fontFamily: 'DM Mono',
              fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)',
              background: 'var(--surface2)', color: 'var(--text2)',
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
            background: locFilter.includes('|') ? 'rgba(200,240,78,0.08)' : 'var(--surface2)',
            border: locFilter.includes('|') ? '1px solid rgba(200,240,78,0.4)' : '1px solid var(--border)',
            color: locFilter.includes('|') ? 'var(--accent)' : 'var(--text2)',
            borderRadius: 4, padding: '4px 10px',
            fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', outline: 'none',
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
          display: 'flex', background: 'var(--surface2)',
          borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          {(['day', 'week', '2wks', 'month'] as ViewType[]).map(v => (
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
              padding: '4px 12px', fontSize: 10, fontFamily: 'DM Mono',
              cursor: 'pointer', border: 'none',
              background: view === v ? 'var(--border)' : 'transparent',
              color: view === v ? 'var(--accent)' : 'var(--text2)',
              fontWeight: view === v ? 700 : 400,
            }}>
              {v === '2wks' ? '2 Wks' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <button
            onClick={() => setZoomLevel(z => Math.max(z - 1, 0))}
            title="Zoom out (−)"
            style={{ padding: '4px 9px', fontSize: 14, lineHeight: 1, background: 'transparent', border: 'none', color: zoomLevel === 0 ? 'var(--text3)' : 'var(--text)', cursor: zoomLevel === 0 ? 'default' : 'pointer' }}
          >−</button>
          <span
            onClick={() => setZoomLevel(0)}
            title="Reset to fit all (0)"
            style={{ fontSize: 9, fontFamily: 'DM Mono', color: zoomLevel === 0 ? 'var(--accent)' : 'var(--text2)', minWidth: 26, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
          >{zoomLevel === 0 ? 'Fit' : `${rowH}px`}</span>
          <button
            onClick={() => setZoomLevel(z => Math.min(z + 1, ZOOM_FIXED.length))}
            title="Zoom in (+)"
            style={{ padding: '4px 9px', fontSize: 14, lineHeight: 1, background: 'transparent', border: 'none', color: zoomLevel === ZOOM_FIXED.length ? 'var(--text3)' : 'var(--text)', cursor: zoomLevel === ZOOM_FIXED.length ? 'default' : 'pointer' }}
          >+</button>
        </div>

        {/* New booking */}
        <button
          onClick={() => openNew()}
          style={{
            padding: '6px 16px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono',
            fontWeight: 700, cursor: 'pointer', background: '#1e40af', border: 'none', color: '#fff',
          }}
        >+ New Booking</button>
      </div>

      {/* Calendar content */}
      {(view === '2wks' || view === 'week' || view === 'month') && renderGrid()}

      {view === 'day' && (
        <DayView
          dayViewDate={dayViewDate}
          setDayViewDate={setDayViewDate}
          locFilter={locFilter}
          onOpenEdit={openEdit}
          reloadKey={reloadKey}
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

      {/* Booking form modal */}
      {formOpen && (
        <BookingForm
          bookingId={editBooking?.id}
          booking={editBooking ?? undefined}
          initial={formInitial}
          onSave={handleSave}
          onDelete={editBooking ? handleDelete : undefined}
          onClose={() => { try { sessionStorage.removeItem('cal_form_draft') } catch {} setFormOpen(false); setEditBooking(null) }}
          onDraftChange={(data) => {
            try { sessionStorage.setItem('cal_form_draft', JSON.stringify({ editBooking, formData: data })) } catch {}
          }}
          onSaved={() => { loadRef.current(); setReloadKey(k => k + 1) }}
        />
      )}
    </div>
  )
}
