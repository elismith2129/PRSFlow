-- HIRING (Eli, 2026-09-21): "really what i need is the checklist. be able to
-- create an onboarding for an employee or a promotion. type a name, select
-- new hire, promotion, or separation and then the checklists for each of
-- those… + the checklist for adding these to ADP."
--
-- One CASE per person-event (new hire / promotion / separation). The
-- checklist is COPIED onto the case from lib/hrChecklists.ts at create time —
-- three fixed lists in code, not the HR-SPEC §7 template engine. Copying
-- means a later edit to the constant never rewrites a live case. Dates are
-- computed from the case's anchor date (start / effective / last day) when
-- the rows are written.
--
-- hr_documents is the offer letter / job description per case: the FIELDS
-- are jsonb, the letter is rendered from them at send and sign time, and a
-- signed copy is frozen as a PDF in the private hr-documents bucket. The
-- login-free /sign/<token> page reads by token through the service role
-- (same mechanic as /m/<token> memos). Session 2 builds the send/sign flow;
-- this migration carries the table so there is one schema step, not two.
--
-- Pay is on the case, so RLS is owner + manager only (Fernando runs the
-- list and uploads the signed letter to ADP, so he sees the rate). No
-- delete policy on documents or items: a signed letter is a personnel
-- record. PRSFlo never talks to ADP (HR-SPEC §1.1) — ADP steps are rows
-- with the WFN menu path in help text.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code ships.

create table if not exists hr_cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_hire','promotion','separation')),
  subject_name text not null,
  staff_id uuid references user_profiles(id) on delete set null,
  recipient_email text,
  new_title text,
  studio text check (studio is null or studio in ('PRS','ARS','ERS','TRK')),
  -- start date (new hire) · effective date (promotion) · last day (separation)
  anchor_date date not null,
  separation_type text check (separation_type is null or separation_type in ('involuntary','quit_72_notice','quit_short_notice')),
  notice_at timestamptz,
  final_pay_due date,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  note text,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hr_cases_status on hr_cases(status, anchor_date);

create table if not exists hr_case_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references hr_cases(id) on delete cascade,
  sort_order int not null,
  grp text not null,
  label text not null,
  help text,
  owner_role text,
  due_on date,
  is_legal boolean not null default false,
  -- set for rows the app ticks itself (docs_signed · notice_recorded)
  auto_key text,
  done_at timestamptz,
  done_by uuid references user_profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_hr_case_items_case on hr_case_items(case_id, sort_order);

create table if not exists hr_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references hr_cases(id) on delete cascade,
  kind text not null check (kind in ('offer_letter','job_description')),
  fields jsonb not null default '{}'::jsonb,
  body text,
  recipient_email text,
  sign_token text unique,
  sent_at timestamptz,
  sent_by uuid references user_profiles(id) on delete set null,
  opened_at timestamptz,
  signed_at timestamptz,
  signed_name text,
  signed_ip text,
  signed_auth_user uuid,
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hr_documents_case on hr_documents(case_id, kind);

-- updated_at bookkeeping (same shape the other tables use)
create or replace function touch_hr_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_hr_cases_touch on hr_cases;
create trigger trg_hr_cases_touch before update on hr_cases
  for each row execute function touch_hr_updated_at();
drop trigger if exists trg_hr_documents_touch on hr_documents;
create trigger trg_hr_documents_touch before update on hr_documents
  for each row execute function touch_hr_updated_at();

-- Grants (post-May 30, 2026 rule: new tables need them explicitly)
grant select, insert, update, delete on hr_cases to authenticated;
grant select, insert, update, delete on hr_case_items to authenticated;
grant select, insert, update, delete on hr_documents to authenticated;

alter table hr_cases enable row level security;
alter table hr_case_items enable row level security;
alter table hr_documents enable row level security;

-- Owner + manager, all four verbs on cases and items. Closing a case is an
-- update, not a delete; delete exists for a case opened by mistake.
drop policy if exists hr_cases_all on hr_cases;
create policy hr_cases_all on hr_cases
  for all to authenticated
  using (get_my_role() in ('owner','manager'))
  with check (get_my_role() in ('owner','manager'));

drop policy if exists hr_case_items_all on hr_case_items;
create policy hr_case_items_all on hr_case_items
  for all to authenticated
  using (get_my_role() in ('owner','manager'))
  with check (get_my_role() in ('owner','manager'));

-- Documents: read / write, never delete from the client. The sign page never
-- touches this table as a user — it goes through the service role by token.
drop policy if exists hr_documents_sel on hr_documents;
create policy hr_documents_sel on hr_documents
  for select to authenticated
  using (get_my_role() in ('owner','manager'));
drop policy if exists hr_documents_ins on hr_documents;
create policy hr_documents_ins on hr_documents
  for insert to authenticated
  with check (get_my_role() in ('owner','manager'));
drop policy if exists hr_documents_upd on hr_documents;
create policy hr_documents_upd on hr_documents
  for update to authenticated
  using (get_my_role() in ('owner','manager'))
  with check (get_my_role() in ('owner','manager'));

-- Private bucket for signed PDFs and uploaded resignation letters. Reads are
-- signed URLs only — personnel records, never a public path.
insert into storage.buckets (id, name, public)
values ('hr-documents', 'hr-documents', false)
on conflict (id) do nothing;

drop policy if exists hr_documents_read on storage.objects;
create policy hr_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'hr-documents' and get_my_role() in ('owner','manager'));
drop policy if exists hr_documents_insert on storage.objects;
create policy hr_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-documents' and get_my_role() in ('owner','manager'));
-- No update / delete policies: a signed document is never rewritten.

-- Realtime (hard rule: every fetch pairs with a subscription).
alter table hr_cases replica identity full;
alter table hr_case_items replica identity full;
alter table hr_documents replica identity full;
do $$
begin
  alter publication supabase_realtime add table hr_cases;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table hr_case_items;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table hr_documents;
exception when duplicate_object then null;
end $$;

select
  (select count(*) from pg_policies where tablename in ('hr_cases','hr_case_items','hr_documents')) as hr_policies,
  (select count(*) from storage.buckets where id = 'hr-documents') as hr_bucket;
