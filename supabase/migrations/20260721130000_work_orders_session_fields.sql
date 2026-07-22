-- ===========================================================================
-- WO rebuild — Step 4 of docs/WO-SPEC.md
-- Run ONCE in the Supabase SQL editor. Idempotent, additive only.
--
-- Makes the Work Order self-contained for all SESSION-LEVEL fields, so the WO
-- is a true single source of truth and doesn't lean on a booking row to
-- remember client identity / status. These were previously booking-only:
--
--   session_status      — Confirmed / Tentative / Cancelled / Tour / Tech /
--                         Open Hours (the WO top status bar). Distinct from
--                         work_orders.status, which is the WO lifecycle
--                         (open / completed) and is left untouched.
--   session_type        — recording / filming / event_playback.
--   client_id           — link to the clients profile row.
--   is_srs              — Studio Referral Service flag.
--   cod_method          — Cash / Credit Card / Zelle / Check / Venmo (COD only).
--   anr_contact_id      — the A&R contact (client_contacts) who ordered.
--   anr_admin_contact_id— the label admin/billing contact (client_contacts).
--
-- On WO save, these are projected back onto the booking card row(s) (Step 5),
-- so the calendar/runner keep reflecting current client info.
-- ===========================================================================

alter table public.work_orders
  add column if not exists session_status text,
  add column if not exists session_type text,
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists is_srs boolean not null default false,
  add column if not exists cod_method text,
  add column if not exists anr_contact_id uuid references public.client_contacts(id) on delete set null,
  add column if not exists anr_admin_contact_id uuid references public.client_contacts(id) on delete set null;

-- Backfill session_status / session_type / client identity from the linked
-- booking for existing WOs, so nothing opens blank.
-- Note: bookings.anr_contact_id / anr_admin_contact_id are stored as text, so
-- they are cast to uuid (nullif → '' guards against empty strings). is_srs is
-- assigned directly, not coalesced — the new column's NOT NULL DEFAULT false
-- would otherwise mask the booking's real value.
update public.work_orders w
set
  session_status       = coalesce(w.session_status, b.status),
  session_type         = coalesce(w.session_type, b.session_type),
  client_id            = coalesce(w.client_id, b.client_id),
  is_srs               = b.is_srs,
  cod_method           = coalesce(w.cod_method, b.cod_method),
  anr_contact_id       = coalesce(w.anr_contact_id, nullif(b.anr_contact_id, '')::uuid),
  anr_admin_contact_id = coalesce(w.anr_admin_contact_id, nullif(b.anr_admin_contact_id, '')::uuid)
from public.bookings b
where w.booking_id = b.id;

-- No RLS change: existing work_orders policies cover new columns.
-- No realtime change: work_orders is already in the supabase_realtime
-- publication with REPLICA IDENTITY FULL.
