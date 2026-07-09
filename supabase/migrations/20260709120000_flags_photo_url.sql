-- Add an optional photo attachment to manually-created flags.
-- Mirrors flag_comments.photo_url (nullable text; stores the storage PATH in the
-- private checklist-photos bucket, read on demand via a signed URL).
-- Idempotent: safe to re-run.
alter table public.flags
  add column if not exists photo_url text;
