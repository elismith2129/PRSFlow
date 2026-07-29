-- Staffing chosen at the LEAD stage, carried through to the Work Order.
--
-- Before this, `leads.engineer_needed` was a bare boolean that nothing outside
-- the CRM ever read, and staffing had to be typed onto every studio-time row by
-- hand. Now a lead records WHICH role and (optionally) WHICH person, that rides
-- onto the booking, and createWorkOrderForBooking seeds every row with it.
--
-- Three states, because sessions genuinely have three:
--   'engineer'  — 1ST. The exception; explicitly asked for.
--   'assistant' — 2ND. The normal case, and the default.
--   'none'      — no staff at all. Uncommon but real; seeds the studio-time
--                 rows with the staff sub-row hidden rather than blank.
--
-- The person's name stays OPTIONAL: "engineer, TBD" is a valid and common state
-- when a session is booked before staffing is settled. A name may be picked from
-- the `engineers` roster or typed free-hand (new hire, one-off freelancer).
--
-- `leads.engineer_needed` is left in place but is now VESTIGIAL — backfilled
-- into staff_role below and no longer read by the app. Drop it in a later
-- cleanup once nothing references it.
--
-- Idempotent / additive. Safe to re-run.

begin;

-- ── leads: which role, and optionally who ──
alter table leads
  add column if not exists staff_role text,
  add column if not exists staff_name text;

-- Backfill from the old boolean, then make assistant the default for new leads.
update leads
   set staff_role = case when engineer_needed is true then 'engineer' else 'assistant' end
 where staff_role is null;

alter table leads
  alter column staff_role set default 'assistant';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_staff_role_check') then
    alter table leads
      add constraint leads_staff_role_check
      check (staff_role is null or staff_role in ('engineer', 'assistant', 'none'));
  end if;
end $$;

comment on column leads.staff_role is
  'Staffing for the potential session: engineer (1ST) | assistant (2ND) | none. Rides onto bookings.staff_mode and seeds the WO studio-time rows.';
comment on column leads.staff_name is
  'Optional named staffer for the potential session. NULL = role decided, person TBD. Free text — may be off-roster.';

-- ── bookings: the same three-state signal, read by WO seeding ──
-- An explicit column rather than overloading engineer_status/assistant_status:
-- those default to 'not_needed', so a calendar-created booking and a genuine
-- "no staff" booking would otherwise be indistinguishable.
alter table bookings
  add column if not exists staff_mode text not null default 'assistant';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_staff_mode_check') then
    alter table bookings
      add constraint bookings_staff_mode_check
      check (staff_mode in ('engineer', 'assistant', 'none'));
  end if;
end $$;

-- Existing bookings: infer from whoever is already named, else leave the
-- assistant default. Only touches rows that actually name someone.
update bookings
   set staff_mode = 'engineer'
 where staff_mode = 'assistant'
   and coalesce(engineer_name, '') <> '';

comment on column bookings.staff_mode is
  'engineer (1ST) | assistant (2ND) | none. Seeded from the lead; decides the role of the WO studio-time staff sub-row. Defaults to assistant — an engineer is the exception.';

commit;
