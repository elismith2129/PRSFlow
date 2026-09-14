-- ─────────────────────────────────────────────────────────────────────────────
-- THE WHOLE-BUILDING BLANKET RATE (Eli, 2026-09-03 → built 2026-09-14).
-- docs/design-refs/wo-blanket-rate-options.html — Option B ruled: THE DAY
-- HEADER OWNS THE PRICE. lib/woBundles.ts carries the allocation.
--
-- A client takes several rooms for one custom price per day ($6,670 for all
-- five Paramount rooms). One invoice line, N rows in the app. A bundle is a
-- property of a DAY on a work order; every room row on that day is a member,
-- and each member's `charge` is its allocated share of the amount, pro-rata by
-- the row's own rate_daily (RACK — which the row keeps, because OT on a
-- bundled day prices off rack, never the share: "OT is rack").
--
-- Σ(member charges) = amount, to the penny, re-established by the app after
-- every edit (lib/woBundles.allocateBundleShares). Nothing here computes.
--
-- Second time this has cost manual work (supabase/one-off/20260910_concord_
-- blanket_rebuild.sql was the second). Those Concord rows are NOT bundled —
-- they carry the share in rate_daily and keep working unchanged.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.wo_rate_bundles (
  id                uuid primary key default gen_random_uuid(),
  work_order_id     uuid not null references public.work_orders(id) on delete cascade,
  -- text like every date in the app; matches studio_time_rows.date exactly
  date              text not null,
  amount            numeric not null check (amount >= 0),
  allocation_method text not null default 'pro_rata_rack'
                    check (allocation_method in ('pro_rata_rack')),
  -- What the client reads: "Paramount — whole building". Blank = derived.
  label             text,
  created_at        timestamptz not null default now(),
  -- ONE bundle per day per work order — the day owns the price (Option B).
  unique (work_order_id, date)
);

comment on table public.wo_rate_bundles is
  'Whole-building blanket rate: one custom price for all the room rows of one day on a work order. Each member row (studio_time_rows.bundle_id) carries its allocated share in charge; rate_daily stays the rack rate (allocation basis + OT basis).';

alter table public.studio_time_rows
  add column if not exists bundle_id uuid references public.wo_rate_bundles(id) on delete set null;

create index if not exists studio_time_rows_bundle_id_idx on public.studio_time_rows(bundle_id);

comment on column public.studio_time_rows.bundle_id is
  'Member of a whole-building blanket rate (wo_rate_bundles). When set, charge is the ALLOCATED SHARE of the bundle amount (pro-rata by rate_daily), not rate_daily itself. rate_daily stays rack.';

-- ── RLS: mirrors studio_time_rows (read staff++rn+tech · write staff++runner · delete mgr+)
alter table public.wo_rate_bundles enable row level security;

drop policy if exists wo_rate_bundles_sel on public.wo_rate_bundles;
create policy wo_rate_bundles_sel on public.wo_rate_bundles for select to authenticated
  using (get_my_role() in ('asst_manager','billing','manager','owner','runner','tech'));

drop policy if exists wo_rate_bundles_ins on public.wo_rate_bundles;
create policy wo_rate_bundles_ins on public.wo_rate_bundles for insert to authenticated
  with check (get_my_role() in ('asst_manager','billing','manager','owner'));

drop policy if exists wo_rate_bundles_upd on public.wo_rate_bundles;
create policy wo_rate_bundles_upd on public.wo_rate_bundles for update to authenticated
  using (get_my_role() in ('asst_manager','billing','manager','owner'))
  with check (get_my_role() in ('asst_manager','billing','manager','owner'));

drop policy if exists wo_rate_bundles_del on public.wo_rate_bundles;
create policy wo_rate_bundles_del on public.wo_rate_bundles for delete to authenticated
  using (get_my_role() in ('asst_manager','billing','manager','owner'));

-- ── save_work_order_atomic gains p_bundles + p_bundle_deletes ────────────────
-- Same dumb all-or-nothing applier (migration 20260728180000): values are
-- computed in TS, this only writes them. Order matters: bundles are upserted
-- BEFORE the rows that reference them, and deleted AFTER the rows have been
-- unlinked (FK is ON DELETE SET NULL anyway, belt and braces).
--
-- The old 8-argument signature is dropped FIRST. `create or replace` with two
-- extra defaulted parameters would otherwise leave both overloads in place and
-- PostgREST would refuse the call as ambiguous.
drop function if exists public.save_work_order_atomic(uuid, jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb);

create or replace function public.save_work_order_atomic(
  p_wo_id              uuid,
  p_wo                 jsonb,
  p_primary_booking_id uuid,
  p_primary_card       jsonb default null,
  p_st_rows            jsonb default '[]'::jsonb,
  p_rentals            jsonb default '[]'::jsonb,
  p_payments           jsonb default '[]'::jsonb,
  p_secondary_cards    jsonb default '[]'::jsonb,
  p_bundles            jsonb default '[]'::jsonb,
  p_bundle_deletes     jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_card  jsonb;
  v_match uuid;
  v_kept  uuid[] := '{}';
  v_del   uuid;
begin
  perform app_private.apply_update('work_orders', p_wo_id, p_wo);
  perform app_private.apply_upsert('wo_rate_bundles',  app_private.with_wo_id(p_bundles, p_wo_id));
  perform app_private.apply_upsert('studio_time_rows', app_private.with_wo_id(p_st_rows, p_wo_id));
  perform app_private.apply_upsert('rental_rows',      app_private.with_wo_id(p_rentals, p_wo_id));
  perform app_private.apply_upsert('payment_rows',     app_private.with_wo_id(p_payments, p_wo_id));

  for v_del in select (value ->> 0)::uuid from jsonb_array_elements(coalesce(p_bundle_deletes, '[]'::jsonb)) loop
    delete from wo_rate_bundles where id = v_del and work_order_id = p_wo_id;
  end loop;

  if p_primary_card is not null then
    perform app_private.apply_update('bookings', p_primary_booking_id, p_primary_card);

    for v_card in select * from jsonb_array_elements(coalesce(p_secondary_cards, '[]'::jsonb)) loop
      select id into v_match
        from bookings
        where work_order_id = p_wo_id
          and id <> p_primary_booking_id
          and studio = v_card ->> 'studio'
          and start_date::text = v_card ->> 'start_date'
          and not (id = any (v_kept))
        limit 1;
      if v_match is not null then
        perform app_private.apply_update('bookings', v_match, v_card);
      else
        v_match := app_private.apply_insert_one('bookings', v_card || jsonb_build_object('work_order_id', p_wo_id));
      end if;
      v_kept := v_kept || v_match;
    end loop;

    delete from bookings
      where work_order_id = p_wo_id
        and id <> p_primary_booking_id
        and not (id = any (v_kept));
  end if;

  return jsonb_build_object('ok', true);
end
$$;

revoke execute on function public.save_work_order_atomic(uuid, jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_work_order_atomic(uuid, jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
