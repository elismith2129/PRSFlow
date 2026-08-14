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

-- ⚠ THE FILES CANNOT BE DELETED FROM SQL (found on running this, 2026-08-13).
-- Supabase guards `storage.objects` with a `protect_delete()` trigger:
--   ERROR 42501: Direct deletion from storage tables is not allowed.
--   Use the Storage API instead.
-- So this migration only clears the POINTERS, which is the half that matters:
-- nothing can reach a stale snapshot, and the next Download rebuilds the package
-- from the live record. The orphaned objects stay in the private `invoices`
-- bucket — unreferenced, unreachable, a few KB. Removing them needs the Storage
-- API (a service-role script or the dashboard), and is housekeeping, not safety.

update work_orders
set invoice_package_path = null
where invoice_package_path is not null;

-- Verify — should return 0.
-- select count(*) from work_orders where invoice_package_path is not null;
