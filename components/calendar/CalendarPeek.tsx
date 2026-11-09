'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Booking } from '@/lib/supabase'
import { STUDIO_LOCATIONS } from '@/lib/studios'
import { sessionFillClass, fmtCardTime } from '@/components/calendar/SessionCard'

/**
 * THE CALENDAR PEEK (option C, nav-memory-options.html, Eli 2026-11-09).
 *
 * "Say you're in the billing hub and you need to look at the calendar real
 * quick." A ▤ Calendar button on the Billing Hub and the CRM slides this week
 * over the page. You look, you close it, and you are exactly where you were
 * because you never left. READ-ONLY on purpose: the moment someone needs to
 * edit a booking they tap it and land on the real calendar's Day view, with
 * the return pill pointing back here.
 *
 * SAME SHAPE AS THE GRID (Eli, 2026-11-09 14:23: "make it the same style as
 * the grid view"). Location bands (.c-calloc), one row per room, seven day
 * columns, and the sessions are the calendar's own chips — c-ev +
 * sessionFillClass, Archivo name, mono time — spanning the days they run.
 * It is the grid's look, not its code: no lanes, no spine bars, no zoom. Two
 * sessions in one room on one day stack, and the row grows to fit.
 *
 * One small read per week shown, straight from `bookings` (the projection
 * cards the calendar itself draws from). No realtime channel — a peek is a
 * glance, and the page underneath already holds its own channel.
 */

type Props = { onClose: () => void }

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function sunday(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); r.setDate(r.getDate() - r.getDay()); return r }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r }

const ROW_H = 34
const DAYS = 7

export function CalendarPeek({ onClose }: Props) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(() => sunday(new Date()))
  const [rows, setRows] = useState<Booking[]>([])
  const weekEnd = addDays(weekStart, 6)
  const winStart = ymd(weekStart), winEnd = ymd(weekEnd)

  useEffect(() => {
    let live = true
    supabase.from('bookings').select('*')
      .lte('start_date', winEnd).gte('end_date', winStart)
      .then(({ data }) => { if (live) setRows((data ?? []) as Booking[]) })
    return () => { live = false }
  }, [winStart, winEnd])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i)), [weekStart])
  const today = ymd(new Date())
  const live = useMemo(() => rows.filter(b => b.status !== 'cancelled'), [rows])

  const label = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  const calHref = `/calendar?cv=grid&d=${winStart}`
  const openDay = (d: string) => { onClose(); router.push(`/calendar?cv=day&d=${d}`) }

  /** Day index (0–6) a date lands on inside this week, clamped. */
  const idx = (d: string) => Math.max(0, Math.min(DAYS - 1, Math.round((new Date(d + 'T00:00:00').getTime() - weekStart.getTime()) / 86400000)))

  return (
    <>
      <div className="c-peek-dim" onClick={onClose} />
      <aside className="c-peek" role="dialog" aria-label="Calendar peek">
        <div className="c-peek-hd">
          <span className="c-peek-ttl">▤ {label}</span>
          <button type="button" className="c-soft" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
          <button type="button" className="c-soft" onClick={() => setWeekStart(sunday(new Date()))}>Today</button>
          <button type="button" className="c-soft" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">›</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="c-soft" onClick={() => { onClose(); router.push(calHref) }}>Open calendar</button>
          <a className="c-soft" href={calHref} target="_blank" rel="noopener" title="Open calendar in a new window">↗</a>
          <button type="button" className="c-soft" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="c-peek-grid">
          {/* Day header — the label column's spacer, then seven days. */}
          <div className="c-peek-hdr">
            <div className="c-peek-lbl" />
            {days.map(d => {
              const k = ymd(d)
              return (
                <button type="button" key={k} className={`c-peek-dayhd${k === today ? ' c-today' : ''}`} onClick={() => openDay(k)} title="Open this day on the calendar">
                  <span>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span> <b>{d.getDate()}</b>
                </button>
              )
            })}
          </div>

          {STUDIO_LOCATIONS.map(loc => (
            <div key={loc.name}>
              <div className="c-calloc c-peek-loc">{loc.name}</div>
              {loc.rooms.map((room, ri) => {
                const inRoom = live
                  .filter(b => b.location === loc.name && b.studio === room)
                  .sort((a, b) => a.start_date.localeCompare(b.start_date) || (a.from_time ?? '99').localeCompare(b.from_time ?? '99'))
                // Lanes: a chip takes the first lane free over its span.
                const lanes: Booking[][] = []
                const laneOf = new Map<string, number>()
                for (const b of inRoom) {
                  const s = idx(b.start_date), e = idx(b.end_date)
                  let l = 0
                  while (lanes[l]?.some(o => idx(o.start_date) <= e && idx(o.end_date) >= s)) l++
                  ;(lanes[l] ??= []).push(b); laneOf.set(b.id, l)
                }
                const h = ROW_H * Math.max(1, lanes.length)
                return (
                  <div key={room} className={`c-peek-row${ri % 2 === 0 ? ' c-calrow-alt' : ''}`} style={{ height: h }}>
                    <div className="c-peek-lbl">{room}</div>
                    <div className="c-peek-cells">
                      {days.map(d => <div key={ymd(d)} className={`c-peek-cell${ymd(d) === today ? ' c-today' : ''}`} />)}
                      {inRoom.map(b => {
                        const s = idx(b.start_date), e = idx(b.end_date)
                        const isBilling = b.payment_type === 'billing'
                        const name = isBilling ? (b.artist || b.label || b.client_name || '') : (b.client_name || '')
                        const time = b.from_time && b.to_time ? `${fmtCardTime(b.from_time)}–${fmtCardTime(b.to_time)}` : b.from_time ? fmtCardTime(b.from_time) : 'TBD'
                        return (
                          <button
                            type="button" key={b.id}
                            className={`c-ev c-raised-chip c-peek-chip ${sessionFillClass(b.status)}`}
                            style={{ left: `calc(${(s / DAYS) * 100}% + 2px)`, width: `calc(${((e - s + 1) / DAYS) * 100}% - 4px)`, top: 2 + (laneOf.get(b.id) ?? 0) * ROW_H, height: ROW_H - 4 }}
                            onClick={() => openDay(b.start_date < winStart ? winStart : b.start_date)}
                            title={`${name} · ${time}`}
                          >
                            <span className="c-arch c-peek-name">{name || 'Untitled'}</span>
                            <span className="c-mono c-peek-time">{time}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <p className="c-peek-note">Read-only. Tap a day or a session to open it on the calendar; the pill at the top brings you back here.</p>
      </aside>
    </>
  )
}
