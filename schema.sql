-- PRSFlow Database Schema
-- Run this in your Supabase SQL editor

-- LEADS table
create table if not exists leads (
  id bigserial primary key,
  fname text,
  lname text,
  company text,
  label text,
  email text,
  phone text,
  source text,
  booking text,
  status text default 'uncontacted',
  billing text default 'COD',
  notes text,
  quote text,
  rate_daily text,
  location text,
  session_date text,
  duration text,
  first_time boolean default false,
  last_contact text,
  created_at timestamptz default now()
);

-- CLIENTS table
create table if not exists clients (
  id bigserial primary key,
  type text default 'individual',
  fname text,
  lname text,
  company text,
  label text,
  email text,
  phone text,
  billing text default 'COD',
  notes text,
  source text,
  booking text,
  artists jsonb default '[]',
  lead_id bigint references leads(id),
  created_at timestamptz default now()
);

-- WORK_ORDERS table
create table if not exists work_orders (
  id bigserial primary key,
  client_id bigint references clients(id),
  invoice_num text,
  session_date text,
  location text,
  from_time text,
  to_time text,
  engineer text,
  engineer2 text,
  producer text,
  studios text,
  food_budget text,
  food_amt text,
  client_name text,
  artist text,
  label text,
  ordered_by text,
  po text,
  phone text,
  email text,
  payment_status text default 'COD',
  studio_rows jsonb default '[]',
  rental_rows jsonb default '[]',
  payment_rows jsonb default '[]',
  notes text,
  total text,
  deposit text,
  total_paid text,
  balance text,
  eq_speakers text,
  eq_microphone text,
  eq_console text,
  sig_name text,
  sig_date text,
  created_at timestamptz default now()
);

-- BOOKINGS table (added incrementally — see migration notes)
-- Key columns added after initial schema:
--   anr_contact_id        text  (FK → client_contacts.id, nullable) — A&R contact for this booking
--   anr_admin_contact_id  text  (FK → client_contacts.id, nullable) — Admin/billing contact for this booking
-- Migration: ALTER TABLE bookings ADD COLUMN IF NOT EXISTS anr_contact_id text;
--            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS anr_admin_contact_id text;

-- CLIENT_CONTACTS table (added after initial schema)
-- create table if not exists client_contacts (
--   id uuid default gen_random_uuid() primary key,
--   client_id text references clients(id),
--   fname text, lname text, email text, phone text, instagram text,
--   role text, notes text, contact_type text,  -- 'anr' | 'admin'
--   artists jsonb default '[]',
--   phone_needs_review boolean default false,
--   created_at timestamptz default now()
-- );

-- QC_REPORTS table
create table if not exists qc_reports (
  id text primary key,
  location text,
  session_date text,
  from_time text,
  to_time text,
  staff text,
  client_name text,
  notes text,
  has_issue boolean default false,
  issue_notes text,
  issue_types jsonb default '[]',
  manager_read boolean default false,
  created_at timestamptz default now()
);

-- CONTACT_LOG table (for TODO cooldowns)
create table if not exists contact_log (
  id bigserial primary key,
  lead_id bigint references leads(id),
  client_id bigint,
  contacted_at timestamptz default now(),
  method text default 'email'
);

-- Enable Row Level Security (open for now, add auth later)
alter table leads enable row level security;
alter table clients enable row level security;
alter table work_orders enable row level security;
alter table qc_reports enable row level security;
alter table contact_log enable row level security;

-- Open policies (replace with auth policies when login is built)
create policy "Public access" on leads for all using (true) with check (true);
create policy "Public access" on clients for all using (true) with check (true);
create policy "Public access" on work_orders for all using (true) with check (true);
create policy "Public access" on qc_reports for all using (true) with check (true);
create policy "Public access" on contact_log for all using (true) with check (true);
