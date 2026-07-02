-- ===========================================================================
-- RLS SECURITY HARDENING
-- ===========================================================================
-- Run ONCE in the Supabase SQL editor (single tab, single execution).
--
-- Enables real Row-Level Security across the whole database, keyed on the
-- caller's role in user_profiles. Replaces the legacy open USING(true) policies.
--
-- ORDER (do not reorder):
--   Section 1  role CHECK constraint + auth_user_id backfill + runner row + get_my_role()
--   Section 2  drop legacy permissive policies
--   Section 3  RLS policies for every table (get_my_profile_id() defined first)
--   Section 6a checklist-photos bucket → private + authenticated-only policies
--   Section 7  drop dead anon policies on the expenses bucket
--
-- Tier predicates:
--   staff+  role IN ('asst_manager','billing','manager','owner')
--   mgr+    role IN ('manager','billing','owner')
--   owner   role = 'owner'
--   tech    role = 'tech'   (isolated; NOT part of staff+)
--   runner  role = 'runner' (writes gated to role only — per-studio scoping is
--                            deferred to the PIN-auth task)
--
-- The whole migration runs in one transaction: if anything fails, nothing
-- applies (no half-locked database).
--
-- PREREQUISITE (B1): every staff member must already have a Supabase Auth
-- account; the backfill in 1.2 links them by email. Deploy this migration and
-- the backfill together — never policies before the backfill, or staff lock out.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- SECTION 1 — Backfill auth_user_id, add runner support, create role helper
-- ===========================================================================

-- 1.1  Widen the role CHECK constraint so 'runner' (and all current values) are legal.
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('owner', 'manager', 'billing', 'asst_manager', 'tech', 'staff', 'runner'));

-- 1.2  Backfill auth_user_id for every staff member by matching email to their
--      Supabase Auth account. Idempotent; only fills NULLs; case-insensitive.
UPDATE user_profiles p
SET auth_user_id = u.id,
    updated_at   = now()
FROM auth.users u
WHERE p.auth_user_id IS NULL
  AND lower(trim(p.email)) = lower(trim(u.email));

-- 1.3  Ensure a single shared runner profile exists (role = 'runner').
--      auth_user_id stays NULL until the shared-PIN auth account is created
--      (future task); until then get_my_role() returns nothing for the runner,
--      so runner policies simply grant nothing yet (accepted interim).
INSERT INTO user_profiles (email, display_name, role)
VALUES ('runner@paramountrecording.com', 'Studio Runner', 'runner')
ON CONFLICT (email) DO NOTHING;

-- 1.4  Role helper used by every policy below. SECURITY DEFINER (runs as owner,
--      bypasses RLS on user_profiles → no recursion) with a pinned search_path
--      and schema-qualified table (closes the SECURITY DEFINER hijack vector).
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE auth_user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION get_my_role() TO anon, authenticated;


-- ===========================================================================
-- SECTION 2 — Drop the legacy open "Public access" policies
-- (schema.sql created these as FOR ALL USING(true) WITH CHECK(true).)
-- ===========================================================================

DROP POLICY IF EXISTS "Public access" ON leads;
DROP POLICY IF EXISTS "Public access" ON clients;
DROP POLICY IF EXISTS "Public access" ON work_orders;
DROP POLICY IF EXISTS "Public access" ON qc_reports;
DROP POLICY IF EXISTS "Public access" ON contact_log;


-- ===========================================================================
-- SECTION 3 — RLS policies for every table
-- ===========================================================================

-- Helper: caller's user_profiles.id (surrogate PK), for task ownership checks.
CREATE OR REPLACE FUNCTION get_my_profile_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION get_my_profile_id() TO anon, authenticated;


-- ─── leads ───  read staff+ · write staff+ (+anon INSERT for /inquiry) · delete mgr+
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_sel ON leads;
CREATE POLICY leads_sel ON leads FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS leads_ins_staff ON leads;
CREATE POLICY leads_ins_staff ON leads FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS leads_ins_anon ON leads;
CREATE POLICY leads_ins_anon ON leads FOR INSERT TO anon
  WITH CHECK (source = 'Web Inquiry' AND status = 'uncontacted');

