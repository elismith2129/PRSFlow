-- ─────────────────────────────────────────────────────────────────────────────
-- Business registration (v1.56.0, 2026-11-16)
--
-- A second registration form for labels, management companies, publishers and
-- brands. Same link mechanism (/register/<token>), same T&Cs, same consent log.
-- The TOKEN decides which form opens: registration_tokens.kind.
--
-- What it adds:
--   · registration_tokens.kind      'individual' (default — every link already
--                                   sent keeps working) | 'business'
--   · clients.email_opt_in / _at    email-campaign consent given on the form
--                                   (SMS already had this; email only had an
--                                   opt-OUT flag, so a business could never
--                                   positively opt in)
--   · clients.business_kind         label | management | publisher | brand | other
--   · clients.website
--   · clients.terms_signer_title    the title of the person who signed for the
--                                   company. The printed name itself goes in
--                                   signature_url, the same column the
--                                   individual form uses, so the Registration
--                                   Record reads both the same way.
--
-- Contacts land in client_contacts (billing/AP → contact_type 'admin', role
-- 'Billing / AP'; A&R → 'anr'). Billing preference (PO required?, how to send
-- invoices, where to send them) lands in an ap_profiles row named after the
-- company and linked via clients.ap_profile_id — that is what the AP card on
-- the invoice reads. No new table.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code lands.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.registration_tokens
  add column if not exists kind text not null default 'individual';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'registration_tokens_kind_check'
  ) then
    alter table public.registration_tokens
      add constraint registration_tokens_kind_check
      check (kind in ('individual', 'business'));
  end if;
end $$;

alter table public.clients add column if not exists email_opt_in        boolean not null default false;
alter table public.clients add column if not exists email_opt_in_at     timestamptz;
alter table public.clients add column if not exists business_kind       text;
alter table public.clients add column if not exists website             text;
alter table public.clients add column if not exists terms_signer_title  text;

create index if not exists clients_email_opt_in on public.clients (email_opt_in) where email_opt_in;

-- Sanity: how many tokens exist and none are business yet.
select kind, count(*) from public.registration_tokens group by kind;
