-- ===========================================================================
-- BILLING — KEEP THE PACKAGE THAT ACTUALLY WENT OUT (RULING 2026-08-11, Eli)
--
-- "Once a package leaves In progress, it needs to be the actual PDF so we can
--  see the actual package, not the digital WO + invoice. We need to see what's
--  actually going out — see a bug we missed, info looks weird to client, etc."
--
-- Correct, and it exposed a hole in the design rather than a display bug. The
-- merged PDF was built fresh on every download and thrown away, so the package
-- window could only ever REBUILD what a package would look like today. Edit a
-- rate next month and the "package" silently becomes a document that was never
-- sent — and the one moment you go looking is precisely when something is
-- wrong, which is the worst possible time to be shown a reconstruction.
--
-- So Download now writes the exact bytes it just handed you into the private
-- `invoices` bucket, and this column points at them. From then on the package
-- window opens THAT FILE for anything past In progress.
--
-- Re-downloading after a correction OVERWRITES the pointer, so this is always
-- the last thing that actually left — not a pile of versions nobody can tell
-- apart. Pull it back clears it along with the invoice.
--
-- Storage cost: roughly one PDF per invoice, in a bucket the nightly backup
-- already mirrors (scripts/backup.mjs discovers buckets, it does not enumerate
-- them), so these are covered without touching the backup.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

alter table work_orders
  add column if not exists invoice_package_path text;

comment on column work_orders.invoice_package_path is
  'The merged work-order-plus-invoice PDF exactly as it was last downloaded, in the private invoices bucket. This is the artifact the client received — the package window opens it instead of re-rendering the live work order, so what you review is what actually went out. Overwritten on re-download, cleared by Pull it back.';

commit;
