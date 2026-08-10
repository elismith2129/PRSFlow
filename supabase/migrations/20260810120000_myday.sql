-- ===========================================================================
-- MY DAY — the operational duties layer (docs/MYDAY-BUILD.md §4)
--
-- Four tables, one seed. This is chunk 1 of the My Day build; nothing in the
-- app reads these yet. Eli runs this by hand in the Supabase SQL editor before
-- any dependent code is pushed.
--
-- THE MODEL (MYDAY-BUILD §1 — the triad):
--   • DUTIES    — myday_duties (template) + myday_entries (one per duty/day).
--   • QUEUES    — computed from app data at read time, never stored. Only the
--                 per-row step checkboxes are state → myday_queue_steps.
--   • SCRATCHPAD— myday_notes, free text per role per day.
--
-- WHY A TEMPLATE TABLE AND NOT CODE: unlike lib/testBatches.ts or lib/nadines.ts,
-- these rows are FK targets — myday_entries.duty_id points at them and carries
-- the permanent completion history (HR-SPEC §2.2 rule 4: a missed day is recorded
-- permanently). A duty definition therefore cannot live in a file that gets
-- rewritten on a commit. It has to have a stable id.
--
-- `duty_key` is the stable human key the seed upserts on, so re-running this
-- migration updates wording without creating duplicate duties or orphaning a
-- single entry row. NEVER RENAME a duty_key once entries exist against it —
-- same rule as venue_open_items.item_key.
--
-- ⚠ DEVIATION FROM THE BRIEF (approved by Eli 2026-08-10): §4 specs
-- `captured_count numeric` (one number per duty), but §2's billing COD duty
-- captures THREE numbers (COD outstanding · chased today · 31+ past due —
-- HR-SPEC §4 Phase 1). One slot could not hold them. So:
--   myday_duties.captures  jsonb  — ARRAY of {key,label} number fields ([] = none)
--   myday_entries.captured jsonb  — OBJECT keyed by those keys ({} = none)
-- Single-capture duties are just a one-element array / one-key object. Splitting
-- COD into three duties was rejected: it fragments one real action into three
-- ticks and lengthens the card, which HR-SPEC §2.2 rule 2 warns against.
--
-- RLS (MYDAY-BUILD §4 + HR-SPEC §5.6 coverage): owner/manager/billing read all
-- and write all — any manager can work another's card when someone is out, which
-- is why the card is not scoped to its own role. Who actually did it is recorded
-- in completed_by, not inferred from the row's role. Everyone else: nothing.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;


-- ---------------------------------------------------------------------------
-- 1. myday_duties — the template. Two role cards, seeded in section 5.
-- ---------------------------------------------------------------------------

create table if not exists myday_duties (
  id          uuid primary key default gen_random_uuid(),
  duty_key    text not null unique,
  role        text not null check (role in ('manager', 'billing')),
  label       text not null,
  cadence     text not null check (cadence in ('daily', 'weekly', 'monthly')),

  -- Weekly: day-of-week, Postgres extract(dow) convention — 0=Sun … 6=Sat.
  -- Monthly: day-of-month, 1–31.
  -- Daily: NULL (due every day).
  due_days    int[],

  -- point      = cannot be done late. Missed is missed (red square, then gone).
  -- cumulative = the work accrues; one row with a backlog counter, never a
  --              duplicate row per missed day (HR-SPEC §2.2 rule 3 / §2.3).
  dtype       text not null check (dtype in ('point', 'cumulative')),

  -- Array of {key,label} number fields captured on completion. [] = plain check.
  captures    jsonb not null default '[]'::jsonb
                check (jsonb_typeof(captures) = 'array'),

  -- Array of {key,label} sub-checkboxes shown under the duty. [] = none.
  sub_items   jsonb not null default '[]'::jsonb
                check (jsonb_typeof(sub_items) = 'array'),

  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Cadence/due_days coherence: a daily duty has no due_days; weekly and monthly
-- must have at least one. Added separately so a re-run on an existing table
-- picks it up.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'myday_duties_due_days_ck'
  ) then
    alter table myday_duties add constraint myday_duties_due_days_ck check (
      (cadence = 'daily'  and due_days is null)
      or (cadence in ('weekly', 'monthly') and due_days is not null
          and array_length(due_days, 1) >= 1)
    );
  end if;
end $$;