DROP POLICY IF EXISTS leads_upd ON leads;
CREATE POLICY leads_upd ON leads FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS leads_del ON leads;
CREATE POLICY leads_del ON leads FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── clients ───  read staff+ · write staff+ · delete mgr+
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_sel ON clients;
CREATE POLICY clients_sel ON clients FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS clients_ins ON clients;
CREATE POLICY clients_ins ON clients FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS clients_upd ON clients;
CREATE POLICY clients_upd ON clients FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS clients_del ON clients;
CREATE POLICY clients_del ON clients FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── client_contacts ───  read staff+ · write staff+ · delete mgr+
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_contacts_sel ON client_contacts;
CREATE POLICY client_contacts_sel ON client_contacts FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS client_contacts_ins ON client_contacts;
CREATE POLICY client_contacts_ins ON client_contacts FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS client_contacts_upd ON client_contacts;
CREATE POLICY client_contacts_upd ON client_contacts FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS client_contacts_del ON client_contacts;
CREATE POLICY client_contacts_del ON client_contacts FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── contact_log ───  read staff+ · write staff+ · delete mgr+
ALTER TABLE contact_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_log_sel ON contact_log;
CREATE POLICY contact_log_sel ON contact_log FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS contact_log_ins ON contact_log;
CREATE POLICY contact_log_ins ON contact_log FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS contact_log_upd ON contact_log;
CREATE POLICY contact_log_upd ON contact_log FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS contact_log_del ON contact_log;
CREATE POLICY contact_log_del ON contact_log FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── lead_activity ───  read staff+ · write staff+ · delete mgr+
ALTER TABLE lead_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_activity_sel ON lead_activity;
CREATE POLICY lead_activity_sel ON lead_activity FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS lead_activity_ins ON lead_activity;
CREATE POLICY lead_activity_ins ON lead_activity FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS lead_activity_upd ON lead_activity;
CREATE POLICY lead_activity_upd ON lead_activity FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS lead_activity_del ON lead_activity;
CREATE POLICY lead_activity_del ON lead_activity FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── registration_tokens ───  read staff+ · write staff+ · delete owner
ALTER TABLE registration_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS registration_tokens_sel ON registration_tokens;
CREATE POLICY registration_tokens_sel ON registration_tokens FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS registration_tokens_ins ON registration_tokens;
CREATE POLICY registration_tokens_ins ON registration_tokens FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS registration_tokens_upd ON registration_tokens;
CREATE POLICY registration_tokens_upd ON registration_tokens FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS registration_tokens_del ON registration_tokens;
CREATE POLICY registration_tokens_del ON registration_tokens FOR DELETE TO authenticated
  USING (get_my_role() = 'owner');


