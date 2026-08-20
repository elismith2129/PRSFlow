-- ===========================================================================
-- BILLING HUB — the invoice lifecycle (docs/design-refs/billing-hub-final.html)
--
-- Replaces /wo-hub AND the Dropbox folder system. Eli's folders — COD paid /
-- COD with balance / needing approval / approved-awaiting-PO / sent & open /
-- sent & paid — are a status field he has been maintaining by hand. This
-- migration turns them into states on the work order so the filing disappears.
--
-- THE CENTRAL IDEA: **completing a work order is currently a dead end.**
-- `work_orders.status` is open|completed, and once completed the money
-- conversation leaves for QuickBooks and never comes back. Completing should
-- START the invoice's life, not end the work order's. So the WO keeps its
-- open|completed status (unchanged, still means "is the paperwork done"), and
-- gains a SEPARATE invoice track alongside it.
--
-- ⚠ NAME COLLISION AVOIDED — READ THIS BEFORE ADDING ANY APPROVAL FIELD.
-- work_orders ALREADY has `approved_at`/`approved_by` AND
-- `admin_approved`/`admin_approved_at`. Those are DAILY-OPS approval: an admin
-- signing off a runner's submitted session. They have nothing to do with money.
-- The invoice fields here are deliberately prefixed `invoice_` so the two can
-- never be confused. Do not "tidy" them together.
--
-- WHAT IS STORED vs WHAT IS DERIVED — the honest split:
--   · BILLING invoices move through explicit states, because nothing in PRSFlo
--     can know that Eli approved something or that a cheque cleared. Those are
--     human acts and they are stored.
--   · COD invoices are NOT stored. Their bucket (with balance / paid) is
--     computed from charges vs payments by lib/woTotals.ts, which already
--     exists and is the same function the WO screen displays. Writing a COD
--     state down would create a second source of truth that can disagree with
--     the arithmetic on screen.
--   So `invoice_state` is NULL for COD work orders by design. Not an oversight.
--
-- CLOSED is the exception that applies to both. Eli: "just make a bucket to
-- toss em into so we can reference and move them out of the normal pipelines."
-- One bucket, but `invoice_closed_reason` records WHY — written off means money
-- was owed and collection was abandoned (bad debt); voided means the invoice
-- should never have existed (a correction). Same drawer, very different things
-- to an accountant, and collapsing them would lose that permanently.
--
-- CLEAN SLATE (Eli's ruling 2026-08-11): the existing Dropbox archive is NOT
-- imported. Every current work order starts with invoice_state NULL and enters
-- the pipeline only when someone acts on it. Backfilling historical states from
-- folder names would be guesswork presented as fact.
--
-- APPROVAL IS OWNERS ONLY (Eli + Adam-Mike). Enforced in RLS below, not just in
-- the UI — a policy is the only version of that rule that cannot be bypassed.
--
-- ⚠ PREREQUISITE, NOW SATISFIED: this makes PRSFlo the only copy of the
-- studio's financial documents. As of 2026-08-11 scripts/backup.mjs mirrors
-- every storage bucket nightly (including the `invoices` bucket created here,
-- automatically — it discovers buckets rather than listing them). Before that
-- fix this migration would have been reckless.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The invoice track on work_orders.
-- ---------------------------------------------------------------------------

alter table work_orders
  -- NULL = not in the invoice pipeline yet (or a COD WO, whose bucket is
  -- computed). Only billing invoices carry an explicit state.
  add column if not exists invoice_state text,
  add column if not exists invoice_closed_reason text,
  add column if not exists invoice_closed_at timestamptz,
  add column if not exists invoice_closed_by uuid references user_profiles(id) on delete set null,
  -- Owners only. NOT the same as approved_at/admin_approved — see the header.
  add column if not exists invoice_approved_at timestamptz,
  add column if not exists invoice_approved_by uuid references user_profiles(id) on delete set null,
  -- THE AGING CLOCK. Aging runs from when the invoice was SENT, not from the
  -- session date — a session invoiced three weeks late is not three weeks
  -- overdue. Every "31+ days" figure keys off this column.
  add column if not exists invoice_sent_at timestamptz,
  add column if not exists invoice_paid_at timestamptz,
  -- Path in the private `invoices` bucket. ONE document (the QuickBooks invoice
  -- PDF) — PRSFlo already renders the work order itself, so nothing is scanned
  -- or combined by hand. A column rather than a child table because one invoice
  -- per WO is the rule, not a simplification; promote it if that ever changes.
  add column if not exists invoice_doc_path text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_orders_invoice_state_ck') then
    alter table work_orders add constraint work_orders_invoice_state_ck check (
      invoice_state is null or invoice_state in (
        'needs_approval',  -- billing WO completed, waiting on an owner
        'approved',        -- owner signed off; ready to send
        'awaiting_po',     -- approved, but this client requires a PO we don't have
        'sent',            -- invoice is out; aging runs from invoice_sent_at
        'paid',            -- settled
        'closed'           -- written off or voided; out of every pipeline
      )
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'work_orders_invoice_closed_reason_ck') then
    alter table work_orders add constraint work_orders_invoice_closed_reason_ck check (
      invoice_closed_reason is null
      or invoice_closed_reason in ('written_off', 'voided')
    );
  end if;

  -- A closed invoice must say WHY. The whole point of one bucket with two
  -- meanings is that the meaning is recorded; without this the distinction
  -- rots the first time someone is in a hurry.
  if not exists (select 1 from pg_constraint where conname = 'work_orders_closed_needs_reason_ck') then
    alter table work_orders add constraint work_orders_closed_needs_reason_ck check (
      invoice_state is distinct from 'closed' or invoice_closed_reason is not null
    );
  end if;
end $$;

-- The hub's tab counts and the aging figures are the two hot queries.
create index if not exists idx_work_orders_invoice_state on work_orders(invoice_state);
create index if not exists idx_work_orders_invoice_sent_at on work_orders(invoice_sent_at)
  where invoice_sent_at is not null;

comment on column work_orders.invoice_state is
  'Billing invoice lifecycle: needs_approval → approved → [awaiting_po] → sent → paid, plus closed. NULL for COD work orders BY DESIGN — their bucket (with balance / paid) is computed from charges vs payments by lib/woTotals.ts, and storing it would create a second source of truth. NOT related to work_orders.status (open|completed = is the paperwork done) or approved_at/admin_approved (daily-ops sign-off).';

comment on column work_orders.invoice_sent_at is
  'When the invoice went out. THE AGING CLOCK — every "31+ days past due" figure counts from here, not from the session date. A session invoiced three weeks late is not three weeks overdue.';

comment on column work_orders.invoice_closed_reason is
  'written_off = money was owed and collection was abandoned (bad debt). voided = the invoice should never have existed (a correction). One bucket in the UI, two very different things to an accountant — required whenever invoice_state is ''closed''.';

-- ---------------------------------------------------------------------------
-- 2. Which clients require a PO.
--
-- Eli: "this is when the client, that require a PO, is dragging on getting us a
-- PO, but I have approved the invoice and WO already." So the awaiting_po
-- bucket is a CHASE state for a subset of clients, not a step everyone walks
-- through. work_orders.po_number already holds the number; nothing recorded the
-- requirement.
-- ---------------------------------------------------------------------------

alter table clients
  add column if not exists requires_po boolean not null default false;

comment on column clients.requires_po is
  'This client will not pay without a PO number. Drives the awaiting_po bucket in the billing hub: an approved invoice for such a client waits here until work_orders.po_number is filled. Most clients are false.';

-- ---------------------------------------------------------------------------
-- 3. Private bucket for the QuickBooks invoice PDFs.
--
-- Private, like client-ids — these are financial records. Reads go through
-- signed URLs, never a public path.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- Object policies. Owner/manager/billing only — the same tier that may see the
-- money. Named explicitly so a re-run replaces rather than duplicates them.
drop policy if exists invoices_read on storage.objects;
create policy invoices_read on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists invoices_insert on storage.objects;
create policy invoices_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists invoices_update on storage.objects;
create policy invoices_update on storage.objects for update to authenticated
  using (bucket_id = 'invoices' and get_my_role() in ('owner', 'manager', 'billing'));

-- Deleting a financial document is owner-only, deliberately.
drop policy if exists invoices_delete on storage.objects;
create policy invoices_delete on storage.objects for delete to authenticated
  using (bucket_id = 'invoices' and get_my_role() = 'owner');

-- ---------------------------------------------------------------------------
-- 4. APPROVAL IS OWNERS ONLY — enforced in the database.
--
-- Eli's ruling: only he and Adam-Mike approve invoices. A UI-only check is a
-- suggestion; this is the rule. The trigger fires on any write that sets
-- invoice_approved_at, whatever screen or script it came from.
--
-- Deliberately a trigger rather than an RLS policy: RLS on work_orders is
-- already row-level and role-tiered, and adding a column-conditional policy
-- there would entangle invoice approval with daily-ops permissions. A trigger
-- states this one rule in one place.
-- ---------------------------------------------------------------------------

create or replace function enforce_invoice_approver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- BOTH fields are guarded, not just the timestamp. Guarding only
  -- invoice_approved_at would leave invoice_approved_by writable by anyone —
  -- so a non-owner could stamp an owner's NAME onto an approval and only the
  -- date would be missing. The name is the part that matters in an audit.
  --
  -- `is distinct from` (not `<>`) because either side can be NULL, and NULL
  -- comparisons with <> silently evaluate to NULL — i.e. the guard would not
  -- fire on the very first approval, which is the one that counts.
  -- ANY change, in either direction. An earlier version only fired when the new
  -- value was non-null, which meant a non-owner could set both fields to NULL
  -- and silently STRIP an owner's approval — removing a sign-off is every bit
  -- as consequential as granting one. Blanking is a change; changes are owners.
  if new.invoice_approved_at is distinct from old.invoice_approved_at
     or new.invoice_approved_by is distinct from old.invoice_approved_by
  then
    if coalesce(get_my_role(), '') <> 'owner' then
      raise exception 'Only an owner can approve an invoice (attempted by role: %)',
        coalesce(get_my_role(), 'unknown');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_work_orders_invoice_approver on work_orders;
create trigger trg_work_orders_invoice_approver
  before update on work_orders
  for each row execute function enforce_invoice_approver();

-- ---------------------------------------------------------------------------
-- 5. Realtime. work_orders is already in the publication (the WO screens
--    subscribe to it), so this is a no-op guard rather than a change — but the
--    billing hub is another live surface on the same table and the standing
--    rule is that every fetch is paired with a subscription.
-- ---------------------------------------------------------------------------

alter table work_orders replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_orders'
  ) then
    alter publication supabase_realtime add table work_orders;
  end if;
end $$;

commit;