create index if not exists idx_myday_duties_role_active
  on myday_duties(role, is_active, sort_order);


-- ---------------------------------------------------------------------------
-- 2. myday_entries — one row per duty per date. The permanent history.
-- ---------------------------------------------------------------------------

create table if not exists myday_entries (
  id             uuid primary key default gen_random_uuid(),
  duty_id        uuid not null references myday_duties(id) on delete cascade,
  date           date not null,

  completed_at   timestamptz,
  -- WHO did it, which is not the same as whose card it is (HR-SPEC §5.6).
  completed_by   uuid references user_profiles(id) on delete set null,

  -- Object keyed by myday_duties.captures[].key — see the deviation note above.
  captured       jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(captured) = 'object'),

  -- Object keyed by myday_duties.sub_items[].key → boolean.
  sub_state      jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(sub_state) = 'object'),

  -- Cumulative duties only: the earliest date this completion cleared. The
  -- backlog COUNT is derived in TS (lib/myday.ts), never stored — a stored
  -- counter goes stale the moment a day passes without anyone opening the app.
  covers_from    date,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (duty_id, date)
);

create index if not exists idx_myday_entries_date on myday_entries(date);
-- Drives the 14-day staff grid (MYDAY-BUILD §6.2) and the backlog scan.
create index if not exists idx_myday_entries_duty_date
  on myday_entries(duty_id, date desc);


-- ---------------------------------------------------------------------------
-- 3. myday_queue_steps — per-row step checkboxes on the computed queues.
--
-- The queues themselves (needs-WO, balances, holds, booked, open hours) are
-- COMPUTED from bookings/work_orders at read time — MYDAY-BUILD §3. Nothing
-- about a queue is stored except which steps have been ticked, which is here.
--
-- ref_id is always a bookings.id today (holds, booked pipeline, and open-hours
-- blocks are all booking rows), so it carries a real FK: when a booking is
-- deleted its step ticks go with it rather than lingering as unreachable rows.
-- ref_type stays explicit anyway so a future non-booking queue can join here
-- without a schema change.
-- ---------------------------------------------------------------------------

create table if not exists myday_queue_steps (
  id          uuid primary key default gen_random_uuid(),
  ref_type    text not null check (ref_type in ('hold', 'booked', 'open_hours')),
  ref_id      uuid not null references bookings(id) on delete cascade,
  step        text not null,
  checked_at  timestamptz,
  checked_by  uuid references user_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (ref_type, ref_id, step)
);

create index if not exists idx_myday_queue_steps_ref
  on myday_queue_steps(ref_type, ref_id);


-- ---------------------------------------------------------------------------
-- 4. myday_notes — the scratchpad. Free text, per role per day. Debounced
--    autosave (800ms, the checklist pattern) writes here.
-- ---------------------------------------------------------------------------

create table if not exists myday_notes (
  id             uuid primary key default gen_random_uuid(),
  role           text not null check (role in ('manager', 'billing')),
  date           date not null,
  session_notes  text,
  studio_notes   text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references user_profiles(id) on delete set null,

  unique (role, date)
);


-- ---------------------------------------------------------------------------
-- 5. Seed — the two role cards (MYDAY-BUILD §2).
--
-- Sources: FD Daily Notes Template + Fernando's verbal walkthrough (manager);
-- PRS Billing Coordinator Procedures §2–3 as edited by Aaron (billing).
-- "Valley" = the ARS/ERS/TRK satellites.
--
-- Upsert on duty_key so a re-run refreshes wording/config without duplicating.
-- is_active is deliberately NOT in the DO UPDATE list: if Eli retires a duty in
-- the app, re-running this migration must not resurrect it.
-- ---------------------------------------------------------------------------

insert into myday_duties
  (duty_key, role, label, cadence, due_days, dtype, captures, sub_items, sort_order)
