import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// deleteSessionAndWO — deletes a session opened as a WO: the work order + all
// of its line items, its SRS log rows, and ALL of its booking cards (primary +
// secondary room-run cards; bookings.work_order_id is ON DELETE CASCADE, so
// deleting the WO removes its cards — the explicit deletes are belt+braces for
// legacy rows that predate the link). Used by the WO Delete-session button on
// both the calendar and the dashboard. (Step 8 extraction — was calendar-only.)
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteSessionAndWO(b: Booking): Promise<void> {
  const woIds = new Set<string>()
  if ((b as any).work_order_id) woIds.add((b as any).work_order_id as string)
  const { data: wos } = await supabase.from('work_orders').select('id').eq('booking_id', b.id)
  for (const w of (wos ?? [])) woIds.add(w.id)
  for (const id of woIds) {
    await supabase.from('studio_time_rows').delete().eq('work_order_id', id)
    await supabase.from('equipment_condition_rows').delete().eq('work_order_id', id)
    await supabase.from('equipment_condition_notes').delete().eq('work_order_id', id)
    await supabase.from('rental_rows').delete().eq('work_order_id', id)
    await supabase.from('payment_rows').delete().eq('work_order_id', id)
    await supabase.from('bookings').delete().eq('work_order_id', id).neq('id', b.id)
    await supabase.from('work_orders').delete().eq('id', id)
  }
  await supabase.from('srs_log').delete().eq('booking_id', b.id)
  await supabase.from('bookings').delete().eq('id', b.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteWorkOrderEverywhere — the billing hub's Delete WO (Eli-only, 2026-09-16).
// The same teardown as deleteSessionAndWO, keyed on the WORK ORDER: every
// line item, every booking card that points at it (primary and siblings),
// their SRS log rows, then the WO. wo_expenses / wo_activity /
// wo_rate_bundles / bookings.work_order_id all cascade from the WO row; the
// explicit deletes are belt+braces for legacy rows. Returns false on the
// first failure so the caller can say so — nothing here is silent.
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteWorkOrderEverywhere(woId: string): Promise<{ ok: boolean; reason?: string }> {
  const { data: wo, error: wErr } = await supabase.from('work_orders').select('booking_id').eq('id', woId).limit(1)
  if (wErr) return { ok: false, reason: wErr.message }
  const { data: cards, error: cErr } = await supabase.from('bookings').select('id').eq('work_order_id', woId)
  if (cErr) return { ok: false, reason: cErr.message }
  const bookingIds = Array.from(new Set([...(cards ?? []).map(c => c.id), wo?.[0]?.booking_id].filter(Boolean) as string[]))

  const step = async (what: string, q: PromiseLike<{ error: { message: string } | null }>): Promise<string | null> => {
    const { error } = await q
    return error ? `${what}: ${error.message}` : null
  }
  // In order, stopping at the first failure — the WO row goes LAST, so a
  // failed child delete never leaves a headless set of rows behind.
  const plan: Array<[string, () => PromiseLike<{ error: { message: string } | null }>]> = [
    ['studio time', () => supabase.from('studio_time_rows').delete().eq('work_order_id', woId)],
    ['equipment', () => supabase.from('equipment_condition_rows').delete().eq('work_order_id', woId)],
    ['equipment notes', () => supabase.from('equipment_condition_notes').delete().eq('work_order_id', woId)],
    ['rentals', () => supabase.from('rental_rows').delete().eq('work_order_id', woId)],
    ['payments', () => supabase.from('payment_rows').delete().eq('work_order_id', woId)],
    ...(bookingIds.length ? [
      ['SRS log', () => supabase.from('srs_log').delete().in('booking_id', bookingIds)] as [string, () => PromiseLike<{ error: { message: string } | null }>],
      ['booking cards', () => supabase.from('bookings').delete().in('id', bookingIds)] as [string, () => PromiseLike<{ error: { message: string } | null }>],
    ] : []),
    ['work order', () => supabase.from('work_orders').delete().eq('id', woId)],
  ]
  for (const [what, fn] of plan) {
    const fail = await step(what, fn())
    if (fail) return { ok: false, reason: fail }
  }
  return { ok: true }
}
