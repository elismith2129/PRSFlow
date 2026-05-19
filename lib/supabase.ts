import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// Types
export type LeadStatus = 'hot' | 'warm' | 'cold' | 'uncontacted' | 'booked' | 'dead'
export type BillingType = 'COD' | 'Billing'
export type BookingType = 'Recording Session' | 'Filming' | 'Event/Playback'
export type ClientType = 'individual' | 'label' | 'company'

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
  created_at: string
}

export interface Client {
  id: number
  type: ClientType
  fname: string
  lname: string
  company: string
  label: string
  email: string
  phone: string
  billing: BillingType
  notes: string
  source: string
  booking: string
  artists: string[]
  lead_id: number | null
  created_at: string
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
