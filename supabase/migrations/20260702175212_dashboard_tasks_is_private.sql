-- ===========================================================================
-- dashboard_tasks.is_private — auto-derived flag for Eli's self-assigned tasks.
-- Run ONCE in the Supabase SQL editor.
--
-- "Private" = creator AND assignee both = Eli. In this schema the creator is
-- `assigned_by` and the assignee is `assigned_to` (both store user_profiles.id,
-- NOT auth_user_id). The addendum's created_by/assignee_id map to those columns.
-- ===========================================================================

BEGIN;

ALTER TABLE dashboard_tasks
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

-- Derive is_private automatically on insert / reassignment. SECURITY DEFINER so
-- the Eli-id lookup on user_profiles isn't blocked by RLS for the acting user.
CREATE OR REPLACE FUNCTION set_dashboard_task_is_private()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eli_id uuid;
BEGIN
  SELECT id INTO eli_id
  FROM public.user_profiles
  WHERE lower(email) = 'eli@paramountrecording.com';

  NEW.is_private := (
    eli_id IS NOT NULL
    AND NEW.assigned_by = eli_id
    AND NEW.assigned_to = eli_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dashboard_task_is_private ON dashboard_tasks;
CREATE TRIGGER trg_dashboard_task_is_private
  BEFORE INSERT OR UPDATE OF assigned_by, assigned_to ON dashboard_tasks
  FOR EACH ROW EXECUTE FUNCTION set_dashboard_task_is_private();

-- Backfill existing rows (updates only is_private, so the trigger above — scoped
-- to assigned_by/assigned_to — does not re-fire).
UPDATE dashboard_tasks t
SET is_private = (
  t.assigned_by = (SELECT id FROM user_profiles WHERE lower(email) = 'eli@paramountrecording.com')
  AND t.assigned_to = (SELECT id FROM user_profiles WHERE lower(email) = 'eli@paramountrecording.com')
)
WHERE t.assigned_by IS NOT NULL AND t.assigned_to IS NOT NULL;

COMMIT;
