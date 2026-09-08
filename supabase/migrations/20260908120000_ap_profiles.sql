-- ─────────────────────────────────────────────────────────────────────────────
-- AP submission procedures — "the invoice is approved, now what?"
--
-- Every billing label has its own way of receiving an invoice: a portal, an AP
-- email, a PO that must be applied first, a submission form. That knowledge
-- lived in one spreadsheet and in Aaron's head. This puts it next to the
-- invoice, so a coordinator learning the job can read the steps at the moment
-- they need them.
--
-- SHAPE: many clients → one profile. The source sheet already works this way —
-- under UMG only Capitol carries a procedure and the other eleven divisions
-- inherit it, while Warner Chappell and Warner UK break away from Warner
-- Records with their own. So a profile IS the procedure, and divisions that
-- share one simply point at the same row. Where a division genuinely differs it
-- gets its own profile; where it differs in one detail only, `clients.ap_notes`
-- carries the addendum. That is deliberately simpler than field-level
-- inheritance, which this data does not need.
--
-- ⚠ NO PASSWORDS IN THIS TABLE. The source sheet carried nine plaintext portal
-- logins (Uniport, SAP Ariba, Graphite, Tipalti, Taulia, Stampli, Cecil Park).
-- They are deliberately NOT imported, and `credential_hint` is a POINTER, never
-- a secret. Two reasons, decided with Eli 2026-09-08:
--   1. These portals hold our remittance bank details and let a vendor change
--      them. The realistic attack is payment redirection — swap the ACH
--      destination and the label's next payment lands elsewhere.
--   2. The nightly backup copies every table to a Google Shared Drive, so
--      anything stored here leaves the app's RLS by 8am the next morning.
-- Passwords stay in the locked note. If someone later "helpfully" adds a
-- password column, this is the paragraph explaining why it was left out.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.ap_profiles (
  id                uuid primary key default gen_random_uuid(),

  -- Display name of the procedure ("Universal Music Group", "Warner Records
  -- (SAP Ariba)", "Sony — RCA / Columbia").
  name              text not null,

  -- Grouping for the admin list: UMG | WMG | Sony | Other | Global.
  family            text not null default 'Other',

  -- The single global reference card (Tipalti/Ariba explainers, international
  -- branch tips). Exactly one row should carry true; it renders under every
  -- label's card rather than being attached to a client.
  is_global         boolean not null default false,

  -- How the invoice actually goes out. Drives what the card leads with.
  -- email | portal | form | mixed
  submission_method text not null default 'email',

  -- PO discipline. The sheet marks "(NO PO)" explicitly on most misc clients
  -- because it is the single most common reason an invoice bounces.
  po_required       boolean not null default false,
  po_notes          text,

  -- Portal, when submission_method is portal/form/mixed.
  portal_name       text,
  portal_url        text,

  -- Login IDENTITY only — never the secret.
  login_email       text,
  credential_hint   text default 'Password is in the locked note — ask Eli or Aaron.',

  -- Who the invoice goes to, and who rides along on the email.
  submit_to         text,
  cc_to             text,

  -- ACH | ACH via Bill.com | Check in Mail | ACH/WIRE …
  payment_method    text,

  -- Ordered procedure: [{ "title": "short action", "detail": "the long part" }]
  -- Title is always visible; detail collapses. Warner's SAP Ariba PO-Flip is
  -- ~250 words and is unreadable as one block at 6pm on a Friday.
  steps             jsonb not null default '[]'::jsonb,

  -- Gotchas that are not steps (Interscope: over $5,000 the invoice must be
  -- dated AFTER the PO is issued).
  tips              text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.user_profiles(id) on delete set null
);

create unique index if not exists ap_profiles_name_key on public.ap_profiles (name);
-- At most one global reference card. (Partial unique index on the column
-- itself — Postgres rejects an index expression made only of constants, so the
-- `((true))` trick does not work here.)
create unique index if not exists ap_profiles_one_global
  on public.ap_profiles (is_global) where is_global;

-- ── Client → procedure link ─────────────────────────────────────────────────
-- ON DELETE SET NULL: retiring a procedure must never delete a client.
alter table public.clients
  add column if not exists ap_profile_id uuid
    references public.ap_profiles(id) on delete set null,
  -- Per-client addendum, shown under the shared procedure. This is the
  -- "override" — a division that differs in one detail (its own AP contact)
  -- without needing a whole profile of its own.
  add column if not exists ap_notes text;

create index if not exists clients_ap_profile_id_idx
  on public.clients (ap_profile_id) where ap_profile_id is not null;

-- ── updated_at ──────────────────────────────────────────────────────────────
drop trigger if exists ap_profiles_set_updated_at on public.ap_profiles;
create trigger ap_profiles_set_updated_at
  before update on public.ap_profiles
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Read: any signed-in staff member. A runner will never open this, but the
-- content is procedure, not secrets (see the header), and gating reads more
-- tightly would block an asst_manager covering a Monday send.
-- Write: billing + owner + manager — the people who own the AP relationship.
alter table public.ap_profiles enable row level security;

drop policy if exists ap_profiles_sel on public.ap_profiles;
create policy ap_profiles_sel on public.ap_profiles
  for select to authenticated
  using (get_my_role() IN ('asst_manager','billing','manager','owner','tech'));

drop policy if exists ap_profiles_ins on public.ap_profiles;
create policy ap_profiles_ins on public.ap_profiles
  for insert to authenticated
  with check (get_my_role() IN ('billing','manager','owner'));

drop policy if exists ap_profiles_upd on public.ap_profiles;
create policy ap_profiles_upd on public.ap_profiles
  for update to authenticated
  using (get_my_role() IN ('billing','manager','owner'))
  with check (get_my_role() IN ('billing','manager','owner'));

drop policy if exists ap_profiles_del on public.ap_profiles;
create policy ap_profiles_del on public.ap_profiles
  for delete to authenticated
  using (get_my_role() IN ('owner'));

-- New tables created after 2026-05-30 need explicit grants (CLAUDE.md).
grant select, insert, update, delete on public.ap_profiles to authenticated;

-- ── Realtime (standing rule: every fetch pairs with a subscription) ──────────
alter publication supabase_realtime add table public.ap_profiles;
alter table public.ap_profiles replica identity full;
