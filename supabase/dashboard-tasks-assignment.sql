-- Migration 2 — task assignment columns
-- Run this in the Supabase SQL editor (project ref: spdiovhicftbzsopynfo).
-- Run AFTER supabase/user_profiles.sql (these columns FK-reference user_profiles.id).
--
-- NOTE: The original request named a `tasks` table, but this app has no `tasks` table.
-- The live task table is `dashboard_tasks` (confirmed with the user). Columns are added there.
--
--   assigned_to — which user the task is for (null = unassigned / general)
--   assigned_by — which user created/assigned the task
--
-- Both reference user_profiles(id) (the stable surrogate PK from Migration 1).
-- Idempotent via ADD COLUMN IF NOT EXISTS; inherits dashboard_tasks' existing grants/RLS.

alter table dashboard_tasks add column if not exists assigned_to uuid references user_profiles(id);
alter table dashboard_tasks add column if not exists assigned_by uuid references user_profiles(id);
