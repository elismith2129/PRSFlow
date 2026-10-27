-- TENANTS: BILLING CAN EDIT LEASES (Eli, 2026-10-26: "lets have lori and studio
-- manager able to do this"). Billing joins owner + manager on insert/update —
-- change rent amounts and due dates, add tenants. Delete stays owner-only.
-- (Studio manager = role 'manager', which already had it.) Idempotent.

begin;

drop policy if exists "leases_insert" on public.leases;
create policy "leases_insert" on public.leases
  for insert to authenticated
  with check (get_my_role() in ('owner', 'manager', 'billing'));

drop policy if exists "leases_update" on public.leases;
create policy "leases_update" on public.leases
  for update to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'))
  with check (get_my_role() in ('owner', 'manager', 'billing'));

commit;
