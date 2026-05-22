import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

export type LeadStatus = 'hot' | 'warm' | 'cold' | 'uncontacted' | 'booked' | 'dead'
export type BillingType = 'COD' | 'Billing'
export type BookingType = 'Recording Session' | 'Filming' | 'Event/Playback'
export type ClientType = 'label' | 'individual'

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  label: 'Label/Billing',
  individual: 'COD',
}

export interface Lead {
  id: number
  fname: string
  lname: string
  company: string
  label: string
  email: string
  phone: string
  source: string
  booking: BookingType | string
  status: LeadStatus
  billing: BillingType
  notes: string
  quote: string
  location: string
  session_date: string
  duration: string
  first_time: boolean
  last_contact: string
  keep_hot_until: string | null
  parked_until: string | null
  client_id: string | null
  artist_name: string | null
  anr_contact_id: string | null
  needs_contact: boolean | null
  contacted_at: string | null
  session_start: string | null
  session_end: string | null
  engineer_needed: boolean | null
  created_at: string
}

export interface Client {
  id: string
  type: ClientType
  name: string
  fname: string | null
  lname: string | null
  email: string | null
  phone: string | null
  instagram: string | null
  address_street: string | null
  address_street2: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  artists: string[]
  id_file_url: string | null
  signature_url: string | null
  terms_accepted: boolean | null
  terms_accepted_at: string | null
  how_heard: string | null
  registered_at: string | null
  source_lead_id: number | null
  notes: string | null
  created_at: string
  updated_at: string | null
}

export interface ClientContact {
  id: string
  client_id: string
  fname: string | null
  lname: string | null
  email: string | null
  phone: string | null
  instagram: string | null
  role: string | null
  notes: string | null
  contact_type: string | null
  artists: string[] | null
}

export interface WorkOrder {
  id: number
  client_id: number
  invoice_num: string
  session_date: string
  location: string
  from_time: string
  to_time: string
  engineer: string
  artist: string
  total: string
  balance: string
  payment_status: BillingType
  created_at: string
}

export interface RegistrationToken {
  id: string
  token: string
  lead_id: number | null
  client_id: string | null
  created_at: string
  expires_at: string
  used_at: string | null
  prefill_email: string | null
  prefill_name: string | null
  registration_reviewed: boolean | null
}

export interface QCReport {
  id: string
  location: string
  session_date: string
  staff: string
  client_name: string
  notes: string
  has_issue: boolean
  issue_notes: string
  manager_read: boolean
  created_at: string
}

export type EngineerRole = 'Engineer' | 'Assistant' | 'Both'

export interface Engineer {
  id: string
  first_name: string
  last_name: string
  role: EngineerRole
  initials: string | null
  email: string | null
  phone: string | null
  active: boolean
  created_at: string
}

export type BookingStatus = 'confirmed' | 'tentative' | 'cancelled' | 'tour' | 'tech' | 'open_hours'
export type SessionType = 'recording' | 'filming' | 'event_playback'
export type EngineerStatus = 'hold' | 'confirmed' | 'not_needed'

export interface Booking {
  id: number
  status: BookingStatus
  session_type: SessionType
  payment_type: string
  cod_method: string | null
  location: string
  studio: string
  start_date: string
  end_date: string
  from_time: string | null
  to_time: string | null
  rate: string | null
  rate_daily: string | null
  invoice_num: string | null
  client_id: string | null
  client_name: string | null
  artist: string | null
  label: string | null
  ordered_by: string | null
  phone: string | null
  email: string | null
  po: string | null
  producer: string | null
  food_budget: boolean
  food_amount: string | null
  engineer_name: string | null
  engineer_status: EngineerStatus
  assistant_name: string | null
  assistant_status: EngineerStatus
  notes: string | null
  created_at: string
  updated_at: string | null
}
