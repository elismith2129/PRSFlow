-- Real-time publication migration for the full real-time fix pass.
-- Adds every table that list/detail views subscribe to (via postgres_changes)
-- to the supabase_realtime publication, and sets REPLICA IDENTITY FULL so the
-- full row ships on UPDATE/DELETE (Postgres only ships PK columns by default,
-- which breaks filtered subscriptions like work_order_id=eq.X).
--
-- Run ONCE in the Supabase SQL editor. Claude has no DDL access, so this is a
-- manual step and must be run BEFORE the subscription code deploys — a channel
-- on an unpublished table connects (SUBSCRIBED) but never fires events.
--
-- Already published (do NOT re-add — ADD TABLE errors if the table is already a
-- member): bookings, work_orders, studio_time_rows, equipment_condition_rows,
-- equipment_condition_notes, leads.
--
-- Intentionally OMITTED — these two relations do not exist in this database
-- (verified via anon REST probe; PGRST205 table-not-found). They are read by code
-- with a silent fallback, so nothing is published/subscribed for them:
--   * stock_items    — never created here; runner stock page falls back to DEFAULT_ITEMS.
--   * mic_inventory  — legacy table, superseded by mics/mic_checkins; read by DailyOpsModal only.
-- (Creating them is a separate data-model decision, out of scope for this realtime pass.)

-- Add all tables to supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE flags;
ALTER PUBLICATION supabase_realtime ADD TABLE flag_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE dashboard_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE dashboard_task_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE checklists;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_ops_submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE petty_cash_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE petty_cash_balances;
ALTER PUBLICATION supabase_realtime ADD TABLE mics;
ALTER PUBLICATION supabase_realtime ADD TABLE mic_checkins;
ALTER PUBLICATION supabase_realtime ADD TABLE mic_inventory_quantities;
ALTER PUBLICATION supabase_realtime ADD TABLE mic_inventory_submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE rental_rows;
ALTER PUBLICATION supabase_realtime ADD TABLE payment_rows;
ALTER PUBLICATION supabase_realtime ADD TABLE clients;
ALTER PUBLICATION supabase_realtime ADD TABLE client_contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE engineers;
ALTER PUBLICATION supabase_realtime ADD TABLE srs_log;

-- Set REPLICA IDENTITY FULL on all newly added tables
ALTER TABLE flags REPLICA IDENTITY FULL;
ALTER TABLE flag_comments REPLICA IDENTITY FULL;
ALTER TABLE dashboard_tasks REPLICA IDENTITY FULL;
ALTER TABLE dashboard_task_comments REPLICA IDENTITY FULL;
ALTER TABLE checklists REPLICA IDENTITY FULL;
ALTER TABLE daily_ops_submissions REPLICA IDENTITY FULL;
ALTER TABLE petty_cash_entries REPLICA IDENTITY FULL;
ALTER TABLE petty_cash_balances REPLICA IDENTITY FULL;
ALTER TABLE mics REPLICA IDENTITY FULL;
ALTER TABLE mic_checkins REPLICA IDENTITY FULL;
ALTER TABLE mic_inventory_quantities REPLICA IDENTITY FULL;
ALTER TABLE mic_inventory_submissions REPLICA IDENTITY FULL;
ALTER TABLE rental_rows REPLICA IDENTITY FULL;
ALTER TABLE payment_rows REPLICA IDENTITY FULL;
ALTER TABLE clients REPLICA IDENTITY FULL;
ALTER TABLE client_contacts REPLICA IDENTITY FULL;
ALTER TABLE engineers REPLICA IDENTITY FULL;
ALTER TABLE srs_log REPLICA IDENTITY FULL;
