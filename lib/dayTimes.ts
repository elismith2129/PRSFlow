// lib/dayTimes — a booking card's times and staff FOR ONE DAY.
//
// Eli, 2026-09-28 (Melly Mike: "showing 6p start when its actually 3p… we
// have 3p showing correctly on the admin app and the cal displays, just the
// runner app"). A `bookings` row is a PROJECTION CARD: since the July 2026
// rebuild the WO is the source of truth and the card carries DAY ONE's
// from/to and the run's FOLDED staff. Every day of a multi-day session has
// its own row in `studio_time_rows`, and that row is the truth for that day.
//
// The app calendar has read per-day rows since 2026-09-18 (B1 spine), the TV
// wall since 2026-09-25, and the WO popup always has. Every OTHER "today"
// surface — runner hub, home dashboard, location strip, daily-ops log — still
// printed the card's day-one values. This is the one helper they all call.
//
// Display only. Nothing here writes; the WO is untouched (option A in the
// calendar's F-9 note — rewriting the projection to fix a label was rejected).
import { supabase } from '@/lib/supabase'
import { timeToMins, toStudioLetter } from '@/lib/time'

type BookingLike = {
  id: string
  work_order_id?: string | null
  studio?: string | null
  from_time?: string | null
  to_time?: string | null
  engineer_name?: string | null
  assistant_name?: string | null
}

type Row = {
  work_order_id: string
  studio: string | null
  from_time: string | null
  to_time: string | null
  times_tbd: boolean | null
  eng_name: string | null
  eng_role: string | null
  eng_visible: boolean | null
}

/**
 * Overlay each booking's from/to and 1ST/2ND with that DAY's studio_time_rows,
 * then re-sort by the day's start. A booking with no row for the day (legacy /
 * pre-WO) keeps its own values — never blank. A day marked TBD reads 'TBD'.
 *
 * Times come from the room row (a two-room WO has a row per room per day),
 * falling back to the day's first timed row. Staff comes from any row that
 * day naming someone: with rows on file a day whose row names nobody is
 * nobody — not the card's folded names, which are exactly what this replaces.
 */
export async function overlayDayTimes<T extends BookingLike>(bookings: T[], date: string): Promise<T[]> {
  const woIds = Array.from(new Set(bookings.map(b => b.work_order_id).filter((x): x is string => !!x)))
  if (woIds.length === 0) return bookings

  const { data, error } = await supabase
    .from('studio_time_rows')
    .select('work_order_id, studio, from_time, to_time, times_tbd, eng_name, eng_role, eng_visible')
    .in('work_order_id', woIds)
    .eq('date', date)
  if (error || !data) return bookings

  const byWo: Record<string, Row[]> = {}
  for (const r of data as Row[]) (byWo[r.work_order_id] = byWo[r.work_order_id] ?? []).push(r)

  const out = bookings.map(b => {
    const rows = b.work_order_id ? byWo[b.work_order_id] : undefined
    if (!rows || rows.length === 0) return b

    const room = toStudioLetter(b.studio ?? '')
    const timed = rows.filter(r => (r.studio ?? '').trim())
    const t = timed.find(r => toStudioLetter(r.studio ?? '') === room) ?? timed[0]

    let eng: string | null = null
    let asst: string | null = null
    for (const r of rows) {
      if (!r.eng_name) continue
      if (r.eng_role === 'engineer') { if (!eng) eng = r.eng_name }
      else if (!asst) asst = r.eng_name
    }

    return {
      ...b,
      ...(t ? {
        from_time: t.times_tbd ? 'TBD' : (t.from_time ?? ''),
        to_time: t.times_tbd ? '' : (t.to_time ?? ''),
      } : {}),
      engineer_name: eng,
      assistant_name: asst,
    }
  })

  return out.sort((a, b) => {
    const am = timeToMins(a.from_time ?? ''), bm = timeToMins(b.from_time ?? '')
    if (isNaN(am) && isNaN(bm)) return 0
    if (isNaN(am)) return 1
    if (isNaN(bm)) return -1
    return am - bm
  })
}
