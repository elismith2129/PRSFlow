import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

export type LeadStatus = 'hot' | 'warm' | 'cold' | 'uncontacted' | 'booked' | 'dead'
export type BillingType = 'COD' | 'Billing'
export type BookingType = 'Recording Session' | 'Filming' | 'Event/Playback'
export type ClientType = 'label' | 'individual'

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  label: 'Label',
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
  created_at: string
  expires_at: string
  used_at: string | null
  prefill_email: string | null
  prefill_name: string | null
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
