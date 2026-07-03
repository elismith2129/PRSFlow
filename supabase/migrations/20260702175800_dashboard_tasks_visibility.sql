-- ===========================================================================
-- dashboard_tasks / dashboard_task_comments — task visibility rules.
-- Run ONCE in the Supabase SQL editor. Requires the is_private column + trigger
-- (migration 20260702175212) and get_my_role()/get_my_profile_id() (RLS migration).
--
-- Visibility tiers:
--   owner/manager/billing : all NON-private tasks
--   everyone              : tasks they created (assigned_by) or were assigned (assigned_to)
--   is_private tasks      : Eli-self tasks — only Eli matches the "own" clause,
--                           so no other owner (e.g. Adam-Mike) can see them.
--   comments/log          : follow the parent task exactly (the subquery on
--                           dashboard_tasks is itself subject to that table's RLS).
--
-- Supersedes the SELECT/UPDATE policies from the RLS hardening migration.
-- ===========================================================================

BEGIN;

-- ── dashboard_tasks SELECT ──
DROP POLICY IF EXISTS dashboard_tasks_sel ON dashboard_tasks;
CREATE POLICY dashboard_tasks_sel ON dashboard_tasks FOR SELECT TO authenticated
  USING (
    (is_private = false AND get_my_role() IN ('owner','manager','billing'))
    OR assigned_by = get_my_profile_id()
    OR assigned_to = get_my_profile_id()
  );

-- ── dashboard_tasks UPDATE ──
-- Revised for consistency: an own-only tier must not be able to modify a task it
-- cannot see. mgr+ update all NON-private; everyone updates their own; Eli
-- updates his private via the own clause.
-- (This goes beyond a strict "SELECT-only" change — flagged in chat. If you want
--  UPDATE left as the RLS-migration version, say so and I'll drop this block.)
DROP POLICY IF EXISTS dashboard_tasks_upd ON dashboard_tasks;
CREATE POLICY dashboard_tasks_upd ON dashboard_tasks FOR UPDATE TO authenticated
  USING (
    (is_private = false AND get_my_role() IN ('manager','billing','owner'))
    OR assigned_by = get_my_profile_id()
    OR assigned_to = get_my_profile_id()
  )
  WITH CHECK (
    (is_private = false AND get_my_role() IN ('manager','billing','owner'))
    OR assigned_by = get_my_profile_id()
    OR assigned_to = get_my_profile_id()
  );

-- ── dashboard_tasks DELETE ──
-- Revised for consistency: delete stays mgr+ for NON-private tasks; Eli may
-- delete his own private tasks. Prevents other owners/managers from deleting
-- is_private tasks they cannot see.
DROP POLICY IF EXISTS dashboard_tasks_del ON dashboard_tasks;
CREATE POLICY dashboard_tasks_del ON dashboard_tasks FOR DELETE TO authenticated
  USING (
    (is_private = false AND get_my_role() IN ('manager','billing','owner'))
    OR (is_private = true AND assigned_by = get_my_profile_id())
  );

-- (dashboard_tasks INSERT is left as the RLS-migration version:
--  staff+ OR tech-with-assigned_by = self.)

-- ── dashboard_task_comments — comments follow the task exactly ──
-- Visible/insertable iff the parent task is visible to the caller. The subquery
-- on dashboard_tasks is subject to that table's RLS, so this inherits the
-- task-visibility tiers above with no duplicated logic. Append-only (no upd/del).
DROP POLICY IF EXISTS dashboard_task_comments_sel ON dashboard_task_comments;
CREATE POLICY dashboard_task_comments_sel ON dashboard_task_comments FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM dashboard_tasks t WHERE t.id = dashboard_task_comments.task_id)
  );

DROP POLICY IF EXISTS dashboard_task_comments_ins ON dashboard_task_comments;
CREATE POLICY dashboard_task_comments_ins ON dashboard_task_comments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM dashboard_tasks t WHERE t.id = dashboard_task_comments.task_id)
  );

COMMIT;
