-- ===========================================================================
-- BILLING — DOWNLOAD AND SEND BECOME TWO ACTS (RULING 2026-08-11, Eli)
--
-- Download & send was one press: it built the PDF and marked the invoice sent.
-- But PRSFlo does not send anything — a person attaches the file to an email.
-- So "sent" was an assumption, and Eli named the failure it hides:
--
--   "My main concern is that we've done all the work to prepare the package and
--    it lands in someone's downloads folder and never goes out."
--
-- That is worse than the failure I was protecting against (a forgotten Sent
-- press leaving an invoice un-chased), because his version is invisible AND the
-- work is already done. His worst case — it gets sent, stays In progress, and
-- someone says "I already sent this" — is loud and recoverable. Mine was only
-- safer on the assumption that nobody would ever fix it.
--
-- So the app now records what it KNOWS (a file was built and downloaded) and
-- asks a person for what only they know (it went to the client).
--
-- The forgotten-Sent risk is covered by the stale-download reminder that reads
-- this column: downloaded, still not sent after two days, and the row goes hot.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

alter table work_orders
  add column if not exists invoice_downloaded_at timestamptz;

comment on column work_orders.invoice_downloaded_at is
  'When the merged package (work order + invoice) was last downloaded. Set by the billing hub. An approved invoice with this set but invoice_sent_at null is built-but-not-sent — the hub flags it hot after 2 days. Cleared by Pull it back.';

commit;
