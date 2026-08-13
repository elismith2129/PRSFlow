-- ─────────────────────────────────────────────────────────────────────────────
-- WIPE EVERY PACKAGE SNAPSHOT TAKEN BEFORE THE PDF WAS THE WORK ORDER
-- 2026-08-13 · run by hand in the Supabase SQL editor
--
-- WHY THIS IS NOT OPTIONAL. v1.9.0 shipped two things in the wrong order: the
-- archive that stores the exact bytes of a package as it goes out, and the PDF
-- layout those bytes contain. The layout was a generic invoice, not the work
-- order, and it has now been rebuilt (lib/woPdf.ts, 2026-08-13).
--
-- Which means every snapshot currently in the `invoices` bucket is a faithful
-- record of a document we just threw away. The package window would show it as
-- "what the client received" — and the moment anyone goes looking at a package
-- is precisely when something has already gone wrong, which is the worst
-- possible time to be handed a document that never existed in that form.
--
-- Deleting them costs nothing real: the package is rebuilt from the live record
-- on the next Download, and `invoice_downloaded_at` / `invoice_sent_at` — the
-- stamps AR actually runs on — are untouched by this.
--
-- SAFE TO RUN TWICE. After the rebuild ships, a second run finds nothing,
-- because only downloads taken after this point can exist.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1. The files. Package snapshots are the only objects written as
--    "<work_order_id>/package-<timestamp>.pdf"; an ATTACHED invoice (the
--    QuickBooks PDF billing dragged onto a row) is stored under a different
--    name and MUST NOT be touched — it is the client's actual invoice and
--    PRSFlo has no other copy of it.
delete from storage.objects
where bucket_id = 'invoices'
  and name like '%/package-%';

-- 2. The pointers. Nulled after the files, so a half-run leaves rows pointing
--    at something missing rather than files no row can find.
update work_orders
set invoice_package_path = null
where invoice_package_path is not null;

commit;

-- Verify — both should return 0.
-- select count(*) from work_orders where invoice_package_path is not null;
-- select count(*) from storage.objects where bucket_id = 'invoices' and name like '%/package-%';
