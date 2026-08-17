-- ═══════════════════════════════════════════════════════════════════════════
-- LAUNCH RESET — one-off, 2026-08-17 (NOT a schema migration; changes no
-- structure, only rows). Run once in the Supabase SQL editor at go-live.
--
-- WHAT IT DOES
--   Wipes operational/test data so the app launches clean:
--     · My Day entries, queue-step ticks, notes — and RE-ANCHORS every duty
--       (created_at = now()) so backlog/overdue scans start today and the
--       Flo box opens with zero history-based red, by construction
--       (lib/myday.ts clamps every retrospective judgement to created_at).
--     · Flags + flag comments, shift logs, punch reports, studio tasks.
--     · Checklists, daily-ops submissions + reviews, petty cash, nightly
--       mic data (check-ins / quantities / submissions).
--     · ALL bookings + work orders and every line item under them
--       (Eli's ruling 2026-08-17: everything in there is test data).
--
-- WHAT IT NEVER TOUCHES
--   CRM: leads, clients, client_contacts, lead_activity, contact_log,
--   registration_tokens. Also kept: dashboard_tasks (+comments) by ruling,
--   the mics catalog, stock_items, engineers, user_profiles/auth, the
--   myday_duties templates themselves (re-anchored, not deleted).
--
-- DELIBERATE LEFTOVERS (harmless, clean up later if wanted):
--   · Storage buckets (receipts, invoices, checklist-photos) keep their
--     files — orphaned once rows are gone, referenced by nothing.
--   · app_errors / app_feedback / test_results stay (diagnostics + dev).
--   · Dashboard tasks that originated from a flag stay as standalone tasks.
--
-- ORDER MATTERS in the sessions block: line items first, then work_orders
-- (bookings.work_order_id is ON DELETE CASCADE, so linked booking cards go
-- with their WO), then remaining bookings — never bookings before WOs,
-- because work_orders.booking_id would block it.
--
-- VERIFY: the final SELECT is the proof. Every "wipe" row must read
-- '✓ wiped'; every "keep" row must read '✓ untouched'. Any ✗ means STOP
-- and tell Claude/Eli before letting anyone use the app.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── Snapshot BEFORE counts (for the verification at the end) ───────────────
create temp table _reset_before (t text primary key, n bigint);
insert into _reset_before
  select 'myday_entries', count(*) from myday_entries union all
  select 'myday_queue_steps', count(*) from myday_queue_steps union all
  select 'myday_notes', count(*) from myday_notes union all
  select 'flag_comments', count(*) from flag_comments union all
  select 'flags', count(*) from flags union all
  select 'shift_log_entries', count(*) from shift_log_entries union all
  select 'punch_correction_requests', count(*) from punch_correction_requests union all
  select 'studio_tasks', count(*) from studio_tasks union all
  select 'checklists', count(*) from checklists union all
  select 'daily_ops_submissions', count(*) from daily_ops_submissions union all
  select 'daily_ops_reviews', count(*) from daily_ops_reviews union all
  select 'petty_cash_entries', count(*) from petty_cash_entries union all
  select 'petty_cash_balances', count(*) from petty_cash_balances union all
  select 'mic_checkins', count(*) from mic_checkins union all
  select 'mic_inventory_quantities', count(*) from mic_inventory_quantities union all
  select 'mic_inventory_submissions', count(*) from mic_inventory_submissions union all
  select 'srs_log', count(*) from srs_log union all
  select 'qc_reports', count(*) from qc_reports union all
  select 'expense_rows', count(*) from expense_rows union all
  select 'studio_time_rows', count(*) from studio_time_rows union all
  select 'equipment_condition_rows', count(*) from equipment_condition_rows union all
  select 'equipment_condition_notes', count(*) from equipment_condition_notes union all
  select 'rental_rows', count(*) from rental_rows union all
  select 'payment_rows', count(*) from payment_rows union all
  select 'work_orders', count(*) from work_orders union all
  select 'bookings', count(*) from bookings union all
  -- kept
  select 'leads', count(*) from leads union all
  select 'clients', count(*) from clients union all
  select 'client_contacts', count(*) from client_contacts union all
  select 'lead_activity', count(*) from lead_activity union all
  select 'contact_log', count(*) from contact_log union all
  select 'registration_tokens', count(*) from registration_tokens union all
  select 'dashboard_tasks', count(*) from dashboard_tasks union all
  select 'dashboard_task_comments', count(*) from dashboard_task_comments union all
  select 'mics', count(*) from mics union all
  select 'stock_items', count(*) from stock_items union all
  select 'engineers', count(*) from engineers union all
  select 'user_profiles', count(*) from user_profiles union all
  select 'myday_duties', count(*) from myday_duties;

-- ─── 1 · My Day — entries out, templates re-anchored ────────────────────────
delete from myday_entries;
delete from myday_queue_steps;
delete from myday_notes;
-- The re-anchor. lib/myday.ts bounds every retrospective judgement
-- (computeBacklog, computeOverdueSince, the 14-day grid, missed-yesterday)
-- to the duty's created_at — so setting it to now() means day one renders
-- no history-based red, and the first briefing is queues + "Fresh start".
update myday_duties set created_at = now();

-- ─── 2 · Flags, shift logs, punch reports, studio tasks ─────────────────────
delete from flag_comments;
delete from flags;
delete from shift_log_entries;
delete from punch_correction_requests;
delete from studio_tasks;

-- ─── 3 · Nightly ops paperwork ──────────────────────────────────────────────
delete from checklists;
delete from daily_ops_submissions;
delete from daily_ops_reviews;
delete from petty_cash_entries;
delete from petty_cash_balances;
delete from mic_checkins;              -- the mics CATALOG (mics) is kept
delete from mic_inventory_quantities;
delete from mic_inventory_submissions;

-- ─── 4 · Sessions: every booking + work order (all test data, ruling) ───────
-- Line items and per-session records first…
delete from srs_log;
delete from qc_reports;
delete from expense_rows;
delete from studio_time_rows;
delete from equipment_condition_rows;
delete from equipment_condition_notes;
delete from rental_rows;
delete from payment_rows;
-- …then work orders (cascades their linked booking cards)…
delete from work_orders;
-- …then whatever bookings remain (legacy rows with no WO link).
delete from bookings;

commit;

-- ─── VERIFICATION — the end state, not the artifact ─────────────────────────
-- Every 'wipe' row must be '✓ wiped'. Every 'keep' row must be '✓ untouched'
-- (and CRM counts should look like the numbers you know: leads, clients…).
-- The last row shows the My Day anchor — it must be today's date.
with now_counts (t, n) as (
  select 'myday_entries', count(*) from myday_entries union all
  select 'myday_queue_steps', count(*) from myday_queue_steps union all
  select 'myday_notes', count(*) from myday_notes union all
  select 'flag_comments', count(*) from flag_comments union all
  select 'flags', count(*) from flags union all
  select 'shift_log_entries', count(*) from shift_log_entries union all
  select 'punch_correction_requests', count(*) from punch_correction_requests union all
  select 'studio_tasks', count(*) from studio_tasks union all
  select 'checklists', count(*) from checklists union all
  select 'daily_ops_submissions', count(*) from daily_ops_submissions union all
  select 'daily_ops_reviews', count(*) from daily_ops_reviews union all
  select 'petty_cash_entries', count(*) from petty_cash_entries union all
  select 'petty_cash_balances', count(*) from petty_cash_balances union all
  select 'mic_checkins', count(*) from mic_checkins union all
  select 'mic_inventory_quantities', count(*) from mic_inventory_quantities union all
  select 'mic_inventory_submissions', count(*) from mic_inventory_submissions union all
  select 'srs_log', count(*) from srs_log union all
  select 'qc_reports', count(*) from qc_reports union all
  select 'expense_rows', count(*) from expense_rows union all
  select 'studio_time_rows', count(*) from studio_time_rows union all
  select 'equipment_condition_rows', count(*) from equipment_condition_rows union all
  select 'equipment_condition_notes', count(*) from equipment_condition_notes union all
  select 'rental_rows', count(*) from rental_rows union all
  select 'payment_rows', count(*) from payment_rows union all
  select 'work_orders', count(*) from work_orders union all
  select 'bookings', count(*) from bookings union all
  select 'leads', count(*) from leads union all
  select 'clients', count(*) from clients union all
  select 'client_contacts', count(*) from client_contacts union all
  select 'lead_activity', count(*) from lead_activity union all
  select 'contact_log', count(*) from contact_log union all
  select 'registration_tokens', count(*) from registration_tokens union all
  select 'dashboard_tasks', count(*) from dashboard_tasks union all
  select 'dashboard_task_comments', count(*) from dashboard_task_comments union all
  select 'mics', count(*) from mics union all
  select 'stock_items', count(*) from stock_items union all
  select 'engineers', count(*) from engineers union all
  select 'user_profiles', count(*) from user_profiles union all
  select 'myday_duties', count(*) from myday_duties
),
expectations (t, kind) as (
  values
    ('myday_entries','wipe'), ('myday_queue_steps','wipe'), ('myday_notes','wipe'),
    ('flag_comments','wipe'), ('flags','wipe'), ('shift_log_entries','wipe'),
    ('punch_correction_requests','wipe'), ('studio_tasks','wipe'),
    ('checklists','wipe'), ('daily_ops_submissions','wipe'), ('daily_ops_reviews','wipe'),
    ('petty_cash_entries','wipe'), ('petty_cash_balances','wipe'),
    ('mic_checkins','wipe'), ('mic_inventory_quantities','wipe'), ('mic_inventory_submissions','wipe'),
    ('srs_log','wipe'), ('qc_reports','wipe'), ('expense_rows','wipe'),
    ('studio_time_rows','wipe'), ('equipment_condition_rows','wipe'), ('equipment_condition_notes','wipe'),
    ('rental_rows','wipe'), ('payment_rows','wipe'), ('work_orders','wipe'), ('bookings','wipe'),
    ('leads','keep'), ('clients','keep'), ('client_contacts','keep'),
    ('lead_activity','keep'), ('contact_log','keep'), ('registration_tokens','keep'),
    ('dashboard_tasks','keep'), ('dashboard_task_comments','keep'),
    ('mics','keep'), ('stock_items','keep'), ('engineers','keep'),
    ('user_profiles','keep'), ('myday_duties','keep')
)
select e.kind, e.t as table_name, b.n as before_rows, c.n as now_rows,
       case
         when e.kind = 'wipe' and c.n = 0 then '✓ wiped'
         when e.kind = 'wipe' then '✗ STILL HAS ROWS — stop, do not launch'
         when c.n = b.n then '✓ untouched'
         else '✗ CHANGED — stop, investigate'
       end as status
from expectations e
join now_counts c on c.t = e.t
left join _reset_before b on b.t = e.t
union all
select 'anchor', 'myday_duties.created_at (min)', null, null,
       coalesce(min(created_at)::date::text, 'NO DUTIES?') from myday_duties
order by 1 desc, 2;
