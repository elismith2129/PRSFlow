import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'

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

// ─── Local helpers (canonical copies; mirror WorkOrderPopup.tsx) ───────────────

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
  if (diff <= 0) diff += 24 * 60  // overnight session or same time → wrap to next day
  if (diff >= 24 * 60) return null  // exact 24h means same start/end time, skip
  return parseFloat((diff / 60).toFixed(2))
}

function calcCharge(hours: number | null, rate: string): number | null {
  if (!hours || !rate) return null
  const r = parseFloat(rate.replace(/[^0-9.]/g, ''))
  if (isNaN(r) || r === 0) return null
  return parseFloat((hours * r).toFixed(2))
}

function dateRange(start: string, end: string): string[] {
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

// "Studio A" → "A", "Studio X" → "X", "North" → "North"
function toStudioLetter(s: string): string {
  const m = s.match(/Studio\s+([A-Z])/i)
  return m ? m[1].toUpperCase() : s.trim()
}

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
  }

  // Idempotent create: ON CONFLICT (booking_id) DO NOTHING. A fresh insert returns
  // the new row; a conflict returns no row (we then look up the existing WO).
  const { data: created, error: woError } = await supabase
    .from('work_orders')
    .upsert(woPayload, { onConflict: 'booking_id', ignoreDuplicates: true })
    .select('id')
    .maybeSingle()
  if (woError) {
    throw new Error(['work_orders create failed', woError.message, woError.details].filter(Boolean).join(' — '))
  }

  // Conflict path: a WO already exists for this booking — adopt it, seed nothing.
  if (!created?.id) {
    const { data: existing, error: lookupError } = await supabase
      .from('work_orders')
      .select('id')
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
    return { workOrderId: existing.id }
  }

  const workOrderId = created.id
  const dates = dateRange(booking.start_date, booking.end_date)
  const isDay = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)

  // Seed studio_time_rows — one per session date, with correct day-rate vs hourly columns.
  const stPayloads = dates.map((d, i) => {
    if (isDay) {
      const dayRateNum = parseFloat((booking.rate_daily ?? '').replace(/[^0-9.]/g, ''))
      return {
        work_order_id: workOrderId,
        studio: studioLetter || booking.studio || '',
        date: d,
        session_info: '',
        from_time: booking.from_time ?? '',
        to_time: booking.to_time ?? '',
        total_hours: null,
        rate: booking.rate_daily ?? '',
        rate_daily: booking.rate_daily ?? '',
        row_rate_type: 'day',
        charge: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum : null,
        day_count: 1,
        ot_rate: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum / 10 : null,
        sort_order: i,
      }
    }
    const hrs = calcHours(booking.from_time ?? '', booking.to_time ?? '')
    return {
      work_order_id: workOrderId,
      studio: studioLetter || booking.studio || '',
      date: d,
      session_info: '',
      from_time: booking.from_time ?? '',
      to_time: booking.to_time ?? '',
      total_hours: hrs,
      rate: booking.rate ?? '',
      row_rate_type: 'hour',
      charge: calcCharge(hrs, booking.rate ?? ''),
      ot_rate: parseFloat((booking.rate ?? '').replace(/[^0-9.]/g, '')) || null,
      sort_order: i,
    }
  })
  if (stPayloads.length > 0) {
    const { error: stError } = await supabase.from('studio_time_rows').insert(stPayloads)
    if (stError) {
      throw new Error(['studio_time_rows seed failed', stError.message, stError.details].filter(Boolean).join(' — '))
    }
  }

  // Seed equipment_condition_rows — one per equipment item per session date.
  const eqPayloads = dates.flatMap(d =>
    EQUIPMENT_ITEMS.map(eq => ({ work_order_id: workOrderId, equipment: eq, date: d, condition: null }))
  )
  if (eqPayloads.length > 0) {
    const { error: eqError } = await supabase.from('equipment_condition_rows').insert(eqPayloads)
    if (eqError) {
      throw new Error(['equipment_condition_rows seed failed', eqError.message, eqError.details].filter(Boolean).join(' — '))
    }
  }

  return { workOrderId }
}