-- ─── bookings ───  read staff++runner · write staff+ · delete mgr+ · tech NONE
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_sel ON bookings;
CREATE POLICY bookings_sel ON bookings FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS bookings_ins ON bookings;
CREATE POLICY bookings_ins ON bookings FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS bookings_upd ON bookings;
CREATE POLICY bookings_upd ON bookings FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS bookings_del ON bookings;
CREATE POLICY bookings_del ON bookings FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── work_orders ───  read staff++rn+tech · write staff++runner · delete mgr+
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_orders_sel ON work_orders;
CREATE POLICY work_orders_sel ON work_orders FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS work_orders_ins ON work_orders;
CREATE POLICY work_orders_ins ON work_orders FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS work_orders_upd ON work_orders;
CREATE POLICY work_orders_upd ON work_orders FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS work_orders_del ON work_orders;
CREATE POLICY work_orders_del ON work_orders FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── studio_time_rows ───  read staff++rn+tech · write staff++runner · delete mgr+
ALTER TABLE studio_time_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_time_rows_sel ON studio_time_rows;
CREATE POLICY studio_time_rows_sel ON studio_time_rows FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS studio_time_rows_ins ON studio_time_rows;
CREATE POLICY studio_time_rows_ins ON studio_time_rows FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS studio_time_rows_upd ON studio_time_rows;
CREATE POLICY studio_time_rows_upd ON studio_time_rows FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS studio_time_rows_del ON studio_time_rows;
CREATE POLICY studio_time_rows_del ON studio_time_rows FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── rental_rows ───  read staff++rn+tech · write staff++runner · delete mgr+
ALTER TABLE rental_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rental_rows_sel ON rental_rows;
CREATE POLICY rental_rows_sel ON rental_rows FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS rental_rows_ins ON rental_rows;
CREATE POLICY rental_rows_ins ON rental_rows FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS rental_rows_upd ON rental_rows;
CREATE POLICY rental_rows_upd ON rental_rows FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS rental_rows_del ON rental_rows;
CREATE POLICY rental_rows_del ON rental_rows FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── payment_rows ───  read staff++rn+tech · write staff++runner · delete mgr+
ALTER TABLE payment_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_rows_sel ON payment_rows;
CREATE POLICY payment_rows_sel ON payment_rows FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS payment_rows_ins ON payment_rows;
CREATE POLICY payment_rows_ins ON payment_rows FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS payment_rows_upd ON payment_rows;
CREATE POLICY payment_rows_upd ON payment_rows FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS payment_rows_del ON payment_rows;
CREATE POLICY payment_rows_del ON payment_rows FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── expense_rows ───  read staff++rn+tech · write staff++runner · delete mgr+
ALTER TABLE expense_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_rows_sel ON expense_rows;
CREATE POLICY expense_rows_sel ON expense_rows FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS expense_rows_ins ON expense_rows;
CREATE POLICY expense_rows_ins ON expense_rows FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS expense_rows_upd ON expense_rows;
CREATE POLICY expense_rows_upd ON expense_rows FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS expense_rows_del ON expense_rows;
CREATE POLICY expense_rows_del ON expense_rows FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── equipment_condition_rows ───  read staff++rn+tech · write staff++runner · delete mgr+
ALTER TABLE equipment_condition_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_condition_rows_sel ON equipment_condition_rows;
CREATE POLICY equipment_condition_rows_sel ON equipment_condition_rows FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS equipment_condition_rows_ins ON equipment_condition_rows;
CREATE POLICY equipment_condition_rows_ins ON equipment_condition_rows FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS equipment_condition_rows_upd ON equipment_condition_rows;
CREATE POLICY equipment_condition_rows_upd ON equipment_condition_rows FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS equipment_condition_rows_del ON equipment_condition_rows;
CREATE POLICY equipment_condition_rows_del ON equipment_condition_rows FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── equipment_condition_notes ───  read staff++rn+tech · write staff++runner · delete mgr+
ALTER TABLE equipment_condition_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_condition_notes_sel ON equipment_condition_notes;
CREATE POLICY equipment_condition_notes_sel ON equipment_condition_notes FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS equipment_condition_notes_ins ON equipment_condition_notes;
CREATE POLICY equipment_condition_notes_ins ON equipment_condition_notes FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS equipment_condition_notes_upd ON equipment_condition_notes;
CREATE POLICY equipment_condition_notes_upd ON equipment_condition_notes FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner'));

