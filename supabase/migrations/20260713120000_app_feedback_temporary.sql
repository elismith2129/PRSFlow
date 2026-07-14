-- ===========================================================================
-- TEMPORARY: remove when rollout period ends
-- app_feedback — lightweight staff feedback board (bugs / suggestions / questions)
-- for the rollout period. Run ONCE in the Supabase SQL editor (single tab).
--
-- RLS: any authenticated user may SELECT + INSERT; only owner/manager may
-- UPDATE (mark resolved) or DELETE. Keyed on get_my_role() (defined in the
-- July 2 security-hardening migration).
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  author_name text,
  type        text NOT NULL CHECK (type IN ('bug', 'suggestion', 'question')),
  note        text NOT NULL,
  resolved    boolean NOT NULL DEFAULT false
);

ALTER TABLE app_feedback ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read the whole board.
DROP POLICY IF EXISTS app_feedback_sel ON app_feedback;
CREATE POLICY app_feedback_sel ON app_feedback FOR SELECT TO authenticated
  USING (true);

-- Any authenticated user can submit feedback.
DROP POLICY IF EXISTS app_feedback_ins ON app_feedback;
CREATE POLICY app_feedback_ins ON app_feedback FOR INSERT TO authenticated
  WITH CHECK (true);

-- Only owner/manager can mark resolved (or otherwise edit).
DROP POLICY IF EXISTS app_feedback_upd ON app_feedback;
CREATE POLICY app_feedback_upd ON app_feedback FOR UPDATE TO authenticated
  USING (get_my_role() IN ('owner', 'manager'))
  WITH CHECK (get_my_role() IN ('owner', 'manager'));

-- Only owner/manager can delete.
DROP POLICY IF EXISTS app_feedback_del ON app_feedback;
CREATE POLICY app_feedback_del ON app_feedback FOR DELETE TO authenticated
  USING (get_my_role() IN ('owner', 'manager'));

-- Realtime: the feed subscribes to live inserts/updates (standing architecture rule).
ALTER TABLE app_feedback REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_feedback'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE app_feedback;
  END IF;
END $$;

COMMIT;
