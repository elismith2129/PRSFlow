-- Punch correction requests — HR-SPEC §5, built 2026-08-14 (Eli's ruling).
--
-- The legal written confirmation California requires before a punch is edited,
-- as a database row: staff report a missed punch (shift clock in/out, meal
-- in/out), the manager queue reviews it, it gets entered in ADP. Per HR-SPEC:
-- NO work_order_id column, ever (shifts and sessions do not line up).
--
-- Tracking model (Eli, 2026-08-14): counts, not points. The admin HR page and
-- each person's own view show how many misses they have (and how they were
-- reported), colour-coded. A true "% of shifts punched correctly" needs shift
-- counts, which arrive with the future scheduling build — not modelled here.
--
-- Identity comes from the SESSION (individual logins ruling, spec §15b) — the
-- shared runner account is refused in the UI; RLS here enforces that a
-- non-manager can only file as themselves.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code ships.

create table if not exists punch_correction_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references user_profiles(id) on delete restrict,
  shift_date date not null,
  punch_type text not null check (punch_type in ('clock_in','clock_out','meal_out','meal_in','other')),
  claimed_time time not null,
  employee_note text,
  studio text check (studio in ('PRS','ARS','ERS','TRK')),
  submitted_at timestamptz not null default now(),
  report_class text not null default 'self_same_day'
    check (report_class in ('self_same_day','self_late','manager_found')),
  status text not null default 'pending'
    check (status in ('pending','approved','adjusted','rejected','entered_in_adp')),
  reviewed_by uuid references user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  approved_time time,
  reviewer_note text,
  adp_comment text,
  entered_at timestamptz,
  counts_toward_ladder boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_pcr_status on punch_correction_requests(status);
create index if not exists idx_pcr_staff_date on punch_correction_requests(staff_id, shift_date);

-- Classification is the DATABASE's job (HR-SPEC §5.3): same-day vs late is
-- derived from submitted_at vs shift_date and cannot be chosen by the client.
-- manager_found is the one class a manager may set explicitly when filing on
-- someone's behalf; anything else a client sends is overwritten.
create or replace function set_punch_report_class()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.report_class is distinct from 'manager_found' then
    if new.submitted_at::date = new.shift_date then
      new.report_class := 'self_same_day';
    else
      new.report_class := 'self_late';
    end if;
  end if;
  new.counts_toward_ladder := (new.report_class = 'manager_found');
  return new;
end $$;

drop trigger if exists trg_pcr_report_class on punch_correction_requests;
create trigger trg_pcr_report_class
  before insert on punch_correction_requests
  for each row execute function set_punch_report_class();

alter table punch_correction_requests enable row level security;

-- SELECT: your own rows, or owner/manager (the queue is visible to all
-- managers per HR-SPEC §5.6 coverage rule).
drop policy if exists pcr_sel on punch_correction_requests;
create policy pcr_sel on punch_correction_requests
  for select to authenticated
  using (
    staff_id = get_my_profile_id()
    or get_my_role() in ('owner','manager')
  );

-- INSERT: you may file for YOURSELF; owner/manager may file for anyone
-- (manager_found entries).
drop policy if exists pcr_ins on punch_correction_requests;
create policy pcr_ins on punch_correction_requests
  for insert to authenticated
  with check (
    staff_id = get_my_profile_id()
    or get_my_role() in ('owner','manager')
  );

-- UPDATE (review/approve/reject/enter-in-ADP): owner/manager only.
drop policy if exists pcr_upd on punch_correction_requests;
create policy pcr_upd on punch_correction_requests
  for update to authenticated
  using (get_my_role() in ('owner','manager'))
  with check (get_my_role() in ('owner','manager'));

-- No DELETE policy: the record is a legal confirmation — it is never destroyed.

-- Realtime (hard rule: every fetch pairs with a subscription).
alter table punch_correction_requests replica identity full;
do $$
begin
  alter publication supabase_realtime add table punch_correction_requests;
exception when duplicate_object then null;
end $$;