DROP POLICY IF EXISTS equipment_condition_notes_del ON equipment_condition_notes;
CREATE POLICY equipment_condition_notes_del ON equipment_condition_notes FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── qc_reports ───  read staff+ · write staff+ · delete mgr+ · tech/runner NONE
ALTER TABLE qc_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qc_reports_sel ON qc_reports;
CREATE POLICY qc_reports_sel ON qc_reports FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS qc_reports_ins ON qc_reports;
CREATE POLICY qc_reports_ins ON qc_reports FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS qc_reports_upd ON qc_reports;
CREATE POLICY qc_reports_upd ON qc_reports FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS qc_reports_del ON qc_reports;
CREATE POLICY qc_reports_del ON qc_reports FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── daily_ops_submissions ───  read/write staff++rn+tech · delete mgr+
ALTER TABLE daily_ops_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_ops_submissions_sel ON daily_ops_submissions;
CREATE POLICY daily_ops_submissions_sel ON daily_ops_submissions FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS daily_ops_submissions_ins ON daily_ops_submissions;
CREATE POLICY daily_ops_submissions_ins ON daily_ops_submissions FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS daily_ops_submissions_upd ON daily_ops_submissions;
CREATE POLICY daily_ops_submissions_upd ON daily_ops_submissions FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS daily_ops_submissions_del ON daily_ops_submissions;
CREATE POLICY daily_ops_submissions_del ON daily_ops_submissions FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── checklists ───  read/write staff++rn+tech · delete mgr+
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklists_sel ON checklists;
CREATE POLICY checklists_sel ON checklists FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS checklists_ins ON checklists;
CREATE POLICY checklists_ins ON checklists FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS checklists_upd ON checklists;
CREATE POLICY checklists_upd ON checklists FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS checklists_del ON checklists;
CREATE POLICY checklists_del ON checklists FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── petty_cash_entries ───  read/write staff++rn+tech · delete mgr+
ALTER TABLE petty_cash_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS petty_cash_entries_sel ON petty_cash_entries;
CREATE POLICY petty_cash_entries_sel ON petty_cash_entries FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS petty_cash_entries_ins ON petty_cash_entries;
CREATE POLICY petty_cash_entries_ins ON petty_cash_entries FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS petty_cash_entries_upd ON petty_cash_entries;
CREATE POLICY petty_cash_entries_upd ON petty_cash_entries FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS petty_cash_entries_del ON petty_cash_entries;
CREATE POLICY petty_cash_entries_del ON petty_cash_entries FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── petty_cash_balances ───  read/write staff++rn+tech · delete mgr+
ALTER TABLE petty_cash_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS petty_cash_balances_sel ON petty_cash_balances;
CREATE POLICY petty_cash_balances_sel ON petty_cash_balances FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS petty_cash_balances_ins ON petty_cash_balances;
CREATE POLICY petty_cash_balances_ins ON petty_cash_balances FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS petty_cash_balances_upd ON petty_cash_balances;
CREATE POLICY petty_cash_balances_upd ON petty_cash_balances FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS petty_cash_balances_del ON petty_cash_balances;
CREATE POLICY petty_cash_balances_del ON petty_cash_balances FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── stock_items ───  read/write staff++rn+tech · delete mgr+
-- GUARDED (B8): table may not exist in the live DB — skip cleanly if absent.
DO $$
BEGIN
  IF to_regclass('public.stock_items') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS stock_items_sel ON stock_items';
    EXECUTE 'CREATE POLICY stock_items_sel ON stock_items FOR SELECT TO authenticated USING (get_my_role() IN (''asst_manager'',''billing'',''manager'',''owner'',''runner'',''tech''))';

    EXECUTE 'DROP POLICY IF EXISTS stock_items_ins ON stock_items';
    EXECUTE 'CREATE POLICY stock_items_ins ON stock_items FOR INSERT TO authenticated WITH CHECK (get_my_role() IN (''asst_manager'',''billing'',''manager'',''owner'',''runner'',''tech''))';

    EXECUTE 'DROP POLICY IF EXISTS stock_items_upd ON stock_items';
    EXECUTE 'CREATE POLICY stock_items_upd ON stock_items FOR UPDATE TO authenticated USING (get_my_role() IN (''asst_manager'',''billing'',''manager'',''owner'',''runner'',''tech'')) WITH CHECK (get_my_role() IN (''asst_manager'',''billing'',''manager'',''owner'',''runner'',''tech''))';

    EXECUTE 'DROP POLICY IF EXISTS stock_items_del ON stock_items';
    EXECUTE 'CREATE POLICY stock_items_del ON stock_items FOR DELETE TO authenticated USING (get_my_role() IN (''manager'',''billing'',''owner''))';
  END IF;
