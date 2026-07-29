-- ===========================================================================
-- dashboard_tasks — shared visibility for paired roles (asst_manager, tech).
--
-- Problem this fixes: the "Asst Mgr" tab is a PAIR (Quinn + Isaac), and the
-- "Tech" tab is a PAIR (Sierra + Tom), but the assign dropdown writes
-- assigned_to = the primary member only (Quinn / Sierra). The visibility policy
-- from 20260702175800 lets an own-only role read a task ONLY when
-- assigned_by/assigned_to is their own profile id — so a task assigned to Quinn
-- was invisible to Isaac at the DATABASE level, not just in the UI. No client
-- query change alone can fix that.
--
-- Fix: a "peer" clause. A user in a paired role may see (and update) any
-- NON-private task assigned to someone holding that SAME role. Owner / manager /
-- billing are deliberately excluded from the peer clause — they already see all
-- non-private tasks, and pairing them would widen nothing but add risk.
--
-- is_private is guarded on the peer clause, so Eli's private self-tasks stay
-- Eli-only regardless of role. dashboard_task_comments needs no change: its
-- policies are an EXISTS subquery over dashboard_tasks and inherit this.
--
-- DELETE is intentionally NOT widened — it stays manager+ for non-private tasks.
-- The dashboard's "×" is a soft delete (an UPDATE writing deleted_at), which the
-- widened UPDATE policy below already covers.
--
-- Idempotent (create or replace / drop-then-create). Safe to re-run.
-- Requires get_my_role() + get_my_profile_id() from the RLS hardening migration.
-- ===========================================================================

begin;

-- ── Peer test: is p_assigned_to held by someone with MY role, where my role is
-- one of the paired roles? SECURITY DEFINER so it can read user_profiles rows
-- the caller's own RLS would hide (tech/runner see only their own profile row).
create or replace function is_task_peer(p_assigned_to uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_assigned_to is not null
     and exists (
       select 1
       from public.user_profiles me
       join public.user_profiles them on them.id = p_assigned_to
       where me.auth_user_id = auth.uid()
         and me.role in ('asst_manager', 'tech')
         and them.role = me.role
     )
$$;

grant execute on function is_task_peer(uuid) to authenticated;

-- ── dashboard_tasks SELECT — 20260702175800 plus the peer clause ──
drop policy if exists dashboard_tasks_sel on dashboard_tasks;
create policy dashboard_tasks_sel on dashboard_tasks for select to authenticated
  using (
    (is_private = false and get_my_role() in ('owner', 'manager', 'billing'))
    or assigned_by = get_my_profile_id()
    or assigned_to = get_my_profile_id()
    or (is_private = false and is_task_peer(assigned_to))
  );

-- ── dashboard_tasks UPDATE — same clause, so a peer can complete / comment on /
-- soft-delete a shared task rather than only staring at it ──
drop policy if exists dashboard_tasks_upd on dashboard_tasks;
create policy dashboard_tasks_upd on dashboard_tasks for update to authenticated
  using (
    (is_private = false and get_my_role() in ('owner', 'manager', 'billing'))
    or assigned_by = get_my_profile_id()
    or assigned_to = get_my_profile_id()
    or (is_private = false and is_task_peer(assigned_to))
  )
  with check (
    (is_private = false and get_my_role() in ('owner', 'manager', 'billing'))
    or assigned_by = get_my_profile_id()
    or assigned_to = get_my_profile_id()
    or (is_private = false and is_task_peer(assigned_to))
  );

commit;
