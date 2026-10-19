-- LAKERS: two fixes found reading the Oct 1 work (2026-10-19, v1.45.0).
--
-- 1. RLS let only role=owner in, but the page (and the rail) also let Eli in by
--    email. If Eli's profile role isn't 'owner' the page loaded EMPTY with no
--    error - the gate and the policy disagreed. Now the policy says what the
--    page says: owners, or Eli. get_my_email() is SECURITY DEFINER like
--    get_my_role(), so it reads user_profiles regardless of that table's RLS.
--
-- 2. One seed row was split on a comma: "Haiko (sixbill, sosocamo)" went in as
--    two names ('Haiko (sixbill' and 'sosocamo)'). Put the one name back. The
--    comma split in the UI is gone too (names are one per line now).
--
-- Idempotent: safe to run twice.

begin;

create or replace function public.get_my_email()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select lower(email) from public.user_profiles where auth_user_id = auth.uid()
$$;

drop policy if exists "lakers_games_owner" on public.lakers_games;
create policy "lakers_games_owner" on public.lakers_games
  for all to authenticated
  using (get_my_role() = 'owner' or get_my_email() = 'eli@paramountrecording.com')
  with check (get_my_role() = 'owner' or get_my_email() = 'eli@paramountrecording.com');

update public.lakers_games
   set passed = array['Haiko (sixbill, sosocamo)', 'Gabi Kochlani', 'Sesen'],
       updated_at = now()
 where season = '25-26' and game_date = '2025-10-21'
   and passed @> array['Haiko (sixbill'];

commit;

select game_date, opponent, passed from public.lakers_games
 where season = '25-26' and game_date = '2025-10-21';
