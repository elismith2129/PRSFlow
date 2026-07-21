-- ===========================================================================
-- tags — free-form label array on leads and clients for campaign segmentation.
-- Run ONCE in the Supabase SQL editor.
--
-- A tag is a plain text label (e.g. 'Producer', 'Label A&R', 'VIP') stored as
-- a text[] array directly on the row. No separate tags table needed — segments
-- query via `'tag' = ANY(tags)`. Default is an empty array so existing rows
-- need no backfill and the CRM/client UI can render immediately.
-- Idempotent: safe to re-run.
-- ===========================================================================

alter table public.leads
  add column if not exists tags text[] not null default '{}';

alter table public.clients
  add column if not exists tags text[] not null default '{}';

-- No RLS change needed: existing INSERT/UPDATE policies cover all columns.
-- No realtime change needed: both tables are already in the supabase_realtime
-- publication with REPLICA IDENTITY FULL.
