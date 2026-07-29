-- studio_time_rows.eng_role — flip the column DEFAULT from 'engineer' to
-- 'assistant'.
--
-- Rationale (Eli, July 28 2026): most sessions run with an assistant. An
-- engineer is the exception, requested up front, and is now signalled by the
-- lead's "Engineer Needed" toggle (carried to the booking as
-- engineer_status <> 'not_needed'). Defaulting every new staff row to 1ST meant
-- staff had to remember to downgrade it on the majority of sessions.
--
-- Scope: DEFAULT only. Every existing row keeps the value already stored, and
-- all application inserts set eng_role explicitly — this is the belt-and-braces
-- case for any insert that omits it. Nothing is rewritten.
--
-- Idempotent. Safe to re-run.

alter table studio_time_rows
  alter column eng_role set default 'assistant';

comment on column studio_time_rows.eng_role is
  '1ST/2ND on the staff sub-row: ''engineer'' or ''assistant''. Defaults to assistant — an engineer is the exception, driven by the lead''s Engineer Needed flag (booking.engineer_status).';
