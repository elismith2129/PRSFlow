-- ─────────────────────────────────────────────────────────────────────────────
-- Assistant managers join the invoice tier (Eli, 2026-09-01: "we need all
-- assistant managers to have access to this").
--
-- The Aug 11 billing-hub policies gated the `invoices` bucket to
-- owner/manager/billing — which predates Billing Ops becoming an unowned role
-- (Aaron left, v1.19.1) and asst managers picking up COD invoice-attaching.
-- The symptom this fixes: "Uploading invoice failed: new row violates
-- row-level security policy" for any asst_manager dropping a PDF on a row.
--
-- Read / insert / update widen to include asst_manager. DELETE stays
-- owner-only — removing a financial document remains deliberate.
-- Approval is untouched: the enforce_invoice_approver trigger keeps that
-- owners-only regardless of who can attach.
--
-- Idempotent (drop + recreate, same names as the originals).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists invoices_read on storage.objects;
create policy invoices_read on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists invoices_insert on storage.objects;
create policy invoices_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists invoices_update on storage.objects;
create policy invoices_update on storage.objects for update to authenticated
  using (bucket_id = 'invoices' and get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

-- invoices_delete: unchanged, owner-only.
