-- ASK FLO LOG (docs/ASK-FLO-BRIEF.md, 2026-10-22). Every question the help
-- bubble is asked, with the answer, what it cited, and whether it cited
-- anything at all. Written by /api/ask with the service role; read by owners
-- on Admin → Ask log. The unanswered questions are the SOP gaps — that list
-- is the point of the whole feature.
--
-- No INSERT/UPDATE/DELETE policy for authenticated: the route is the only
-- writer and nobody edits history. Idempotent.

create table if not exists public.ask_log (
  id          uuid primary key default gen_random_uuid(),
  asked_by    uuid references public.user_profiles(id) on delete set null,
  role        text,
  question    text not null,
  answer      text,
  cited       text[] not null default '{}',
  answered    boolean not null default false,
  latency_ms  integer,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists ask_log_created_idx on public.ask_log (created_at desc);

alter table public.ask_log enable row level security;

drop policy if exists ask_log_sel on public.ask_log;
create policy ask_log_sel on public.ask_log
  for select to authenticated
  using (get_my_role() = 'owner');

grant select on public.ask_log to authenticated;
grant all on public.ask_log to service_role;

select count(*) as questions from public.ask_log;
