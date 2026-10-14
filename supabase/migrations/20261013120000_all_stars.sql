-- ALL-STARS (Eli, 2026-10-13): "the owner just wants to be able to star
-- people as top players." A clickable star on lead + client profiles and an
-- All-Stars filter. Any admin (owner / manager / billing / asst_manager) can
-- toggle it — enforced in the UI; runners and tech never see the CRM.
--
-- ONE STAR PER PERSON. A client and every lead linked to it share one star:
--   * star / unstar a CLIENT  -> all of its leads follow
--   * star / unstar a LINKED lead -> its client follows (and so do the
--     client's other leads)
--   * link a lead to a STARRED client -> the lead becomes starred
--   * link a STARRED lead to a client -> the client becomes starred
--   * a lead with no client is starred on its own
-- Done here, in triggers, so no screen has to remember the rule and every
-- write path (CRM, clients page, lead->client conversion, scripts) obeys it.
-- The UI just reads leads.all_star / clients.all_star.
--
-- Loop guard: the client trigger updates leads; those lead updates fire the
-- lead trigger at depth > 1 and return immediately. The `is distinct from`
-- filters make every propagation a no-op once values agree.

alter table public.leads   add column if not exists all_star boolean not null default false;
alter table public.clients add column if not exists all_star boolean not null default false;

-- 1. A lead linked (on insert, or re-linked) to a starred client inherits the star.
create or replace function public.all_star_lead_inherit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
     and exists (select 1 from public.clients c where c.id = new.client_id and c.all_star) then
    new.all_star := true;
  end if;
  return new;
end $$;

drop trigger if exists leads_all_star_inherit on public.leads;
create trigger leads_all_star_inherit
  before insert or update of client_id on public.leads
  for each row execute function public.all_star_lead_inherit();

-- 2. A linked lead's star is the client's star: push it to the client.
create or replace function public.all_star_lead_to_client()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.client_id is not null then
    update public.clients
       set all_star = new.all_star
     where id = new.client_id
       and all_star is distinct from new.all_star;
  end if;
  return null;
end $$;

drop trigger if exists leads_all_star_to_client on public.leads;
create trigger leads_all_star_to_client
  after insert or update of all_star, client_id on public.leads
  for each row execute function public.all_star_lead_to_client();

-- 3. A client's star applies to every lead linked to it.
create or replace function public.all_star_client_to_leads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.leads
     set all_star = new.all_star
   where client_id = new.id
     and all_star is distinct from new.all_star;
  return null;
end $$;

drop trigger if exists clients_all_star_to_leads on public.clients;
create trigger clients_all_star_to_leads
  after update of all_star on public.clients
  for each row
  when (new.all_star is distinct from old.all_star)
  execute function public.all_star_client_to_leads();
