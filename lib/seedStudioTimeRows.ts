import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// seedStudioTimeRows — shared, append-only generator for studio_time_rows.
//
// One row per date, with the correct day-rate vs hourly columns. Used by BOTH:
//   • lib/createWorkOrder.ts  — initial seed when a WO is first created
//   • the WO "Seed" panel      — bulk-add a date range at any time
//
// Rules (see docs/WO-SPEC.md §6):
//   • APPEND-ONLY. Any date that already has a row for this WO is skipped —
//     the seed never overwrites existing schedule data (it is a row generator,
//     not a source of truth).
//   • The Studio Time table remains the single source of truth after seeding.
// ─────────────────────────────────────────────────────────────────────────────

// Local helpers (canonical copies; mirror WorkOrderPopup.tsx / createWorkOrder.ts).
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

function calcHours(from: string, to: string): number | null {
  if (!from || !to) return null
  const f = timeToMins(from)
  const t = timeToMins(to)
  let diff = t - f
  if (diff <= 0) diff += 24 * 60 // overnight session or same time → wrap to next day
  if (diff >= 24 * 60) return null // exact 24h means same start/end time, skip
  return parseFloat((diff / 60).toFixed(2))
}

function calcCharge(hours: number | null, rate: string): number | null {
  if (!hours || !rate) return null
  const r = parseFloat(rate.replace(/[^0-9.]/g, ''))
  if (isNaN(r) || r === 0) return null
  return parseFloat((hours * r).toFixed(2))
}

// "Studio A" → "A", "Studio X" → "X", "North" → "North"
export function toStudioLetter(s: string): string {
  const m = s.match(/Studio\s+([A-Z])/i)
  return m ? m[1].toUpperCase() : s.trim()
}

// Inclusive list of ISO dates from start..end (noon-anchored to dodge TZ drift).
export function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date((end || start) + 'T12:00:00')
  const d = new Date(s)
  while (d <= e) {
    dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

export type SeedRowParams = {
  workOrderId: string
  studio: string // bare letter/name; already normalized by the caller or passed raw
  dates: string[] // explicit ISO dates to add
  fromTime?: string
  toTime?: string
  rateType: 'day' | 'hour'
  rate?: string // hourly rate string (used when rateType === 'hour')
  rateDaily?: string // daily rate string (used when rateType === 'day')
  sortOrderStart?: number // sort_order for the first new row (default 0)
  // Optional engineer seed (Seed panel may pre-fill an engineer sub-row rate).
  engRate?: string
  engFromTime?: string
  engToTime?: string
}

// Build one studio_time_rows payload for a single date. Mirrors the exact column
// logic that createWorkOrderForBooking used inline, so seeding is byte-identical.
function buildRowPayload(p: SeedRowParams, date: string, sortOrder: number): Record<string, any> {
  const base: Record<string, any> = {
    work_order_id: p.workOrderId,
    studio: p.studio,
    date,
    session_info: '',
    from_time: p.fromTime ?? '',
    to_time: p.toTime ?? '',
    sort_order: sortOrder,
  }

  // Optional engineer sub-row seed (only when a rate is supplied).
  if (p.engRate != null && p.engRate !== '') {
    base.eng_rate = p.engRate
    base.eng_from_time = p.engFromTime ?? p.fromTime ?? ''
    base.eng_to_time = p.engToTime ?? p.toTime ?? ''
    base.eng_visible = true
  }

  if (p.rateType === 'day') {
    const dayRateNum = parseFloat((p.rateDaily ?? '').replace(/[^0-9.]/g, ''))
    return {
      ...base,
      total_hours: null,
      rate: p.rateDaily ?? '',
      rate_daily: p.rateDaily ?? '',
      row_rate_type: 'day',
      charge: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum : null,
      day_count: 1,
      ot_rate: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum / 10 : null,
    }
  }

  const hrs = calcHours(p.fromTime ?? '', p.toTime ?? '')
  return {
    ...base,
    total_hours: hrs,
    rate: p.rate ?? '',
    row_rate_type: 'hour',
    charge: calcCharge(hrs, p.rate ?? ''),
    ot_rate: parseFloat((p.rate ?? '').replace(/[^0-9.]/g, '')) || null,
  }
}

/**
 * Append studio_time_rows for the given dates. Dates that already have a row on
 * this WO are skipped (append-only). Returns the number of rows inserted.
 *
 * @param opts.skipExisting  default true. Set false only for a guaranteed-fresh
 *   WO (e.g. right after creation) to skip the pre-check round-trip.
 */
export async function seedStudioTimeRows(
  params: SeedRowParams,
  opts: { skipExisting?: boolean } = {},
): Promise<{ inserted: number }> {
  const skipExisting = opts.skipExisting !== false

  let datesToAdd = params.dates
  let sortBase = params.sortOrderStart ?? 0

  if (skipExisting) {
    const { data: existing } = await supabase
      .from('studio_time_rows')
      .select('date, sort_order')
      .eq('work_order_id', params.workOrderId)
    const covered = new Set((existing ?? []).map((r: any) => r.date).filter(Boolean))
    datesToAdd = params.dates.filter(d => !covered.has(d))
    // Continue sort_order after the highest existing row so new rows append.
    if (params.sortOrderStart == null) {
      const maxSort = (existing ?? []).reduce((m: number, r: any) => Math.max(m, r.sort_order ?? 0), -1)
      sortBase = maxSort + 1
    }
  }

  if (datesToAdd.length === 0) return { inserted: 0 }

  const payloads = datesToAdd.map((d, i) => buildRowPayload(params, d, sortBase + i))
  const { error } = await supabase.from('studio_time_rows').insert(payloads)
  if (error) {
    throw new Error(['studio_time_rows seed failed', error.message, error.details].filter(Boolean).join(' — '))
  }
  return { inserted: payloads.length }
}
