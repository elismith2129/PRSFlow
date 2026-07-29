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

// Canonical time/date math now lives in lib/time.ts (Phase 1 audit fix).
// Re-exported here for back-compat with existing importers.
import { calcHours, calcCharge, dateRange, toStudioLetter } from '@/lib/time'
export { dateRange, toStudioLetter }

export type SeedRowParams = {
  // Omit when the payloads are handed to create_work_order_atomic — the RPC
  // injects work_order_id after the WO insert (the id doesn't exist yet).
  workOrderId?: string
  studio: string // bare letter/name; already normalized by the caller or passed raw
  dates: string[] // explicit ISO dates to add
  fromTime?: string
  toTime?: string
  rateType: 'day' | 'hour'
  rate?: string // hourly rate string (used when rateType === 'hour')
  rateDaily?: string // daily rate string (used when rateType === 'day')
  sortOrderStart?: number // sort_order for the first new row (default 0)
  // Optional staff seed (Seed panel may pre-fill the staff sub-row).
  engRate?: string
  engFromTime?: string
  engToTime?: string
  engName?: string
  engRole?: 'engineer' | 'assistant' // 1ST vs 2ND; default 'engineer'
}

// Build one studio_time_rows payload for a single date. Mirrors the exact column
// logic that createWorkOrderForBooking used inline, so seeding is byte-identical.
function buildRowPayload(p: SeedRowParams, date: string, sortOrder: number): Record<string, any> {
  const base: Record<string, any> = {
    studio: p.studio,
    date,
    session_info: '',
    from_time: p.fromTime ?? '',
    to_time: p.toTime ?? '',
    sort_order: sortOrder,
  }
  if (p.workOrderId) base.work_order_id = p.workOrderId

  // Optional staff sub-row seed (when a rate and/or a name is supplied).
  const seedName = (p.engName ?? '').trim()
  if ((p.engRate != null && p.engRate !== '') || seedName !== '') {
    if (p.engRate != null && p.engRate !== '') base.eng_rate = p.engRate
    if (seedName !== '') base.eng_name = seedName
    base.eng_role = p.engRole === 'assistant' ? 'assistant' : 'engineer'
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
 * Build the studio_time_rows payloads for a set of dates WITHOUT inserting.
 * Single source for the row shape — used by createWorkOrderForBooking to hand
 * prebuilt rows to the atomic create RPC. All payloads in one call share the
 * same key set (a requirement of the RPC's bulk appliers).
 */
export function buildSeedRowPayloads(params: SeedRowParams): Record<string, any>[] {
  const sortBase = params.sortOrderStart ?? 0
  return params.dates.map((d, i) => buildRowPayload(params, d, sortBase + i))
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
  if (!params.workOrderId) {
    throw new Error('seedStudioTimeRows requires workOrderId (use buildSeedRowPayloads for RPC payloads)')
  }
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
