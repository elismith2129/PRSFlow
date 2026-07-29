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
