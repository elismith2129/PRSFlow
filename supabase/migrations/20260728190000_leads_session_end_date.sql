-- leads.session_end_date — optional END of a lead's potential session window.
--
-- `leads.session_date` has always been a single day. Clients frequently ask to
-- book a block ("we want a week in August"), and there was nowhere to record it,
-- so the range collapsed to one day and the real ask was lost.
--
-- Semantics: session_date is the START (unchanged, still the single source for
-- single-day leads). session_end_date is NULL for a one-day lead and holds the
-- last day for a multi-day lead. Nothing reads it as required; every existing
-- lead keeps working with it NULL.
--
-- Idempotent / additive. Safe to re-run.

alter table leads
  add column if not exists session_end_date text;

comment on column leads.session_end_date is
  'Optional last day of a multi-day potential session. NULL = single-day lead (session_date only). Text to match session_date.';
