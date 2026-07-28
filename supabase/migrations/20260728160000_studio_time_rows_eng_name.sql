-- Per-row engineer name (engineers change day to day on long sessions).
-- NULL = fall back to the WO-level engineer. Run ONCE. Idempotent.
alter table public.studio_time_rows
  add column if not exists eng_name text;
