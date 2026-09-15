-- Memo → newsletter email (Eli, 2026-09-15): "for these I'd also like it to be
-- an email… just for the owners and office admin… owners aren't on the app as
-- much." Every memo can be mailed to owner/manager/billing/asst_manager
-- profiles via Resend (/api/memo-email). The mail links to a login-free copy
-- of the memo at /m/<email_token> — an unguessable token, the way a
-- newsletter's "view in browser" works. Signatures stay in the app.
alter table public.memos
  add column if not exists email_token text unique,
  add column if not exists emailed_at  timestamptz,
  add column if not exists email_to    text[];

create index if not exists memos_email_token_idx on public.memos (email_token) where email_token is not null;
