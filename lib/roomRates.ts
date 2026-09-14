// ─────────────────────────────────────────────────────────────────────────────
// lib/roomRates — the rack day rate per room (table `room_rates`, migration
// 20260914150000; ruling 7 of docs/design-refs/wo-blanket-rate-options.html,
// built per docs/design-refs/wo-seed-rooms-and-rates-options.html).
//
// THE ONE RULE: a room rate FILLS an empty rate; it never overrides a typed
// one. Read in exactly three places (Eli, 2026-09-14 — "not anywhere else"):
// the Add-dates prompt, the Seed panel, and a blank row's room pick. Not the
// lead form; never an existing row.
//
// `room` is the LETTER form ('A', 'X') or 'North'/'South' — the same
// vocabulary studio_time_rows.studio stores (CLAUDE.md, studio-names rule).
// Hourly is day ÷ DAY_HOUR_RATIO and is derived here, never stored.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { DAY_HOUR_RATIO } from '@/lib/woTotals'
import { toStudioLetter } from '@/lib/time'

export type RoomRate = {
  id: string
  venue: string
  room: string
  day_rate: number
  min_hours: number | null
  sort_order: number
}

export async function fetchRoomRates(): Promise<RoomRate[]> {
  const { data, error } = await supabase
    .from('room_rates')
    .select('id, venue, room, day_rate, min_hours, sort_order')
    .order('sort_order')
  if (!dbResult('Loading room rates', error)) return []
  return (data ?? []).map(r => ({ ...r, day_rate: Number(r.day_rate) || 0 }))
}

/** The day rate for a room, or null when the table has no row for it. */
export function dayRateFor(rates: RoomRate[], venue: string | null | undefined, room: string | null | undefined): number | null {
  const v = String(venue ?? '').trim()
  const r = toStudioLetter(String(room ?? '').trim())
  if (!v || !r) return null
  const hit = rates.find(x => x.venue === v && x.room === r)
  return hit && hit.day_rate > 0 ? hit.day_rate : null
}

/** Hourly equivalent, house law: day ÷ 10. */
export function hourlyFromDay(day: number): number {
  return parseFloat((day / DAY_HOUR_RATIO).toFixed(2))
}

/** Owner / manager / billing edit a rate; the row's updated_at moves with it. */
export async function saveRoomRate(id: string, patch: { day_rate?: number; min_hours?: number | null }): Promise<boolean> {
  const { error } = await supabase
    .from('room_rates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  return dbResult('Saving room rate', error)
}
