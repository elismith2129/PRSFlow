-- ─────────────────────────────────────────────────────────────────────────────
-- flags.created_by_name (Eli, 2026-09-01: "we need to make the flag system in
-- the daily ops have the runner names so we know who is submitting them").
--
-- A display name/initials, stamped at every flag insert site: the runner
-- checklist's typed initials, the WO flag's profile name, the dashboard's
-- manual-flag author. Text, not a FK — the shared runner login means the auth
-- user often ISN'T the person, and the typed initials are the truth we have
-- (same reasoning as checklists.staff_name). Older flags stay NULL and render
-- without a name.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.flags add column if not exists created_by_name text;
