-- PHOTOS ON MANAGER SHIFT NOTES (Lori, 2026-10-21: "we should add pics to mgmt
-- notes section"; v1.45.2). Paths in the private checklist-photos bucket under
-- shift-notes/ (same bucket and signed reads as flags). The draft carries them
-- too — the paper never clears out (2026-08-31 ruling). No RLS change: the
-- columns ride the existing row policies. Idempotent.

alter table public.myday_note_posts
  add column if not exists photo_paths text[] not null default '{}';

alter table public.myday_note_drafts
  add column if not exists photo_paths text[] not null default '{}';

select count(*) as posts, count(*) filter (where cardinality(photo_paths) > 0) as with_photos
from public.myday_note_posts;
