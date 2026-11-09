'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Booking } from '@/lib/supabase'

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
function fmtTime(t: string | null): string {
  if (!t) return ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!m) return t
  let h = parseInt(m[1]); const min = m[2]; const ap = m[3]?.toUpperCase()
  if (ap) return `${h}${min !== '00' ? ':' + min : ''}${ap === 'AM' ? 'a' : 'p'}`
  const suf = h >= 12 ? 'p' : 'a'
  if (h > 12) h -= 12
  if (h === 0) h = 12
  return `${h}${min !== '00' ? ':' + min : ''}${suf}`
}

const QUIET: Booking['status'][] = ['cancelled']

export function CalendarPeek({ onClose }: Props) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(() => sunday(new Date()))
  const [rows, setRows] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const weekEnd = addDays(weekStart, 6)

  useEffect(() => {
    let live = true
    setLoading(true)
    supabase.from('bookings').select('*')
      .lte('start_date', ymd(weekEnd)).gte('end_date', ymd(weekStart))
      .then(({ data }) => { if (live) { setRows((data ?? []) as Booking[]); setLoading(false) } })
    return () => { live = false }
  }, [weekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const today = ymd(new Date())
  const byDay = useMemo(() => {
    const m: Record<string, Booking[]> = {}
    for (const d of days) m[ymd(d)] = []
    for (const b of rows) {
      if (QUIET.includes(b.status)) continue
      for (const d of days) {
        const k = ymd(d)
        if (b.start_date <= k && b.end_date >= k) m[k].push(b)
      }
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.from_time ?? '99').localeCompare(b.from_time ?? '99'))
    return m
  }, [rows, days])

  const label = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  const calHref = `/calendar?cv=grid&d=${ymd(weekStart)}`
  const openDay = (d: string) => { onClose(); router.push(`/calendar?cv=day&d=${d}`) }

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
        <div className="c-peek-days">
          {days.map(d => {
            const k = ymd(d)
            const list = byDay[k] ?? []
            return (
              <div key={k} className={`c-peek-day${k === today ? ' c-today' : ''}`}>
                <button type="button" className="c-peek-dayhd" onClick={() => openDay(k)} title="Open this day on the calendar">
                  {d.toLocaleDateString('en-US', { weekday: 'short' })} <b>{d.getDate()}</b>
                </button>
                {loading && !rows.length ? <div className="c-peek-empty">…</div>
                  : list.length === 0 ? <div className="c-peek-empty">—</div>
                  : list.map(b => (
                    <button type="button" key={b.id + k} className={`c-peek-sess c-st-${b.status}`} onClick={() => openDay(k)}>
                      <span className="c-peek-time">{b.from_time ? `${fmtTime(b.from_time)}${b.to_time ? '–' + fmtTime(b.to_time) : ''}` : 'TBD'}</span>
                      <span className="c-peek-who">{b.artist || b.client_name || b.label || 'Untitled'}</span>
                      <span className="c-peek-room">{[b.location, b.studio].filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
              </div>
            )
          })}
        </div>
        <p className="c-peek-note">Read-only. Tap a day or a session to open it on the calendar; the pill at the top brings you back here.</p>
      </aside>
    </>
  )
}