values

  -- ---- MANAGER · daily -----------------------------------------------------
  -- Four studio check-ins. Each is `point`: a check-in you didn't do yesterday
  -- cannot be done today, it's just missed.
  ('mgr_checkin_prs', 'manager', 'Studio check-in — Paramount (PRS)',
   'daily', null, 'point', '[]'::jsonb,
   '[{"key":"opener_closer","label":"Opener/closer confirmed"},
     {"key":"sessions_reviewed","label":"Today''s sessions reviewed"},
     {"key":"slack_read","label":"Yesterday''s Slack read"},
     {"key":"checkin_done","label":"Check-in done"}]'::jsonb, 10),

  ('mgr_checkin_ars', 'manager', 'Studio check-in — Ameraycan (ARS)',
   'daily', null, 'point', '[]'::jsonb,
   '[{"key":"opener_closer","label":"Opener/closer confirmed"},
     {"key":"sessions_reviewed","label":"Today''s sessions reviewed"},
     {"key":"slack_read","label":"Yesterday''s Slack read"},
     {"key":"checkin_done","label":"Check-in done"}]'::jsonb, 20),

  -- Encore carries one extra item.
  ('mgr_checkin_ers', 'manager', 'Studio check-in — Encore (ERS)',
   'daily', null, 'point', '[]'::jsonb,
   '[{"key":"opener_closer","label":"Opener/closer confirmed"},
     {"key":"sessions_reviewed","label":"Today''s sessions reviewed"},
     {"key":"slack_read","label":"Yesterday''s Slack read"},
     {"key":"checkin_done","label":"Check-in done"},
     {"key":"mustard_start","label":"Mustard''s start time"}]'::jsonb, 30),

  -- Track carries a different extra item.
  ('mgr_checkin_trk', 'manager', 'Studio check-in — Track (TRK)',
   'daily', null, 'point', '[]'::jsonb,
   '[{"key":"opener_closer","label":"Opener/closer confirmed"},
     {"key":"sessions_reviewed","label":"Today''s sessions reviewed"},
     {"key":"slack_read","label":"Yesterday''s Slack read"},
     {"key":"checkin_done","label":"Check-in done"},
     {"key":"cleaning_shift","label":"Cleaning shift"}]'::jsonb, 40),

  -- Timecards accrue: miss Tuesday and Wednesday's row covers both days.
  ('mgr_adp_timecards', 'manager', 'ADP runner timecards',
   'daily', null, 'cumulative',
   '[{"key":"exceptions_cleared","label":"Exceptions cleared"}]'::jsonb,
   '[]'::jsonb, 50),

  ('mgr_deliverables', 'manager', 'Deliverables / schedule',
   'daily', null, 'point', '[]'::jsonb, '[]'::jsonb, 60),

  ('mgr_calendar_lookahead', 'manager', 'Calendar look-ahead',
   'daily', null, 'point', '[]'::jsonb, '[]'::jsonb, 70),

  ('mgr_staff_tasks_review', 'manager', 'Staff tasks review',
   'daily', null, 'point', '[]'::jsonb, '[]'::jsonb, 80),

  -- ---- MANAGER · weekly ----------------------------------------------------
  -- Office stock is the MANAGER's, not billing's — Aaron explicitly deleted it
  -- from his procedures doc. Do not move it back.
  -- Both are `cumulative`, not `point` (RULING 2026-08-10, applied by migration
  -- 20260810130000): Eli must be able to do them on any day, so a late
  -- completion has to CLEAR the miss rather than leave it red forever. They stay
  -- weekly so "expected Wed" / "expected Tue+Fri" still drives the grid and the
  -- briefing. Kept in step here so replaying this seed cannot revert them.
  ('mgr_office_stock', 'manager', 'Office stock',
   'weekly', array[3], 'cumulative', '[]'::jsonb, '[]'::jsonb, 90),     -- Wed

  ('mgr_valley_checks', 'manager', 'Valley checks (ARS · ERS · TRK)',
   'weekly', array[2, 5], 'cumulative', '[]'::jsonb, '[]'::jsonb, 100), -- Tue + Fri

  -- ---- BILLING · daily -----------------------------------------------------
  ('bil_ramp_transactions', 'billing',
   'Approve Ramp transactions + chase missing receipts',
   'daily', null, 'cumulative',
   '[{"key":"transactions_cleared","label":"Transactions cleared"}]'::jsonb,
   '[]'::jsonb, 10),

  ('bil_collect_wos', 'billing',
   'Collect + accuracy-check yesterday''s WOs',
   'daily', null, 'cumulative', '[]'::jsonb, '[]'::jsonb, 20),

  ('bil_qb_invoices', 'billing',
   'Update last night''s invoices in QB (Daily Invoice Procedure)',
   'daily', null, 'cumulative',
   '[{"key":"invoices_updated","label":"Invoices updated"}]'::jsonb,
   '[]'::jsonb, 30),

  -- Point, not cumulative: this is about TODAY's confirmed sessions. Sessions
  -- that slipped through are caught by the needs-WO queue (MYDAY-BUILD §3),
  -- which is where the backlog actually lives — a counter here would double-count.
  ('bil_create_wos', 'billing',
   'Create WOs for today''s confirmed sessions',
   'daily', null, 'point', '[]'::jsonb, '[]'::jsonb, 40),

  -- The three-number duty the captures/captured deviation exists for.
  -- Typed by hand in Phase 1; computed when the QBO integration lands (HR-SPEC §4).
  ('bil_cod_followup', 'billing',
   'COD invoicing + outstanding follow-up',
   'daily', null, 'cumulative',
   '[{"key":"cod_outstanding","label":"COD outstanding"},
     {"key":"chased_today","label":"Chased today"},
     {"key":"past_due_31","label":"31+ past due"}]'::jsonb,
   '[]'::jsonb, 50),

  -- ---- BILLING · weekly ----------------------------------------------------
  ('bil_ramp_weekly_report', 'billing', 'Ramp weekly report',
   'weekly', array[1], 'point', '[]'::jsonb, '[]'::jsonb, 60),          -- Mon

  -- Rule: sent >14d AND last touch >7d. Manual in Phase 1, computed later.
  ('bil_invoice_followup_list', 'billing',
   'Open / sent-invoice follow-up list',
   'weekly', array[1], 'cumulative', '[]'::jsonb, '[]'::jsonb, 70),     -- Mon

  -- ---- BILLING · monthly ---------------------------------------------------
  -- Two duties, not one (Eli's ruling 2026-08-10): creating the invoices on the
  -- 25th and chasing them on the 5th are separate acts on separate days. A single
  -- row with due_days {5,25} could not say which half had been done.
  ('bil_tenant_rent_create', 'billing', 'Create tenant rent invoices',
   'monthly', array[25], 'point', '[]'::jsonb, '[]'::jsonb, 80),

  ('bil_tenant_rent_followup', 'billing', 'Tenant rent follow-up',
   'monthly', array[5], 'cumulative', '[]'::jsonb, '[]'::jsonb, 90)

on conflict (duty_key) do update set
  role       = excluded.role,
  label      = excluded.label,
  cadence    = excluded.cadence,
  due_days   = excluded.due_days,
  dtype      = excluded.dtype,
  captures   = excluded.captures,
  sub_items  = excluded.sub_items,
  sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------------
-- 6. updated_at triggers (reuses the existing set_updated_at() from the
--    dashboard_tasks migration — do not redefine it here).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_myday_entries_updated on myday_entries;
    create trigger trg_myday_entries_updated before update on myday_entries
      for each row execute function set_updated_at();

    drop trigger if exists trg_myday_notes_updated on myday_notes;
    create trigger trg_myday_notes_updated before update on myday_notes
      for each row execute function set_updated_at();
  else
    raise notice 'set_updated_at() not found — myday updated_at triggers skipped';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 7. RLS — owner/manager/billing read + write all four tables.
--
-- Deliberately NOT scoped to the viewer's own role: HR-SPEC §5.6 says any
-- manager must be able to work another's card when someone is out. Attribution
-- comes from completed_by / checked_by / updated_by, not from who may see what.
-- tech, runner and asst_manager get nothing — My Day is a manager+billing surface.
-- ---------------------------------------------------------------------------

alter table myday_duties      enable row level security;
alter table myday_entries     enable row level security;
alter table myday_queue_steps enable row level security;
alter table myday_notes       enable row level security;

-- myday_duties: everyone allowed in can read the template; only owner/manager
-- may change it (HR-SPEC §2.2 rule 1 — staff cannot add items to their own card,
-- adding items is an admin action). Billing reads, does not edit.
drop policy if exists myday_duties_sel on myday_duties;
create policy myday_duties_sel on myday_duties for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_duties_ins on myday_duties;
create policy myday_duties_ins on myday_duties for insert to authenticated
  with check (get_my_role() in ('owner', 'manager'));

drop policy if exists myday_duties_upd on myday_duties;
create policy myday_duties_upd on myday_duties for update to authenticated
  using (get_my_role() in ('owner', 'manager'))
  with check (get_my_role() in ('owner', 'manager'));

drop policy if exists myday_duties_del on myday_duties;
create policy myday_duties_del on myday_duties for delete to authenticated
  using (get_my_role() = 'owner');

-- myday_entries: the coverage rule. Read and write for all three roles.
-- No DELETE policy — a completion record is history (HR-SPEC §2.2 rule 4:
-- missing a day is recorded permanently). Corrections are UPDATEs.
drop policy if exists myday_entries_sel on myday_entries;
create policy myday_entries_sel on myday_entries for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_entries_ins on myday_entries;
create policy myday_entries_ins on myday_entries for insert to authenticated
  with check (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_entries_upd on myday_entries;
create policy myday_entries_upd on myday_entries for update to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'))
  with check (get_my_role() in ('owner', 'manager', 'billing'));

-- myday_queue_steps: same three roles. Delete allowed — unticking a step by
-- removing the row is legitimate, and these carry no compliance history.
drop policy if exists myday_queue_steps_sel on myday_queue_steps;
create policy myday_queue_steps_sel on myday_queue_steps for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_queue_steps_ins on myday_queue_steps;
create policy myday_queue_steps_ins on myday_queue_steps for insert to authenticated
  with check (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_queue_steps_upd on myday_queue_steps;
create policy myday_queue_steps_upd on myday_queue_steps for update to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'))
  with check (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_queue_steps_del on myday_queue_steps;
create policy myday_queue_steps_del on myday_queue_steps for delete to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'));

-- myday_notes: same three roles, full write. Shift notes are working material.
drop policy if exists myday_notes_sel on myday_notes;
create policy myday_notes_sel on myday_notes for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_notes_ins on myday_notes;
create policy myday_notes_ins on myday_notes for insert to authenticated
  with check (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_notes_upd on myday_notes;
create policy myday_notes_upd on myday_notes for update to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'))
  with check (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists myday_notes_del on myday_notes;
create policy myday_notes_del on myday_notes for delete to authenticated
  using (get_my_role() in ('owner', 'manager'));


-- ---------------------------------------------------------------------------
-- 8. Explicit grants. Tables created before 2026-05-30 are grandfathered into
--    the old blanket grants; anything newer needs these spelled out or every
--    query fails with a permission error that looks like RLS but isn't.
--    (CLAUDE.md — new-table GRANT rule. Grandfathering ends 2026-10-30.)
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on myday_duties      to authenticated;
grant select, insert, update, delete on myday_entries     to authenticated;
grant select, insert, update, delete on myday_queue_steps to authenticated;
grant select, insert, update, delete on myday_notes       to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Realtime. Standing architecture rule: every fetch is paired with a
--    subscription, which needs publication membership + full replica identity.
--    Channels will be myday-* (MYDAY-BUILD §4).
-- ---------------------------------------------------------------------------

alter table myday_duties      replica identity full;
alter table myday_entries     replica identity full;
alter table myday_queue_steps replica identity full;
alter table myday_notes       replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array[
    'myday_duties', 'myday_entries', 'myday_queue_steps', 'myday_notes'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 10. Table comments.
-- ---------------------------------------------------------------------------

comment on table myday_duties is
  'My Day duty TEMPLATE — the fixed per-role card (manager | billing). Seeded from docs/MYDAY-BUILD.md §2. Upsert key is duty_key; NEVER rename a duty_key once myday_entries exist against it. captures is an ARRAY of {key,label} number fields (widened from the brief''s single captured_count so the billing COD duty can hold its three figures). Staff cannot add rows — admin action only (HR-SPEC §2.2 rule 1).';

comment on table myday_entries is
  'One row per duty per date — the permanent completion history. A missed day is recorded permanently (HR-SPEC §2.2 rule 4), so there is no DELETE policy; corrections are updates. captured is an OBJECT keyed by the duty''s captures[].key. covers_from marks how far back a cumulative completion reached; the backlog COUNT is derived in lib/myday.ts, never stored.';

comment on table myday_queue_steps is
  'Per-row step checkboxes on the COMPUTED queues (holds, booked pipeline, open hours — docs/MYDAY-BUILD.md §3). The queues themselves are derived from bookings/work_orders at read time and are never stored; only these ticks are state. ref_id is a bookings.id and cascades on delete.';

comment on table myday_notes is
  'My Day scratchpad — free-text shift notes, one row per role per day. Debounced autosave (800ms, the checklist pattern). Deliberately unstructured: MYDAY-BUILD §1 says do not systematize this.';

commit;
