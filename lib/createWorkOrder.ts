import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { seedStudioTimeRows, dateRange, toStudioLetter } from '@/lib/seedStudioTimeRows'

// Equipment items seeded onto every work order (one condition row per item per date).
// Mirrors EQUIPMENT_ITEMS in WorkOrderPopup.tsx and EQUIPMENT in the runner WO page.
const EQUIPMENT_ITEMS = ['Speakers', 'Microphone', 'Console']

// Booking statuses that represent non-session blocks and must NOT get a work order.
// Recording / Filming / Event-Playback sessions get WOs; Tech / Tour / Open Hours
// (and cancelled-from-start bookings) do not.
// (These are status values, not session_type values — see lib/supabase.ts.)
const NON_SESSION_STATUSES = ['tour', 'tech', 'open_hours', 'cancelled']

/**
 * True when a booking should have a work order auto-created at save time.
 * Excludes Tech / Tour / Open Hours blocks and cancelled bookings (locked PRSFlo principle).
 */
export function bookingShouldHaveWorkOrder(booking: Pick<Booking, 'status'>): boolean {
  return !NON_SESSION_STATUSES.includes(booking.status)
}

// Row-generation + date/studio helpers live in lib/seedStudioTimeRows.ts
// (shared with the WO "Seed" panel) and are imported above.

/**
 * Canonical, single-source work-order creator. Called once at booking-save time.
 *
 * Inserts one work_orders row (idempotent via upsert on booking_id) and, when a
 * NEW row is created, seeds studio_time_rows (one per session date, with correct
 * day-rate vs hourly columns) and equipment_condition_rows (one per equipment
 * item per date). If a WO already exists for this booking, it is adopted and no
 * rows are re-seeded.
 *
 * Note: Supabase's anon REST client cannot wrap these inserts in a single SQL
 * transaction, so this is a sequential best-effort path, not an atomic one — any
 * error is thrown so the caller can surface it. (True atomicity would require a
 * Postgres function / RPC; out of scope here.)
 */
export async function createWorkOrderForBooking(booking: Booking): Promise<{ workOrderId: string }> {
  const studioLetter = booking.studio ? toStudioLetter(booking.studio) : ''

  const woPayload = {
    booking_id: booking.id,
    invoice_number: booking.invoice_num ?? '',
    session_date: booking.start_date,
    studios: studioLetter ? [studioLetter] : [],
    from_time: booking.from_time ?? '',
    to_time: booking.to_time ?? '',
    engineer: booking.engineer_name ?? '',
    second_engineer: booking.assistant_name ?? '',
    producer: booking.producer ?? '',
    payment_status: booking.payment_type === 'billing' ? 'Billing' : 'COD',
    food_budget: booking.food_budget ?? false,
    food_amount: booking.food_amount ? parseFloat(booking.food_amount) : null,
    client: booking.client_name ?? '',
    artist: booking.artist ?? '',
    label: booking.label ?? '',
    ordered_by: booking.ordered_by ?? '',
    po_number: booking.po ?? '',
    phone: booking.phone ?? '',
    email: booking.email ?? '',
    session_notes: booking.notes ?? '',
    status: 'open',
    // Session-level fields (added July 21, 2026) so a freshly-created WO opens
    // populated — status bar, session type, client link, SRS, COD, A&R.
    session_status: booking.status ?? 'tentative',
    session_type: booking.session_type ?? 'recording',
    client_id: booking.client_id || null,
    is_srs: booking.is_srs ?? false,
    cod_method: booking.cod_method || null,
    anr_contact_id: booking.anr_contact_id || null,
    anr_admin_contact_id: booking.anr_admin_contact_id || null,
  }

  // Idempotent create: ON CONFLICT (booking_id) DO NOTHING. A fresh insert returns
  // the new row; a conflict returns no row (we then look up the existing WO).
  const { data: created, error: woError } = await supabase
    .from('work_orders')
    .upsert(woPayload, { onConflict: 'booking_id', ignoreDuplicates: true })
    .select('id, wo_number')
    .maybeSingle()
  if (woError) {
    throw new Error(['work_orders create failed', woError.message, woError.details].filter(Boolean).join(' — '))
  }

  // Conflict path: a WO already exists for this booking — adopt it, seed nothing.
  if (!created?.id) {
    const { data: existing, error: lookupError } = await supabase
      .from('work_orders')
      .select('id, wo_number')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (lookupError) {
      throw new Error(['work_orders lookup failed', lookupError.message, lookupError.details].filter(Boolean).join(' — '))
    }
    if (!existing?.id) {
      throw new Error('work_orders create returned no row and none exists for booking ' + booking.id)
    }
    // Link the booking card to its WO (new relationship direction) + WO number.
    await supabase.from('bookings').update({ work_order_id: existing.id, wo_number: existing.wo_number ?? null }).eq('id', booking.id)
    return { workOrderId: existing.id }
  }

  const workOrderId = created.id
  // Link the booking card to its WO (new relationship direction) + WO number.
  await supabase.from('bookings').update({ work_order_id: workOrderId, wo_number: created.wo_number ?? null }).eq('id', booking.id)
  const dates = dateRange(booking.start_date, booking.end_date)
  const isDay = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)

  // Seed studio_time_rows — one per session date, with correct day-rate vs hourly
  // columns. Uses the shared generator (skipExisting:false — the WO was just
  // created, so no rows can exist yet, saving a pre-check round-trip).
  await seedStudioTimeRows(
    {
      workOrderId,
      studio: studioLetter || booking.studio || '',
      dates,
      fromTime: booking.from_time ?? '',
      toTime: booking.to_time ?? '',
      rateType: isDay ? 'day' : 'hour',
      rate: booking.rate ?? '',
      rateDaily: booking.rate_daily ?? '',
      sortOrderStart: 0,
    },
    { skipExisting: false },
  )

  // Seed equipment_condition_rows — one per equipment item per session date.
  const eqPayloads = dates.flatMap(d =>
    EQUIPMENT_ITEMS.map(eq => ({ work_order_id: workOrderId, equipment: eq, date: d, condition: null as string | null }))
  )
  if (eqPayloads.length > 0) {
    const { error: eqError } = await supabase.from('equipment_condition_rows').insert(eqPayloads)
    if (eqError) {
      throw new Error(['equipment_condition_rows seed failed', eqError.message, eqError.details].filter(Boolean).join(' — '))
    }
  }

  return { workOrderId }
}
