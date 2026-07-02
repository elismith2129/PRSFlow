-- Migration — user_profiles.initials
-- Run this in the Supabase SQL editor (project ref: spdiovhicftbzsopynfo).
-- Run AFTER supabase/user_profiles.sql (adds the column to that table).
--
-- Adds a stored `initials` column and seeds the known staff values. Matching is
-- by display_name (ILIKE) — the reliable identifier here: the live roster is
-- keyed by display_name (dashboard task tabs resolve members by display_name),
-- and Sierra & Tom (added to the live DB after the original seed) have no emails
-- in supabase/user_profiles.sql. `initials` is nullable; the app falls back to
-- initials computed from display_name when it is null.

alter table user_profiles add column if not exists initials text;

update user_profiles set initials = 'ES' where display_name ilike '%Eli%';
update user_profiles set initials = 'FR' where display_name ilike '%Fernando%';
update user_profiles set initials = 'AA' where display_name ilike '%Aaron%';
update user_profiles set initials = 'AM' where display_name ilike '%Adam%' or display_name ilike '%Mike%';
update user_profiles set initials = 'IH' where display_name ilike '%Isaac%';
update user_profiles set initials = 'QC' where display_name ilike '%Quinn%';
update user_profiles set initials = 'TD' where display_name ilike '%Tom%';
update user_profiles set initials = 'SS' where display_name ilike '%Sierra%';
