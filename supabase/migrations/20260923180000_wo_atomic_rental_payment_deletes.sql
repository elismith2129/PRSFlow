-- 2026-09-23 — removed rentals and payments actually go away (WO-1220).
--
-- save_work_order_atomic UPSERTED rental_rows and payment_rows and never
-- deleted one. The × on a rental row only dropped it from React state; the
-- next save sent the survivors, the RPC upserted them, and the removed row sat
-- untouched in the table — back on the next open. Same for payments, and for
-- a row someone blanked out (blank rows are filtered from the payload, so they
-- were never written and never removed either).
--
-- Fix: delete BY OMISSION. The popup loads every rental/payment row for the WO
-- and sends back every one that still has content, so anything on this WO not
-- in the payload was removed on purpose. Bundles keep their explicit
-- p_bundle_deletes list (already shipped, already works); rentals and payments
-- don't need one — a client can't half-know a rental list the way it can a
-- bundle. Same signature as 20260914130000, so grants carry over.

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

  -- Removed rentals / payments: anything on this WO the client didn't send.
  delete from rental_rows
    where work_order_id = p_wo_id
      and id::text not in (select value ->> 'id' from jsonb_array_elements(coalesce(p_rentals, '[]'::jsonb)) where value ->> 'id' is not null);
  delete from payment_rows
    where work_order_id = p_wo_id
      and id::text not in (select value ->> 'id' from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) where value ->> 'id' is not null);

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
