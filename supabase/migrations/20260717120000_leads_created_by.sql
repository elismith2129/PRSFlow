-- ===========================================================================
-- leads.created_by — attribute each lead to the staff member who created it.
-- Run ONCE in the Supabase SQL editor (or via your normal migration flow).
--
-- Background: createLead() in app/(main)/crm/page.tsx was changed to write
-- `created_by: profile?.id` on insert, but the column did not exist yet, so
-- every insert returned HTTP 400 (PostgREST "could not find the 'created_by'
-- column of 'leads'"). The hotfix (commit fa5ff77) removed the field to restore
-- production; this migration adds the column so the attribution can be restored.
--
-- Stores user_profiles.id (the surrogate uuid PK), NOT auth_user_id — matching
-- the read path in LeadDetail, which resolves the creator via
--   supabase.from('user_profiles').select('initials, display_name')
--           .eq('id', lead.created_by)
-- Nullable: pre-existing leads and Web Inquiry rows have no creator.
-- ON DELETE SET NULL: keep the lead if the creating profile is ever removed.
-- Idempotent: safe to re-run.
-- ===========================================================================

alter table public.leads
  add column if not exists created_by uuid
  references public.user_profiles(id) on delete set null;

-- No RLS change needed: the existing leads_ins_staff INSERT policy gates on the
-- caller's role, not on column values, so writing created_by is already allowed.
-- No realtime change needed: leads is already in the supabase_realtime
-- publication with REPLICA IDENTITY FULL, which covers all columns.
