-- ─────────────────────────────────────────────────────────────────────────────
-- SMS opt-in (Eli, 2026-09-29). The registration form's "Communication"
-- paragraph, buried in the T&C behind one "I agree" box, is NOT consent to
-- text anyone: TCPA wants prior express written consent — a separate,
-- unchecked box that says "text", names the sender, and gives frequency,
-- rates and STOP — and the carriers' 10DLC registration asks to see it.
-- Booking-related texts ("your session is tomorrow") ride on the phone number
-- itself; PROMOTIONAL texts need this.
--
-- Two pieces:
--   · clients.sms_opt_in + when + which number — the live flag the texting
--     list filters on. Consent is tied to the NUMBER (sms_opt_in_phone): if
--     the client changes phones the flag should be re-earned, not carried.
--   · sms_consent_log — the paper trail: every opt-in and opt-out, with the
--     exact words shown, IP and user agent. Append-only. This is what you
--     produce if anyone ever asks "when did I agree to this?".
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code lands.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clients add column if not exists sms_opt_in        boolean not null default false;
alter table public.clients add column if not exists sms_opt_in_at     timestamptz;
alter table public.clients add column if not exists sms_opt_in_phone  text;
alter table public.clients add column if not exists sms_opt_out_at    timestamptz;

create index if not exists clients_sms_opt_in on public.clients (sms_opt_in) where sms_opt_in;

create table if not exists public.sms_consent_log (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  phone         text not null,
  action        text not null check (action in ('opt_in', 'opt_out')),
  -- 'registration' (the form), 'staff' (office recorded a STOP or a verbal
  -- yes), 'sms' (a STOP reply, once inbound texting exists)
  source        text not null check (source in ('registration', 'staff', 'sms')),
  consent_text  text,            -- the exact words beside the box, verbatim
  ip            text,
  user_agent    text,
  by_staff      uuid references public.user_profiles(id),
  created_at    timestamptz not null default now()
);

create index if not exists sms_consent_log_client on public.sms_consent_log (client_id, created_at desc);

alter table public.sms_consent_log enable row level security;

-- The office reads the trail; only the office writes opt-outs by hand. The
-- registration route writes with the service role (server-side, like the
-- rest of registration since the RLS hardening).
drop policy if exists "sms_consent_log_select" on public.sms_consent_log;
create policy "sms_consent_log_select" on public.sms_consent_log
  for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager'));

drop policy if exists "sms_consent_log_insert" on public.sms_consent_log;
create policy "sms_consent_log_insert" on public.sms_consent_log
  for insert to authenticated
  with check (get_my_role() in ('owner', 'manager', 'billing', 'asst_manager') and source = 'staff');

-- No UPDATE, no DELETE — a consent record is never edited.

grant select, insert on public.sms_consent_log to authenticated;
grant all on public.sms_consent_log to service_role;
