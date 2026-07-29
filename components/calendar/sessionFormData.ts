// ─────────────────────────────────────────────────────────────────────────────
// Session form-data shape + builders.
//
// Extracted from BookingForm.tsx when the form itself was deleted (WO rebuild
// Step 8, July 28, 2026). These survive because the calendar's WO-first flow
// still uses them: `emptyForm()` seeds a new session's booking payload
// (createBookingAndOpenWO → buildBookingPayload) and `bookingToForm()` maps a
// bookings row back into that shape.
// ─────────────────────────────────────────────────────────────────────────────
import type { Booking } from '@/lib/supabase'

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type FormData = {
  status: string; session_type: string; payment_type: string; cod_method: string
  location: string; studio: string; start_date: string; end_date: string
  from_time: string; to_time: string; rate: string; rate_daily: string; rate_type: 'hourly' | 'daily'; invoice_num: string
  client_name: string; artist: string; label: string; ordered_by: string
  phone: string; email: string; po: string; producer: string
  food_budget: boolean; food_amount: string
  engineer_name: string; engineer_rate: string; engineer_status: string
  assistant_name: string; assistant_status: string
  notes: string
  client_db_id: string | null
  is_srs: boolean
  anr_contact_id: string | null
  anr_admin_contact_id: string | null
}

export function emptyForm(overrides: Partial<FormData> = {}): FormData {
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<FormData>
  return {
    status: 'tentative', session_type: 'recording', payment_type: 'COD', cod_method: '',
    location: '', studio: '',
    start_date: fmt(new Date()), end_date: fmt(new Date()),
    from_time: '', to_time: '', rate: '', rate_daily: '', rate_type: 'hourly', invoice_num: '',
    client_name: '', artist: '', label: '', ordered_by: '',
    phone: '', email: '', po: '', producer: '',
    food_budget: false, food_amount: '',
    engineer_name: '', engineer_rate: '', engineer_status: 'not_needed',
    assistant_name: '', assistant_status: 'not_needed',
    notes: '',
    client_db_id: null,
    is_srs: false,
    anr_contact_id: null,
    anr_admin_contact_id: null,
    ...clean,
  }
}

export function bookingToForm(b: Booking): FormData {
  return {
    status: b.status, session_type: b.session_type, payment_type: b.payment_type,
    cod_method: b.cod_method ?? '',
    location: b.location, studio: b.studio,
    start_date: b.start_date, end_date: b.end_date,
    from_time: b.from_time ?? '', to_time: b.to_time ?? '',
    rate: b.rate ?? '', rate_daily: b.rate_daily ?? '',
    rate_type: b.rate_type === 'day' ? 'daily' : b.rate_type === 'hour' ? 'hourly' : (b.rate_daily ? 'daily' : 'hourly'),
    invoice_num: b.invoice_num ?? '',
    client_name: b.client_name ?? '', artist: b.artist ?? '', label: b.label ?? '',
    ordered_by: b.ordered_by ?? '', phone: b.phone ?? '', email: b.email ?? '',
    po: b.po ?? '', producer: b.producer ?? '',
    food_budget: b.food_budget ?? false, food_amount: b.food_amount ?? '',
    engineer_name: b.engineer_name ?? '', engineer_rate: b.engineer_rate ?? '', engineer_status: b.engineer_status ?? 'not_needed',
    assistant_name: b.assistant_name ?? '', assistant_status: b.assistant_status ?? 'not_needed',
    notes: b.notes ?? '',
    client_db_id: b.client_id ?? null,
    is_srs: b.is_srs ?? false,
    anr_contact_id: b.anr_contact_id ?? null,
    anr_admin_contact_id: b.anr_admin_contact_id ?? null,
  }
}
