'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sessionFillClass } from '@/components/calendar/SessionCard'
import { getLocalToday } from '@/lib/time'

/**
 * THE CALENDAR FIND (Eli, 2026-10-12: "there will be multiple sessions for a
 * typed name often. like. find feature.") — what the calendar's one search bar
 * does. Type a name and a list of that person's sessions drops under the bar,
 * ACROSS ALL DATES, not just the days on screen: upcoming first (soonest at
 * the top), then past (most recent first), cancelled dimmed. A multi-day
 * session is ONE row with its date range. Click a row (or ↑ ↓ then Enter) and
 * the calendar jumps to that week and outlines the session; the list stays
 * open so the next one is a click away. Esc puts you back.
 *
 * It searches `bookings` (the projection cards every calendar surface reads —
 * CLAUDE.md), which carry client, artist and label, and `work_orders` for a
 * WO number. Imported history (imported_at set) is searchable too; it is the
 * old calendar, and "when were they last in" is half the point.
 *
 * Reads happen only while there is text in the bar, debounced; nothing is
 * kept when the bar is empty.
 */

export type FindHit = {
  key: string            // work_order_id, or the booking id for a WO-less block
  bookingId: string      // the card to outline — the first card of the session
  who: string
  sub: string | null     // label / A&R line
  start: string          // YYYY-MM-DD
  end: string
  rooms: string[]
  status: string
  wo: string | null
  upcoming: boolean
}

type Card = {
  id: string; work_order_id: string | null; client_name: string | null; artist: string | null
  label: string | null; location: string; studio: string; start_date: string; end_date: string; status: string
}

const VENUE_CODE: Record<string, string> = { Paramount: 'PRS', Ameraycan: 'ARS', Encore: 'ERS', Track: 'TRK' }
const roomCode = (loc: string, studio: string) => `${VENUE_CODE[loc] ?? loc} ${studio.replace(/^Studio /, '')}`

function fmtRange(start: string, end: string): string {
  const d = (s: string) => new Date(s + 'T12:00:00')
  const a = d(start), b = d(end)
  if (start === end) return a.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const sameMonth = a.getMonth() === b.getMonth()
  return `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`
}

