import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { buildSeedRowPayloads, dateRange, toStudioLetter } from '@/lib/seedStudioTimeRows'

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
 * Inserts one work_orders row (idempotent on booking_id) and, when a NEW row is
 * created, seeds studio_time_rows (one per session date, with correct day-rate
 * vs hourly columns) and equipment_condition_rows (one per equipment item per
 * date). If a WO already exists for this booking, it is adopted and no rows are
 * re-seeded.
 *
 * ATOMIC (July 28, 2026 — audit Phase 1): the whole create runs inside the
 * `create_work_order_atomic` Postgres RPC (migration 20260728180000), so a
 * mid-sequence failure can no longer leave a WO without its seeded rows. All
 * VALUES are still computed here in TS — the row payloads come from the shared
 * buildSeedRowPayloads (lib/seedStudioTimeRows.ts), so there is no second copy
 * of the seeding logic; the RPC is a dumb all-or-nothing applier.
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

  const dates = dateRange(booking.start_date, booking.end_date)
  const isDay = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)

  // Seed payloads (values computed here, in the single-source builder). No
  // work_order_id yet — the RPC injects it after the WO insert. Only used by
  // the RPC when the WO is freshly created (adopt path seeds nothing).
  const stPayloads = buildSeedRowPayloads({
    studio: studioLetter || booking.studio || '',
    dates,
    fromTime: booking.from_time ?? '',
    toTime: booking.to_time ?? '',
    rateType: isDay ? 'day' : 'hour',
    rate: booking.rate ?? '',
    rateDaily: booking.rate_daily ?? '',
    sortOrderStart: 0,
    // Per-row staff seed: engineer (1ST) if the booking names one, else the
    // assistant (2ND) — so cards project initials from day one.
    engName: booking.engineer_name || booking.assistant_name || undefined,
    engRole: booking.engineer_name ? 'engineer' : (booking.assistant_name ? 'assistant' : undefined),
  })

  // Equipment condition rows — one per equipment item per session date.
  const eqPayloads = dates.flatMap(d =>
    EQUIPMENT_ITEMS.map(eq => ({ equipment: eq, date: d, condition: null as string | null }))
  )

  // One atomic call: WO insert (idempotent) + booking link + both seeds.
  const { data, error } = await supabase.rpc('create_work_order_atomic', {
    p_booking_id: booking.id,
    p_wo: woPayload,
    p_st_rows: stPayloads,
    p_equip: eqPayloads,
  })
  if (error) {
    throw new Error(['create_work_order_atomic failed', error.message, error.details].filter(Boolean).join(' — '))
  }
  const workOrderId = (data as any)?.work_order_id as string | undefined
  if (!workOrderId) {
    throw new Error('create_work_order_atomic returned no work_order_id for booking ' + booking.id)
  }
  return { workOrderId }
}
