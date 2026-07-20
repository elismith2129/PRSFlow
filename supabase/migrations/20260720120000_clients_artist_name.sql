-- ===========================================================================
-- clients.artist_name — stage name / artist name for COD (individual) clients.
-- Run ONCE in the Supabase SQL editor (or via your normal migration flow).
--
-- Background: leads.artist_name already exists for COD leads (stage name of
-- the recording artist). This column mirrors it on the clients table so the
-- field persists when a lead converts to a client record. Label clients use
-- the existing artists[] jsonb roster; this single-text field is for COD only.
--
-- Nullable: existing clients and label clients will have NULL.
-- Idempotent: safe to re-run.
-- ===========================================================================

alter table public.clients
  add column if not exists artist_name text;

-- No RLS change needed: existing clients SELECT/UPDATE policies already cover
-- all columns on this table.
-- No realtime change needed: clients is already in the supabase_realtime
-- publication with REPLICA IDENTITY FULL.
