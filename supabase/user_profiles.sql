-- Migration 1 — user_profiles
-- Run this in the Supabase SQL editor (project ref: spdiovhicftbzsopynfo).
-- Run BEFORE supabase/dashboard-tasks-assignment.sql (that migration FK-references this table).
--
-- DEVIATION FROM THE ORIGINAL SPEC (intentional, documented):
--   The requested schema used `id uuid primary key references auth.users(id)`, but the
--   seed must insert 6 staff rows NOW, before any auth.users accounts exist. A primary key
--   cannot be NULL and a fabricated UUID would violate the auth.users foreign key, so the
--   table + seed as originally written cannot both run clean.
--
--   Resolution that preserves the stated intent ("seed by email now, link UUIDs after invites"):
--     * `id`           — stable surrogate PK (default gen_random_uuid()); what dashboard_tasks
--                        assignment columns reference, so those FKs are valid immediately.
--     * `auth_user_id` — nullable link to auth.users(id) ON DELETE CASCADE; populate this per
--                        user after invites go out (matches the original cascade-on-auth-delete intent).
--     * `email`        — NOT NULL UNIQUE; the temporary lookup key used to match rows to auth
--                        accounts when you backfill auth_user_id.
--
-- RLS: left DISABLED for now per instruction (Chunk 9 will add auth + policies).
-- GRANT per the post-May-2026 Supabase Data API policy (required for anon/authenticated access).

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null default 'staff' check (role in ('owner', 'manager', 'asst_manager', 'staff')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz default null
);

-- Seed the 6 known staff members by email (auth_user_id backfilled after invites go out).
-- Idempotent: re-running leaves existing rows untouched.
insert into user_profiles (email, display_name, role) values
  ('eli@paramountrecording.com',        'Eli',       'owner'),
  ('fernando@paramountrecording.com',   'Fernando',  'manager'),
  ('aaron@paramountrecording.com',      'Aaron',     'manager'),
  ('quinncassellmusic@gmail.com',       'Quinn',     'asst_manager'),
  ('isaacherrera24@yahoo.com',          'Isaac',     'asst_manager'),
  ('adam-mike@paramountrecording.com',  'Adam-Mike', 'asst_manager')
on conflict (email) do nothing;

-- Required for the app's anon-key access (and authenticated once Chunk 9 lands).
grant select, insert, update, delete on user_profiles to anon, authenticated;