END $$;


-- ─── mics ───  read staff++rn+tech · write staff+ ONLY · delete owner
ALTER TABLE mics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mics_sel ON mics;
CREATE POLICY mics_sel ON mics FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mics_ins ON mics;
CREATE POLICY mics_ins ON mics FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS mics_upd ON mics;
CREATE POLICY mics_upd ON mics FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS mics_del ON mics;
CREATE POLICY mics_del ON mics FOR DELETE TO authenticated
  USING (get_my_role() = 'owner');


-- ─── mic_checkins ───  read/write staff++rn+tech · delete mgr+
ALTER TABLE mic_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mic_checkins_sel ON mic_checkins;
CREATE POLICY mic_checkins_sel ON mic_checkins FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_checkins_ins ON mic_checkins;
CREATE POLICY mic_checkins_ins ON mic_checkins FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_checkins_upd ON mic_checkins;
CREATE POLICY mic_checkins_upd ON mic_checkins FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_checkins_del ON mic_checkins;
CREATE POLICY mic_checkins_del ON mic_checkins FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── mic_inventory_quantities ───  read/write staff++rn+tech · delete mgr+
ALTER TABLE mic_inventory_quantities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mic_inventory_quantities_sel ON mic_inventory_quantities;
CREATE POLICY mic_inventory_quantities_sel ON mic_inventory_quantities FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_inventory_quantities_ins ON mic_inventory_quantities;
CREATE POLICY mic_inventory_quantities_ins ON mic_inventory_quantities FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_inventory_quantities_upd ON mic_inventory_quantities;
CREATE POLICY mic_inventory_quantities_upd ON mic_inventory_quantities FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_inventory_quantities_del ON mic_inventory_quantities;
CREATE POLICY mic_inventory_quantities_del ON mic_inventory_quantities FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── mic_inventory_submissions ───  read/write staff++rn+tech · delete mgr+
ALTER TABLE mic_inventory_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mic_inventory_submissions_sel ON mic_inventory_submissions;
CREATE POLICY mic_inventory_submissions_sel ON mic_inventory_submissions FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_inventory_submissions_ins ON mic_inventory_submissions;
CREATE POLICY mic_inventory_submissions_ins ON mic_inventory_submissions FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_inventory_submissions_upd ON mic_inventory_submissions;
CREATE POLICY mic_inventory_submissions_upd ON mic_inventory_submissions FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));

DROP POLICY IF EXISTS mic_inventory_submissions_del ON mic_inventory_submissions;
CREATE POLICY mic_inventory_submissions_del ON mic_inventory_submissions FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── mic_inventory (LEGACY) ───  read staff+ · write owner · delete owner
-- GUARDED (B8): legacy table may not exist in the live DB — skip cleanly if absent.
DO $$
BEGIN
  IF to_regclass('public.mic_inventory') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE mic_inventory ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS mic_inventory_sel ON mic_inventory';
    EXECUTE 'CREATE POLICY mic_inventory_sel ON mic_inventory FOR SELECT TO authenticated USING (get_my_role() IN (''asst_manager'',''billing'',''manager'',''owner''))';

    EXECUTE 'DROP POLICY IF EXISTS mic_inventory_ins ON mic_inventory';
    EXECUTE 'CREATE POLICY mic_inventory_ins ON mic_inventory FOR INSERT TO authenticated WITH CHECK (get_my_role() = ''owner'')';

    EXECUTE 'DROP POLICY IF EXISTS mic_inventory_upd ON mic_inventory';
    EXECUTE 'CREATE POLICY mic_inventory_upd ON mic_inventory FOR UPDATE TO authenticated USING (get_my_role() = ''owner'') WITH CHECK (get_my_role() = ''owner'')';

    EXECUTE 'DROP POLICY IF EXISTS mic_inventory_del ON mic_inventory';
    EXECUTE 'CREATE POLICY mic_inventory_del ON mic_inventory FOR DELETE TO authenticated USING (get_my_role() = ''owner'')';
  END IF;
