-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic Work Order RPCs (audit Phase 1 remainder)
--
-- Moves the two heavy multi-step save paths into single Postgres functions so
-- they are ALL-OR-NOTHING (a plpgsql function body is one transaction):
--
--   • create_work_order_atomic — WO insert (idempotent on booking_id) + booking
--     link + studio_time_rows seed + equipment_condition_rows seed.
--   • save_work_order_atomic   — WO update + studio/rental/payment row upserts
--     + the per-room-segment booking-card projection (primary update,
--     secondary upsert, stale delete).
--
-- DESIGN RULE — no second copy of the seeding/business logic:
-- every VALUE (rates, charges, OT, segments, card fields) is still computed in
-- TypeScript by the existing single-source code (lib/seedStudioTimeRows.ts,
-- WorkOrderPopup's projection). These functions are dumb ATOMIC APPLIERS of
-- prebuilt jsonb payloads. They never recompute business values, and they take
-- their column lists from the payload keys at runtime (jsonb_populate_record
-- does the type casting), so adding a column in the app code needs NO change
-- here. Payload arrays must be uniform (every element has the same keys) —
-- the TS builders guarantee that.
--
-- SECURITY: all functions are SECURITY INVOKER (the default) — RLS still
-- applies exactly as it does to the direct table writes these replace. The
-- generic helpers live in a private schema so PostgREST does not expose them
-- as /rpc endpoints; the two entry points are in public, revoked from anon.
--
-- Idempotent: safe to re-run (create or replace / if not exists throughout).
-- ─────────────────────────────────────────────────────────────────────────────

-- Private schema for the generic appliers (not exposed to PostgREST).
create schema if not exists app_private;
grant usage on schema app_private to authenticated;

-- ── Helper: UPDATE one row of a table from a jsonb payload ───────────────────
-- Only the keys present in the payload are written; types are cast by
-- jsonb_populate_record against the table's row type. Unknown keys error
-- loudly (they'd be an app bug), null values write NULL (intended).
create or replace function app_private.apply_update(p_table regclass, p_id uuid, p_payload jsonb)
returns void
language plpgsql
as $$
declare
  v_set text;
begin
  if p_payload is null then return; end if;
  select string_agg(format('%I = r.%I', k, k), ', ')
    into v_set
    from jsonb_object_keys(p_payload) as k;
  if v_set is null then return; end if;
  execute format(
    'update %s t set %s from jsonb_populate_record(null::%s, $1) r where t.id = $2',
    p_table, v_set, p_table
  ) using p_payload, p_id;
end
$$;

-- ── Helper: INSERT one row from jsonb, returning its id ──────────────────────
create or replace function app_private.apply_insert_one(p_table regclass, p_row jsonb)
returns uuid
language plpgsql
as $$
declare
  v_cols text;
  v_id uuid;
begin
  select string_agg(format('%I', k), ', ')
    into v_cols
    from jsonb_object_keys(p_row) as k;
  execute format(
    'insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) returning id',
    p_table, v_cols, v_cols, p_table
  ) into v_id using p_row;
  return v_id;
end
$$;

-- ── Helper: bulk INSERT rows from a jsonb array ──────────────────────────────
-- Columns absent from the payload keep their table DEFAULTs (unlike a naive
-- jsonb_populate_recordset(*) insert, which would write NULLs).
create or replace function app_private.apply_insert(p_table regclass, p_rows jsonb)
returns void
language plpgsql
as $$
declare
  v_cols text;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then return; end if;
  select string_agg(format('%I', k), ', ')
    into v_cols
    from jsonb_object_keys(p_rows -> 0) as k;
  execute format(
    'insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)',
    p_table, v_cols, v_cols, p_table
  ) using p_rows;
end
$$;

-- ── Helper: bulk UPSERT rows from a jsonb array (conflict on id) ─────────────
create or replace function app_private.apply_upsert(p_table regclass, p_rows jsonb)
returns void
language plpgsql
as $$
declare
  v_cols text;
  v_set  text;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then return; end if;
  select string_agg(format('%I', k), ', ')
    into v_cols
    from jsonb_object_keys(p_rows -> 0) as k;
  select string_agg(format('%I = excluded.%I', k, k), ', ')
    into v_set
    from jsonb_object_keys(p_rows -> 0) as k
    where k <> 'id';
  execute format(
    'insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
     on conflict (id) do update set %s',
    p_table, v_cols, v_cols, p_table, v_set
  ) using p_rows;
end
$$;

-- ── Helper: inject/overwrite work_order_id on every element of a jsonb array ─
create or replace function app_private.with_wo_id(p_rows jsonb, p_wo_id uuid)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (select jsonb_agg(e || jsonb_build_object('work_order_id', p_wo_id))
       from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e),
    '[]'::jsonb
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC 1: create_work_order_atomic
--   p_booking_id — the booking card the WO is created for
--   p_wo         — full work_orders insert payload (built by lib/createWorkOrder.ts,
--                  includes booking_id; wo_number comes from the table default)
--   p_st_rows    — studio_time_rows seed payloads (built by lib/seedStudioTimeRows.ts,
--                  WITHOUT work_order_id — injected here after the WO insert)
--   p_equip      — equipment_condition_rows seed payloads (WITHOUT work_order_id)
-- Returns { work_order_id, wo_number, created }. On conflict (a WO already
-- exists for this booking) the existing WO is adopted and NOTHING is seeded —
-- byte-for-byte the semantics of the old client-side createWorkOrderForBooking.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_work_order_atomic(
  p_booking_id uuid,
  p_wo         jsonb,
  p_st_rows    jsonb default '[]'::jsonb,
  p_equip      jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_cols    text;
  v_id      uuid;
  v_num     text;
  v_created boolean := false;
begin
  -- Idempotent WO insert: ON CONFLICT (booking_id) DO NOTHING.
  select string_agg(format('%I', k), ', ')
    into v_cols
    from jsonb_object_keys(p_wo) as k;
  execute format(
    'insert into work_orders (%s) select %s from jsonb_populate_record(null::work_orders, $1)
     on conflict (booking_id) do nothing
     returning id, wo_number',
    v_cols, v_cols
  ) into v_id, v_num using p_wo;

  if v_id is null then
    -- Conflict path: adopt the existing WO, seed nothing.
    select id, wo_number into v_id, v_num
      from work_orders
      where booking_id = p_booking_id
      order by created_at asc
      limit 1;
    if v_id is null then
      raise exception 'work_orders create returned no row and none exists for booking %', p_booking_id;
    end if;
  else
    v_created := true;
  end if;

  -- Link the booking card to its WO (new relationship direction) + WO number.
  update bookings set work_order_id = v_id, wo_number = v_num where id = p_booking_id;

  if v_created then
    perform app_private.apply_insert('studio_time_rows',          app_private.with_wo_id(p_st_rows, v_id));
    perform app_private.apply_insert('equipment_condition_rows',  app_private.with_wo_id(p_equip,   v_id));
  end if;

  return jsonb_build_object('work_order_id', v_id, 'wo_number', v_num, 'created', v_created);
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC 2: save_work_order_atomic
--   p_wo_id              — the work order being saved
--   p_wo                 — work_orders UPDATE payload (only the keys to write)
--   p_primary_booking_id — the canonical primary booking card
--   p_primary_card       — bookings UPDATE payload for the primary card
--                          (sessionFields + segment-0 schedule, built by
--                          WorkOrderPopup's projection code)
--   p_st_rows            — studio_time_rows upserts (each includes its id;
--                          work_order_id injected here)
--   p_rentals            — rental_rows upserts (each includes id + work_order_id)
--   p_payments           — payment_rows upserts (each includes id + work_order_id)
--   p_secondary_cards    — bookings payloads for segments 1..n. Each is matched
--                          to an existing secondary card of this WO by
--                          (studio, start_date) → UPDATE, else INSERT. Existing
--                          secondary cards not matched by any segment are
--                          DELETED (stale room-runs).
-- All-or-nothing: any failure rolls the whole save back.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.save_work_order_atomic(
  p_wo_id              uuid,
  p_wo                 jsonb,
  p_primary_booking_id uuid,
  p_primary_card       jsonb default null,
  p_st_rows            jsonb default '[]'::jsonb,
  p_rentals            jsonb default '[]'::jsonb,
  p_payments           jsonb default '[]'::jsonb,
  p_secondary_cards    jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_card  jsonb;
  v_match uuid;
  v_kept  uuid[] := '{}';
begin
  perform app_private.apply_update('work_orders', p_wo_id, p_wo);
  perform app_private.apply_upsert('studio_time_rows', app_private.with_wo_id(p_st_rows, p_wo_id));
  perform app_private.apply_upsert('rental_rows',      app_private.with_wo_id(p_rentals, p_wo_id));
  perform app_private.apply_upsert('payment_rows',     app_private.with_wo_id(p_payments, p_wo_id));

  -- Card projection runs only when the caller passed a primary card (i.e. the
  -- WO has a resolvable booking). Without that guard a save from a WO opened
  -- via a non-standard URL (no booking context) would wrongly delete cards.
  if p_primary_card is not null then
    perform app_private.apply_update('bookings', p_primary_booking_id, p_primary_card);

    -- Secondary cards: match existing by (studio, start_date), update in place
    -- to keep card ids stable (runner links); insert new segments; delete stale.
    for v_card in select * from jsonb_array_elements(coalesce(p_secondary_cards, '[]'::jsonb)) loop
      select id into v_match
        from bookings
        where work_order_id = p_wo_id
          and id <> p_primary_booking_id
          and studio = v_card ->> 'studio'
          and start_date = v_card ->> 'start_date'
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

-- ── Grants: entry points for logged-in staff only; nothing for anon ──────────
revoke execute on function public.create_work_order_atomic(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.save_work_order_atomic(uuid, jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_work_order_atomic(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.save_work_order_atomic(uuid, jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- The helpers must be executable by the invoker of the entry points
-- (SECURITY INVOKER), but live in app_private so PostgREST never exposes them.
grant execute on all functions in schema app_private to authenticated;
