-- ---------------------------------------------------------------------------
-- One-time cleanup, 2026-08-24 — dedupe legacy shift-note posts.
--
-- The pre-v2 scratchpad (myday_notes) stored one row per ROLE CARD per day,
-- and the same text got typed onto both the manager and billing cards (e.g.
-- Fri 8/21: identical notes under Aaron · Billing and Fernando · Manager).
-- The migrations carried everything forward so nothing was lost, which means
-- the Notes log now shows those days twice.
--
-- This deletes the BILLING copy of any backfilled post (shift IS NULL — no
-- v2 post ever has a null shift on the manager card, and billing posts made
-- through the new composer are the author's own words, not a card echo)
-- whose session AND studio text exactly match a manager post on the same
-- day. The manager copy is kept. Dated posts only (on/before 2026-08-24) so
-- this can never touch anything submitted after today. Idempotent — a
-- second run finds nothing to delete.
--
-- Run once in the Supabase SQL editor. Check the count first if you like:
--
--   select count(*) from myday_note_posts b
--   where b.role = 'billing' and b.shift is null and b.date <= '2026-08-24'
--     and exists (
--       select 1 from myday_note_posts m
--       where m.role = 'manager' and m.date = b.date
--         and trim(m.session_notes) = trim(b.session_notes)
--         and trim(m.studio_notes)  = trim(b.studio_notes)
--     );
-- ---------------------------------------------------------------------------

begin;

delete from myday_note_posts b
where b.role = 'billing'
  and b.shift is null
  and b.date <= '2026-08-24'
  and exists (
    select 1 from myday_note_posts m
    where m.role = 'manager'
      and m.date = b.date
      and trim(m.session_notes) = trim(b.session_notes)
      and trim(m.studio_notes)  = trim(b.studio_notes)
  );

commit;