END $$;


-- ─── user_profiles ───  read: staff+ all rows, everyone else OWN row · write mgr+ · delete OWNER only
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_sel ON user_profiles;
CREATE POLICY user_profiles_sel ON user_profiles FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('asst_manager','billing','manager','owner')
    OR auth_user_id = auth.uid()
  );

DROP POLICY IF EXISTS user_profiles_ins ON user_profiles;
CREATE POLICY user_profiles_ins ON user_profiles FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('manager','billing','owner'));

DROP POLICY IF EXISTS user_profiles_upd ON user_profiles;
CREATE POLICY user_profiles_upd ON user_profiles FOR UPDATE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'))
  WITH CHECK (get_my_role() IN ('manager','billing','owner'));

DROP POLICY IF EXISTS user_profiles_del ON user_profiles;
CREATE POLICY user_profiles_del ON user_profiles FOR DELETE TO authenticated
  USING (get_my_role() = 'owner');


-- ─── dashboard_tasks ───  staff+ all · tech own tasks only (assignee or creator) · delete mgr+
ALTER TABLE dashboard_tasks ENABLE ROW LEVEL SECURITY;

-- Drop ALL pre-existing policies (placeholder USING(true) etc.) regardless of name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dashboard_tasks'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON dashboard_tasks', r.policyname);
  END LOOP;
END $$;

CREATE POLICY dashboard_tasks_sel ON dashboard_tasks FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('asst_manager','billing','manager','owner')
    OR (
      get_my_role() = 'tech'
      AND (assigned_to = get_my_profile_id() OR assigned_by = get_my_profile_id())
    )
  );

CREATE POLICY dashboard_tasks_ins ON dashboard_tasks FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('asst_manager','billing','manager','owner')
    OR (get_my_role() = 'tech' AND assigned_by = get_my_profile_id())
  );

CREATE POLICY dashboard_tasks_upd ON dashboard_tasks FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('asst_manager','billing','manager','owner')
    OR (
      get_my_role() = 'tech'
      AND (assigned_to = get_my_profile_id() OR assigned_by = get_my_profile_id())
    )
  )
  WITH CHECK (
    get_my_role() IN ('asst_manager','billing','manager','owner')
    OR (
      get_my_role() = 'tech'
      AND (assigned_to = get_my_profile_id() OR assigned_by = get_my_profile_id())
    )
  );

CREATE POLICY dashboard_tasks_del ON dashboard_tasks FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── dashboard_task_comments ───  staff+ all · tech only on tasks they can see · append-only
ALTER TABLE dashboard_task_comments ENABLE ROW LEVEL SECURITY;

-- Drop ALL pre-existing policies (open anon+authenticated SELECT/INSERT) regardless of name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dashboard_task_comments'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON dashboard_task_comments', r.policyname);
  END LOOP;
END $$;

CREATE POLICY dashboard_task_comments_sel ON dashboard_task_comments FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('asst_manager','billing','manager','owner')
    OR (
      get_my_role() = 'tech'
      AND EXISTS (
        SELECT 1 FROM dashboard_tasks t
        WHERE t.id = dashboard_task_comments.task_id
          AND (t.assigned_to = get_my_profile_id() OR t.assigned_by = get_my_profile_id())
      )
    )
  );

CREATE POLICY dashboard_task_comments_ins ON dashboard_task_comments FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('asst_manager','billing','manager','owner')
    OR (
      get_my_role() = 'tech'
      AND EXISTS (
        SELECT 1 FROM dashboard_tasks t
        WHERE t.id = dashboard_task_comments.task_id
          AND (t.assigned_to = get_my_profile_id() OR t.assigned_by = get_my_profile_id())
      )
    )
  );


-- ─── flags ───  read staff++tech · insert staff++tech+runner · update staff++tech · delete mgr+
ALTER TABLE flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flags_sel ON flags;
CREATE POLICY flags_sel ON flags FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','tech'));