export function CalendarFind({ query, activeKey, onPick, onClose }: {
  query: string
  activeKey: string | null
  onPick: (hit: FindHit) => void
  onClose: () => void
}) {
  const [hits, setHits] = useState<FindHit[]>([])
  const [loading, setLoading] = useState(false)
  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) { setHits([]); return }
    let live = true
    setLoading(true)
    const t = setTimeout(async () => {
      const like = `%${q.replace(/[%_,]/g, ' ')}%`
      const today = getLocalToday()
      // Names on the card, plus a WO number typed as "WO-1234" or "1234".
      const woNum = q.match(/^(?:wo-?)?(\d{3,5})$/i)?.[1]
      const byWo = woNum
        ? supabase.from('work_orders').select('id').ilike('wo_number', `WO-${woNum}%`).limit(20)
        : Promise.resolve({ data: [] as { id: string }[] })
      const [{ data: byName }, { data: wos }] = await Promise.all([
        supabase.from('bookings')
          .select('id, work_order_id, client_name, artist, label, location, studio, start_date, end_date, status')
          .or(`client_name.ilike.${like},artist.ilike.${like},label.ilike.${like}`)
          .order('start_date', { ascending: false })
          .limit(400),
        byWo,
      ])
      let cards = (byName ?? []) as Card[]
      const woIds = (wos ?? []).map(w => w.id)
      if (woIds.length) {
        const { data: byWoCards } = await supabase.from('bookings')
          .select('id, work_order_id, client_name, artist, label, location, studio, start_date, end_date, status')
          .in('work_order_id', woIds)
        cards = cards.concat((byWoCards ?? []) as Card[])
      }
      if (!live) return
      // WO numbers for the rows, in one read.
      const sessionWoIds = Array.from(new Set(cards.map(c => c.work_order_id).filter(Boolean))) as string[]
      const woNumbers: Record<string, string> = {}
      if (sessionWoIds.length) {
        const { data: w } = await supabase.from('work_orders').select('id, wo_number').in('id', sessionWoIds)
        for (const row of (w ?? []) as { id: string; wo_number: string | null }[]) if (row.wo_number) woNumbers[row.id] = row.wo_number
      }
      if (!live) return
      // One row per session: cards sharing a work order fold together.
      const byKey = new Map<string, FindHit>()
      for (const c of cards) {
        const key = c.work_order_id ?? c.id
        const room = roomCode(c.location, c.studio)
        const cur = byKey.get(key)
        if (cur) {
          if (c.start_date < cur.start) { cur.start = c.start_date; cur.bookingId = c.id }
          if (c.end_date > cur.end) cur.end = c.end_date
          if (!cur.rooms.includes(room)) cur.rooms.push(room)
          if (cur.status !== 'confirmed' && c.status === 'confirmed') cur.status = 'confirmed'
        } else {
          byKey.set(key, {
            key, bookingId: c.id,
            who: c.artist || c.client_name || 'No name',
            sub: [c.label, c.artist && c.client_name && c.client_name !== c.artist ? c.client_name : null].filter(Boolean).join(' · ') || null,
            start: c.start_date, end: c.end_date, rooms: [room], status: c.status,
            wo: c.work_order_id ? woNumbers[c.work_order_id] ?? null : null,
            upcoming: c.end_date >= today,
          })
        }
      }
      const all = Array.from(byKey.values())
      for (const h of all) h.upcoming = h.end >= today
      const up = all.filter(h => h.upcoming).sort((a, b) => a.start.localeCompare(b.start))
      const past = all.filter(h => !h.upcoming).sort((a, b) => b.start.localeCompare(a.start))
      setHits(up.concat(past))
      setLoading(false)
    }, 180)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  // ↑ ↓ step through the list, Enter picks, Esc closes — from the search bar.
  useEffect(() => {
    if (!q) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
      if (hits.length === 0) return
      const i = hits.findIndex(h => h.key === activeKey)
      if (e.key === 'Enter') { if (i >= 0) { e.preventDefault(); onPick(hits[i]) } return }
      e.preventDefault()
      const n = e.key === 'ArrowDown' ? Math.min(hits.length - 1, i + 1) : Math.max(0, i - 1)
      onPick(hits[n])
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [q, hits, activeKey, onPick, onClose])

  const upcoming = useMemo(() => hits.filter(h => h.upcoming), [hits])
  const past = useMemo(() => hits.filter(h => !h.upcoming), [hits])
  if (!q) return null

  const row = (h: FindHit) => (
    <div
      key={h.key}
      className={`c-find-row${h.key === activeKey ? ' c-on' : ''}${h.status === 'cancelled' ? ' c-find-x' : ''}`}
      onClick={() => onPick(h)}
      title="Jump to this session"
    >
      <span className="c-mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtRange(h.start, h.end)}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <b style={{ fontWeight: 700 }}>{h.who}</b>
        {h.sub && <span style={{ opacity: .55, fontSize: 11 }}> · {h.sub}</span>}
      </span>
      <span style={{ fontSize: 11, opacity: .7, whiteSpace: 'nowrap' }}>{h.rooms.join(' + ')}</span>
      <span><span className={`c-bbin ${sessionFillClass(h.status)}`} style={h.status === 'cancelled' ? { color: 'var(--c-hot-text)' } : { color: 'var(--c-chip-ink)' }}>{h.status === 'tentative' ? 'hold' : h.status}</span></span>
      <span className="c-binv" style={{ fontSize: 10.5, textAlign: 'right' }}>{h.wo ?? ''}</span>
    </div>
  )

  return (
    <div className="c-find" role="listbox">
      <div className="c-lozenge" style={{ padding: '2px 8px 6px' }}>
        <b>{q.length < 2 ? 'Keep typing…' : loading ? 'Looking…' : `${hits.length} session${hits.length === 1 ? '' : 's'} · all dates`}</b>
        <span className="c-ct">↑ ↓ to step · Esc to close</span>
      </div>
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {upcoming.length > 0 && <div className="c-label c-find-sec">Upcoming</div>}
        {upcoming.map(row)}
        {past.length > 0 && <div className="c-label c-find-sec">Past</div>}
        {past.map(row)}
        {!loading && q.length >= 2 && hits.length === 0 && <div className="c-bempty">No session matches that.</div>}
      </div>
    </div>
  )
}
