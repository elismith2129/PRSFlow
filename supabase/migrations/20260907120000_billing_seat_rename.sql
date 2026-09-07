-- Billing seat rename (Eli, 2026-09-07): "remove Aaron's name from everywhere.
-- just change it to Billing." Aaron left (v1.19.1); the seat is a ROLE until a
-- rehire. Every surface that shows the seat's name reads user_profiles.display_name
-- (fetchStaffGrid, dashboard view-as / queue tabs, task tabs via TAB_DEFS names,
-- briefings) — so one rename here fixes them all. lib/tasks.ts matches
-- 'Billing' (with an 'Aaron' fallback) and assigns to primaryName 'Billing'
-- from the same release.
--
-- When someone is hired into the seat, set display_name to their real name and
-- update TAB_DEFS/ASSIGN_OPTIONS in lib/tasks.ts to match.

update user_profiles
set display_name = 'Billing', updated_at = now()
where role = 'billing' and deleted_at is null;
