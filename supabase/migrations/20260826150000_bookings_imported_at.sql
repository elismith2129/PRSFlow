-- ---------------------------------------------------------------------------
-- WordPress calendar import marker (Eli, 2026-08-26 — the 2026 history import
-- from paramountrecordinggroup.WordPress.2026-08-26.xml).
--
-- One nullable column. NULL = a booking born in PRSFlo (every existing and
-- future native row). Non-NULL = the row was imported from the WordPress
-- calendar, stamped with the import run's timestamp.
--
-- How the flag is read (enforced in UI, not RLS — imported rows must stay
-- writable by the promotion path):
--   • imported + start_date < today  → READ-ONLY history everywhere: viewable
--     on the calendar, never editable, never creates a work order or invoice
--     number, never appears in daily ops or the runner hub.
--   • imported + start_date >= today → behaves as a legacy WO-less booking:
--     the existing promotion path (open → WO created on save) turns it into a
--     real session the first time staff touches it. Promotion does NOT clear
--     imported_at — the stamp is provenance, not state.
--
-- The import script (scripts/importCalendar2026.mjs) snapshots and then
-- DELETES all existing bookings rows before inserting (Eli, 2026-08-26:
-- everything currently in bookings is test data, approved for deletion).
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists imported_at timestamptz;

comment on column public.bookings.imported_at is
  'Non-null = row imported from the legacy WordPress calendar (value = import run timestamp). NULL = native PRSFlo booking. Past imported rows are read-only history; future imported rows promote via the legacy WO-less path.';
