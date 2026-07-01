-- Enable Supabase Realtime for the `leads` table so the Web Inquiry notification
-- system (pulse glow + tab badge + toast) receives INSERT/UPDATE events.
--
-- Run once in the Supabase SQL editor. Claude has no DDL access, so this is a
-- manual step. Until it is run, realtime events will NOT fire; the mount-time
-- hydration in WebInquiryProvider still surfaces existing unaddressed inquiries
-- (so the pulse/badge work on load/refresh), but live pop-in toasts won't appear.
--
-- REPLICA IDENTITY FULL makes the full row available on UPDATE/DELETE (Postgres
-- only ships PK columns by default), matching the project's realtime convention
-- for bookings / work_orders / studio_time_rows / equipment_condition_rows.

alter publication supabase_realtime add table leads;
alter table leads replica identity full;
