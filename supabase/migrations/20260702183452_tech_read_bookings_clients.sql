-- ===========================================================================
-- Grant tech READ-ONLY access to bookings, clients, client_contacts.
-- Run ONCE in the Supabase SQL editor.
--
-- Rationale: tech now sees the Calendar (session schedule) and needs to see who
-- they're working with. Only the SELECT policies are widened to include 'tech';
-- INSERT / UPDATE / DELETE remain unchanged (tech gets no write access).
-- Supersedes the SELECT policies for these three tables from the RLS migration.
-- ===========================================================================

BEGIN;

-- ── bookings: add tech to SELECT (was staff+ + runner) ──
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bookings') THEN
    DROP POLICY IF EXISTS bookings_sel ON bookings;
    CREATE POLICY bookings_sel ON bookings FOR SELECT TO authenticated
      USING (get_my_role() IN ('asst_manager','billing','manager','owner','runner','tech'));
  END IF;
END $$;

-- ── clients: add tech to SELECT (was staff+) ──
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    DROP POLICY IF EXISTS clients_sel ON clients;
    CREATE POLICY clients_sel ON clients FOR SELECT TO authenticated
      USING (get_my_role() IN ('asst_manager','billing','manager','owner','tech'));
  END IF;
END $$;

-- ── client_contacts: add tech to SELECT (was staff+) ──
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client_contacts') THEN
    DROP POLICY IF EXISTS client_contacts_sel ON client_contacts;
    CREATE POLICY client_contacts_sel ON client_contacts FOR SELECT TO authenticated
      USING (get_my_role() IN ('asst_manager','billing','manager','owner','tech'));
  END IF;
END $$;

COMMIT;