DROP POLICY IF EXISTS flags_ins ON flags;
CREATE POLICY flags_ins ON flags FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','tech','runner'));

DROP POLICY IF EXISTS flags_upd ON flags;
CREATE POLICY flags_upd ON flags FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','tech'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','tech'));

DROP POLICY IF EXISTS flags_del ON flags;
CREATE POLICY flags_del ON flags FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── flag_comments ───  read staff++tech · insert staff++tech · append-only
ALTER TABLE flag_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flag_comments_sel ON flag_comments;
CREATE POLICY flag_comments_sel ON flag_comments FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner','tech'));

DROP POLICY IF EXISTS flag_comments_ins ON flag_comments;
CREATE POLICY flag_comments_ins ON flag_comments FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner','tech'));


-- ─── engineers ───  read staff+ · write staff+ · delete mgr+ · tech/runner NONE
ALTER TABLE engineers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engineers_sel ON engineers;
CREATE POLICY engineers_sel ON engineers FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS engineers_ins ON engineers;
CREATE POLICY engineers_ins ON engineers FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS engineers_upd ON engineers;
CREATE POLICY engineers_upd ON engineers FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS engineers_del ON engineers;
CREATE POLICY engineers_del ON engineers FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ─── srs_log ───  read staff+ · write staff+ · delete mgr+ · tech/runner NONE
ALTER TABLE srs_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS srs_log_sel ON srs_log;
CREATE POLICY srs_log_sel ON srs_log FOR SELECT TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS srs_log_ins ON srs_log;
CREATE POLICY srs_log_ins ON srs_log FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS srs_log_upd ON srs_log;
CREATE POLICY srs_log_upd ON srs_log FOR UPDATE TO authenticated
  USING (get_my_role() IN ('asst_manager','billing','manager','owner'))
  WITH CHECK (get_my_role() IN ('asst_manager','billing','manager','owner'));

DROP POLICY IF EXISTS srs_log_del ON srs_log;
CREATE POLICY srs_log_del ON srs_log FOR DELETE TO authenticated
  USING (get_my_role() IN ('manager','billing','owner'));


-- ===========================================================================
-- SECTION 6a — checklist-photos → private, authenticated-only access
-- ===========================================================================

-- Make the bucket private (no more public object URLs).
UPDATE storage.buckets SET public = false WHERE id = 'checklist-photos';

-- Drop any pre-existing policies scoped to this bucket (names unknown → dynamic).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname ILIKE '%checklist%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- Explicit drops of NAMED anon policies confirmed live on storage.objects.
-- These do NOT match the '%checklist%' pattern above — they cover the client-ids
-- bucket and generically-named public policies. Left in place they would defeat
-- the private-bucket model (an anon INSERT/SELECT policy OR's with the new ones).
-- Registration ID uploads/reads now run server-side (service role), so anon
-- needs none of these.
DROP POLICY IF EXISTS "anon can upload client IDs" ON storage.objects;
DROP POLICY IF EXISTS "anon can generate signed URLs for client-ids" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous reads" ON storage.objects;

-- Authenticated-only read/write scoped to this bucket. upsert:true needs both
-- INSERT and UPDATE. (Runners use these once the shared-PIN auth account exists.)
CREATE POLICY "checklist_photos_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'checklist-photos');

CREATE POLICY "checklist_photos_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'checklist-photos');

CREATE POLICY "checklist_photos_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'checklist-photos')
  WITH CHECK (bucket_id = 'checklist-photos');

CREATE POLICY "checklist_photos_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'checklist-photos');


-- ===========================================================================
-- SECTION 7 — Remove dead/over-permissive anon policies on the `expenses` bucket
-- ===========================================================================

DROP POLICY IF EXISTS "anon_insert_expenses" ON storage.objects;
DROP POLICY IF EXISTS "anon_select_expenses" ON storage.objects;


COMMIT;
