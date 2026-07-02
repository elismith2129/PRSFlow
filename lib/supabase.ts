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
  rate_daily: string | null
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
  updated_at: string | null
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
  srs_client: boolean
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

export interface WorkOrderLegacy {
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
  id: string
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
  rate_type: 'day' | 'hour' | null
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
  engineer_rate: string | null
  engineer_status: EngineerStatus
  assistant_name: string | null
  assistant_status: EngineerStatus
  notes: string | null
  is_srs: boolean
  srs_fee_amount: number | null
  anr_contact_id: string | null
  anr_admin_contact_id: string | null
  created_at: string
  updated_at: string | null
}

export interface WorkOrder {
  id: string
  booking_id: string | null
  invoice_number: string | null
  session_date: string | null
  studios: string[] | null
  from_time: string | null
  to_time: string | null
  engineer: string | null
  second_engineer: string | null
  producer: string | null
  payment_status: string | null
  food_budget: boolean
  food_amount: number | null
  client: string | null
  artist: string | null
  label: string | null
  ordered_by: string | null
  po_number: string | null
  phone: string | null
  email: string | null
  status: string
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  session_notes: string | null
  legal_signature: string | null
  legal_name: string | null
  legal_date: string | null
  needs_attention_notes: string | null
  runner_finished: boolean
  runner_finished_at: string | null
  admin_approved: boolean
  admin_approved_at: string | null
  created_at: string
  updated_at: string | null
}

export interface StudioTimeRow {
  id: string
  work_order_id: string
  studio: string | null
  date: string | null
  session_info: string | null
  from_time: string | null
  to_time: string | null
  total_hours: number | null
  rate: string | null
  charge: number | null
  sort_order: number
  admin_checked: boolean | null
  admin_locked: boolean | null
  eng_visible: boolean | null
}

export interface EquipmentConditionRow {
  id: string
  work_order_id: string
  equipment: string | null
  date: string | null
  condition: 'ok' | 'not_ok' | null
}

export interface RentalRow {
  id: string
  work_order_id: string
  qty: number | null
  item: string | null
  supplier: string | null
  dates_used: string | null
  rate: string | null
  charge: number | null
  sort_order: number
}

export interface PaymentRow {
  id: string
  work_order_id: string
  payment_type: string | null
  amount: number | null
  recorded_at: string
}

export interface ExpenseRow {
  id: string
  work_order_id: string
  vendor: string | null
  item: string | null
  amount: number | null
  receipt_url: string | null
  ocr_raw: string | null
  submitted_by: string | null
  created_at: string
}

export interface DashboardTask {
  id: string
  text: string
  assigned_role: 'admin' | 'studio_manager' | 'asst_manager' | 'billing'
  assigned_to: string | null
  assigned_by: string | null
  completed: boolean
  completed_at: string | null
  completed_note: string | null
  created_by: string | null
  source: 'manual' | 'runner_flag' | 'wo_flag'
  source_id: string | null
  source_label: string | null
  due_date: string | null
  photo_url: string | null
  sort_order: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface DashboardTaskComment {
  id: string
  task_id: string
  text: string | null
  photo_url: string | null
  created_by_name: string | null
  created_at: string
}

export interface UserProfile {
  id: string
  auth_user_id: string | null
  email: string
  display_name: string
  initials?: string | null
  role: 'owner' | 'manager' | 'billing' | 'asst_manager' | 'tech'
  created_at: string
  updated_at: string | null
  deleted_at: string | null
}

export interface Flag {
  id: string
  studio: string
  source: 'runner_flag' | 'wo_flag' | 'manual'
  source_id: string | null
  source_label: string | null
  runner_note: string | null
  category: 'facility_general' | 'gear_equipment' | 'client_billing' | null
  status: 'pending' | 'acknowledged' | 'resolved'
  acknowledged_by: string | null
  acknowledged_at: string | null
  acknowledged_note: string | null
  resolved_by: string | null
  resolved_at: string | null
  resolved_note: string | null
  resolved_vendor: string | null
  resolved_cost: number | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface FlagComment {
  id: string
  flag_id: string
  text: string | null
  photo_url: string | null
  created_by_name: string | null
  created_at: string
}
