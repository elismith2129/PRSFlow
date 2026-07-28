-- Per-row venue for cross-location sessions (WO-SPEC §5). NULL = the booking's
-- own venue (all existing rows). Run ONCE. Idempotent.
alter table public.studio_time_rows
  add column if not exists location text;
