-- ============================================================================
-- Oct 7, 2026 — REMOVE HOLD. One file, run once.
--
-- (Eli: "how do we delete holds? since we removed the delete button we can't
-- do that anymore from the cal. we need to be able to do that." Then: "instead
-- of delete it should be 'remove hold'… a window pops up, delete all days or
-- just one… select which days to delete or keep. this solves the problem of
-- people trying to delete just one day and accidentally deleting all. and then
-- I want on the billing hub a 'removed holds' where they will all live.")
--
-- THE GAP. Oct 5 took Delete off every session's work order — the button that
-- cost us WO-1240. Right for confirmed work; wrong for a hold. A hold is
-- dropped several times a week, and the only way left was to find it in the
-- billing hub and type its number.
--
-- WHAT THIS ADDS:
--   · remove_hold(p_wo_id, p_dates, p_whole) — the card's "Remove hold".
--       - TENTATIVE sessions only. Nothing completed, invoiced or paid, and
--         never a day that is confirmed, submitted or reviewed. Those stay
--         billing-hub-only, exactly as Oct 5 left them.
--       - p_whole false → those days come off; the hold and its other days
--                      stay. Logged as kind 'hold_days'.
--       - p_whole true  → the whole hold goes, through the same keep-a-full-
--                      copy path as every other delete. Logged as kind 'hold'.
--       - THE CALLER SAYS WHICH, AND THE DATABASE CHECKS IT. The whole point
--         is that nobody loses a week meaning to drop a day. So the card
--         always sends the days it was showing AND whether the person chose
--         "the whole hold". If the hold changed in the meantime — a day added
--         or removed by someone else — so that the two no longer agree, it
--         refuses and asks them to look again. It never guesses "whole".
--       - Owner, manager, billing AND assistant manager. Assistant managers
--         place holds; they can take them off. They still cannot delete a
--         work order any other way.
--   · A hold deleted from the billing hub's own Delete is logged as 'hold'
--     too, so "Removed holds" really is where they all live.
--   · recover_deleted_work_order() learns to put removed DAYS back onto a hold
--     that is still there.
--
-- DAYS BACK ON THE CALENDAR. Calendar cards are a projection the app draws
-- when a work order is saved. Recovering days happens from the billing hub,
-- with no work order open — so each recovered day gets its own one-day card,
-- copied from the card that covered that day when it was removed. The next
-- Save on the work order folds those back into one bar. Nothing is computed
-- here; the card is the saved one, with its dates narrowed to the day.
--
-- delete_with_archive()'s body moved, unchanged, into
-- app_private.archive_and_delete() so both doors use one keeper.
--
-- Needs 20261005180000 (the log) and 20261006120000 (restore_rows) first.
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code is pushed.
-- ============================================================================

-- ── 1. Two new kinds in the log ─────────────────────────────────────────────
do $$
declare v_con text;
begin
  for v_con in
    select conname from pg_constraint
     where conrelid = 'public.deleted_work_orders'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.deleted_work_orders drop constraint %I', v_con);
  end loop;
  alter table public.deleted_work_orders
    add constraint deleted_work_orders_kind_check
    check (kind in ('work_order', 'block', 'hold', 'hold_days'));
end $$;

create schema if not exists app_private;

-- ── 2. The keeper: snapshot, then delete. One transaction. ──────────────────
-- The body of delete_with_archive() as it shipped on Oct 5, moved here so the
-- hub's Delete and the card's Remove hold share it. NO role check of its own:
-- it is not callable from the app, only from the two functions below, and each
-- of those checks who is asking first.
--   p_kind — null: 'work_order' or 'block', decided as before. 'hold': a
--            tentative session, so it lands under Removed holds.
create or replace function app_private.archive_and_delete(p_wo_id uuid, p_booking_id uuid, p_kind text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid;
  v_name     text;
  v_wo_ids   uuid[] := '{}';
  v_card_ids uuid[] := '{}';
  v_wo_txt   text[];
  v_card_txt text[];
  v_snap     jsonb;
  v_rows     jsonb;
  v_tbl      text;
  v_kind     text;
  v_first_wo uuid;
  v_wo_num   text;
  v_title    text;
  v_detail   text;
  v_id       uuid;
begin
  -- Belt and braces. Execute is revoked below and both callers check the
  -- role first; this is for the day someone re-grants app_private wholesale.
  if get_my_role() is null
     or not (get_my_role() in ('owner', 'manager', 'billing')
             or (get_my_role() = 'asst_manager' and coalesce(p_kind, '') = 'hold')) then
    raise exception 'Not allowed';
  end if;
  if p_wo_id is null and p_booking_id is null then
    raise exception 'Nothing to delete';
  end if;

  select id, display_name into v_uid, v_name
    from user_profiles where auth_user_id = auth.uid() limit 1;

  if p_wo_id is not null then
    v_wo_ids := array[p_wo_id];
    v_kind := 'work_order';
  else
    select coalesce(array_agg(distinct x), '{}') into v_wo_ids from (
      select work_order_id as x from bookings where id = p_booking_id and work_order_id is not null
      union
      select id from work_orders where booking_id = p_booking_id
    ) s;
    v_kind := 'block';
  end if;
  v_kind := coalesce(p_kind, v_kind);

  select coalesce(array_agg(distinct b.id), '{}') into v_card_ids
    from bookings b
   where b.work_order_id = any (v_wo_ids)
      or b.id = p_booking_id
      or b.id in (select w.booking_id from work_orders w where w.id = any (v_wo_ids));

  if cardinality(v_wo_ids) = 0 and cardinality(v_card_ids) = 0 then
    raise exception 'Nothing found to delete';
  end if;

  v_wo_txt   := (select array_agg(x::text) from unnest(v_wo_ids) x);
  v_card_txt := (select array_agg(x::text) from unnest(v_card_ids) x);

  -- ── the snapshot ──
  v_snap := jsonb_build_object(
    'work_orders', (select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from work_orders w where w.id = any (v_wo_ids)),
    'bookings',    (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from bookings b where b.id = any (v_card_ids))
  );
  for v_tbl in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and c.column_name = 'work_order_id'
       and c.table_name not in ('bookings', 'deleted_work_orders')
     order by c.table_name
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.work_order_id::text = any ($1)', v_tbl)
      into v_rows using v_wo_txt;
    if jsonb_array_length(v_rows) > 0 then
      v_snap := v_snap || jsonb_build_object(v_tbl, v_rows);
    end if;
  end loop;
  -- srs_log is keyed on the booking card, not the work order.
  if to_regclass('public.srs_log') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.srs_log t where t.booking_id::text = any ($1)'
      into v_rows using v_card_txt;
    if jsonb_array_length(v_rows) > 0 then
      v_snap := v_snap || jsonb_build_object('srs_log', v_rows);
    end if;
  end if;

  -- ── what it was, in words, for the log ──
  select w.id, w.wo_number,
         concat_ws(' · ', nullif(btrim(coalesce(nullif(btrim(w.label), ''), w.client, '')), ''), nullif(btrim(coalesce(w.artist, '')), '')),
         concat_ws(' · ',
           (select string_agg(distinct concat_ws(' ', b.location, b.studio), ', ') from bookings b where b.id = any (v_card_ids)),
           (select case when min(r.date::text) = max(r.date::text) then min(r.date::text) else min(r.date::text) || ' to ' || max(r.date::text) end
              from studio_time_rows r where r.work_order_id = w.id and coalesce(btrim(r.studio), '') <> ''),
           (select count(distinct r.date) || case when count(distinct r.date) = 1 then ' day' else ' days' end
              from studio_time_rows r where r.work_order_id = w.id and coalesce(btrim(r.studio), '') <> ''),
           case when coalesce(w.invoice_number, '') <> '' then 'invoice ' || w.invoice_number end,
           case when w.invoice_state is not null then w.invoice_state end)
    into v_first_wo, v_wo_num, v_title, v_detail
    from work_orders w where w.id = any (v_wo_ids)
   order by w.created_at limit 1;

  if v_kind = 'block' or v_first_wo is null then
    -- A block is described by its card, even when a dormant work order rides along.
    select concat_ws(' · ', initcap(replace(b.status, '_', ' ')), nullif(btrim(coalesce(b.client_name, '')), '')),
           concat_ws(' · ', concat_ws(' ', b.location, b.studio),
             case when coalesce(b.end_date::text, b.start_date::text) = b.start_date::text then b.start_date::text else b.start_date::text || ' to ' || b.end_date::text end)
      into v_title, v_detail
      from bookings b where b.id = coalesce(p_booking_id, v_card_ids[1]);
  end if;

  insert into deleted_work_orders (deleted_by, deleted_by_name, kind, wo_id, wo_number, title, detail, snapshot)
  values (v_uid, coalesce(v_name, ''), v_kind, v_first_wo, v_wo_num, coalesce(v_title, ''), coalesce(v_detail, ''), v_snap)
  returning id into v_id;

  -- ── the delete ── children first, then the work order (its cards cascade),
  -- then any card that was not linked to it.
  foreach v_tbl in array array[
    'studio_time_rows', 'equipment_condition_rows', 'equipment_condition_notes', 'rental_rows',
    'payment_rows', 'wo_expenses', 'wo_collection_notes', 'wo_activity', 'srs_payouts', 'wo_rate_bundles'
  ] loop
    if to_regclass('public.' || v_tbl) is not null then
      execute format('delete from public.%I where work_order_id::text = any ($1)', v_tbl) using v_wo_txt;
    end if;
  end loop;
  if to_regclass('public.srs_log') is not null then
    execute 'delete from public.srs_log where booking_id::text = any ($1)' using v_card_txt;
  end if;
  delete from work_orders where id = any (v_wo_ids);
  delete from bookings where id = any (v_card_ids);

  return jsonb_build_object('ok', true, 'archive_id', v_id, 'title', v_title, 'wo_number', v_wo_num, 'kind', v_kind);
end
$$;

revoke all on function app_private.archive_and_delete(uuid, uuid, text) from public, anon, authenticated;

-- ── 3. The billing hub's Delete (and a block's Delete) — same door as Oct 5 ─
-- Same name, same arguments, same three roles. The one difference: a
-- TENTATIVE session is logged as a hold.
create or replace function public.delete_with_archive(p_wo_id uuid default null, p_booking_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := get_my_role();
  v_kind text := null;
begin
  if v_role is null or v_role not in ('owner', 'manager', 'billing') then
    raise exception 'Only an owner, a manager or billing can delete a work order';
  end if;
  if p_wo_id is not null and exists (select 1 from work_orders w where w.id = p_wo_id and w.session_status = 'tentative') then
    v_kind := 'hold';
  end if;
  return app_private.archive_and_delete(p_wo_id, p_booking_id, v_kind);
end
$$;

-- ── 4. REMOVE HOLD — the work order card's button ───────────────────────────
-- p_dates — the days the person is taking off, as 'YYYY-MM-DD'. For the whole
--           hold: every day the card was showing.
-- p_whole — true only when the person chose the whole hold.
drop function if exists public.remove_hold(uuid, text[]);
create or replace function public.remove_hold(p_wo_id uuid, p_dates text[], p_whole boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role    text := get_my_role();
  v_uid     uuid;
  v_name    text;
  v_wo      work_orders%rowtype;
  v_all     text[];
  v_dates   text[];
  v_asked   integer;
  v_bad     text;
  v_snap    jsonb;
  v_bundles jsonb := '[]'::jsonb;
  v_title   text;
  v_detail  text;
  v_id      uuid;
  v_n       integer;
  v_changed constant text := 'This hold changed while you had it open. Close this and open Remove hold again.';
begin
  if v_role is null or v_role not in ('owner', 'manager', 'billing', 'asst_manager') then
    raise exception 'Only the office can remove a hold';
  end if;
  select id, display_name into v_uid, v_name
    from user_profiles where auth_user_id = auth.uid() limit 1;

  select * into v_wo from work_orders where id = p_wo_id for update;
  if not found then raise exception 'That hold is already gone'; end if;
  -- Hold its day rows still too: a runner's submit or an office review writes
  -- them directly, and must not land between the checks below and the delete.
  perform 1 from studio_time_rows r where r.work_order_id = p_wo_id for update;

  if v_wo.session_status is distinct from 'tentative' then
    raise exception 'This session is not saved as a tentative hold. A confirmed or cancelled session is deleted from the billing hub.';
  end if;
  if v_wo.status = 'completed' or v_wo.invoice_doc_path is not null or v_wo.invoice_state is not null then
    raise exception 'This hold has been completed or invoiced. Delete it from the billing hub.';
  end if;
  if exists (select 1 from payment_rows p where p.work_order_id = p_wo_id and p.amount::text ~ '[1-9]') then
    raise exception 'This hold has a payment on it. Delete it from the billing hub.';
  end if;

  -- Every day the hold has (a day = a date with a room on it).
  select coalesce(array_agg(distinct r.date::text), '{}') into v_all
    from studio_time_rows r
   where r.work_order_id = p_wo_id and r.date is not null and r.date::text <> '' and coalesce(btrim(r.studio), '') <> '';

  -- The days asked for; and which of them the hold still has.
  select count(distinct d) into v_asked from unnest(coalesce(p_dates, '{}')) d where d is not null and d <> '';
  select coalesce(array_agg(distinct d), '{}') into v_dates
    from unnest(coalesce(p_dates, '{}')) d where d = any (v_all);

  -- What the person saw must be what is there. Never guess.
  if cardinality(v_dates) <> v_asked then
    raise exception '%', v_changed;                      -- a day they ticked is gone
  end if;
  if coalesce(p_whole, false) then
    if cardinality(v_dates) <> cardinality(v_all) then
      raise exception '%', v_changed;                    -- the hold has days they never saw
    end if;
  else
    if cardinality(v_dates) = 0 then
      raise exception 'No days were picked';
    end if;
    if cardinality(v_dates) = cardinality(v_all) then
      -- They picked "some days", but those are now every day there is.
      raise exception '%', v_changed;
    end if;
  end if;

  -- A day that is confirmed, or that someone already submitted or reviewed, is
  -- not a hold. The whole hold checks every line it has (dated or not); some
  -- days checks the lines of those days.
  if exists (
    select 1 from studio_time_rows r
     where r.work_order_id = p_wo_id
       and (coalesce(p_whole, false) or r.date::text = any (v_dates))
       and (r.day_status = 'confirmed'
            or coalesce(r.status, 'in_progress') in ('submitted', 'approved')
            or coalesce(r.admin_locked, false) or coalesce(r.admin_checked, false))
  ) then
    select min(r.date::text) into v_bad
      from studio_time_rows r
     where r.work_order_id = p_wo_id
       and (coalesce(p_whole, false) or r.date::text = any (v_dates))
       and (r.day_status = 'confirmed'
            or coalesce(r.status, 'in_progress') in ('submitted', 'approved')
            or coalesce(r.admin_locked, false) or coalesce(r.admin_checked, false));
    raise exception '% is confirmed or already submitted - it cannot be removed as a hold', coalesce(nullif(v_bad, ''), 'A line on this hold');
  end if;

  -- ── the whole hold: the same keeper as every other delete ──
  if coalesce(p_whole, false) then
    return app_private.archive_and_delete(p_wo_id, null, 'hold') || jsonb_build_object('whole', true);
  end if;

  -- ── some days ──
  -- Kept: the lines of those days (rooms and staff alike), a blanket rate set
  -- on one of those days, and the hold's calendar cards as they stood — so the
  -- days can be put back on the calendar.
  if to_regclass('public.wo_rate_bundles') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.wo_rate_bundles t where t.work_order_id = $1 and t.date::text = any ($2)'
      into v_bundles using p_wo_id, v_dates;
  end if;
  v_snap := jsonb_build_object(
    'studio_time_rows', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                           from studio_time_rows r
                          where r.work_order_id = p_wo_id and r.date::text = any (v_dates)),
    'wo_rate_bundles',  v_bundles,
    'cards_before',     (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
                           from bookings b where b.work_order_id = p_wo_id or b.id = v_wo.booking_id)
  );

  v_title := concat_ws(' · ',
    nullif(btrim(coalesce(nullif(btrim(v_wo.label), ''), v_wo.client, '')), ''),
    nullif(btrim(coalesce(v_wo.artist, '')), ''));
  v_detail := concat_ws(' · ',
    (select string_agg(distinct concat_ws(' ', b.location, b.studio), ', ')
       from bookings b
      where (b.work_order_id = p_wo_id or b.id = v_wo.booking_id)
        and exists (select 1 from unnest(v_dates) d
                     where b.start_date::text <= d and coalesce(b.end_date::text, b.start_date::text) >= d)),
    (select string_agg(d, ', ' order by d) from unnest(v_dates) d),
    cardinality(v_dates) || ' of ' || cardinality(v_all) || ' days');

  insert into deleted_work_orders (deleted_by, deleted_by_name, kind, wo_id, wo_number, title, detail, snapshot)
  values (v_uid, coalesce(v_name, ''), 'hold_days', p_wo_id, v_wo.wo_number, coalesce(v_title, ''), coalesce(v_detail, ''), v_snap)
  returning id into v_id;

  delete from studio_time_rows r
   where r.work_order_id = p_wo_id and r.date::text = any (v_dates);
  get diagnostics v_n = row_count;
  -- The day's blanket rate goes with the day (kept above). Left behind, a day
  -- added back by hand would quietly adopt the old price.
  if to_regclass('public.wo_rate_bundles') is not null then
    execute 'delete from public.wo_rate_bundles t where t.work_order_id = $1 and t.date::text = any ($2)' using p_wo_id, v_dates;
  end if;

  -- On the record, on the hold itself.
  insert into wo_activity (work_order_id, actor_id, actor_name, source, kind, changes)
  values (p_wo_id, v_uid, coalesce(v_name, ''), 'office', 'saved',
          (select jsonb_agg(jsonb_build_object('what', 'Day removed from the hold', 'day', d) order by d) from unnest(v_dates) d));

  return jsonb_build_object('ok', true, 'whole', false, 'archive_id', v_id,
                            'wo_number', v_wo.wo_number, 'days', to_jsonb(v_dates), 'rows', v_n);
end
$$;

-- ── 5. RECOVER — now also puts removed DAYS back ────────────────────────────
create or replace function public.recover_deleted_work_order(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role  text := get_my_role();
  v_uid   uuid;
  v_name  text;
  v_rec   deleted_work_orders%rowtype;
  v_snap  jsonb;
  v_tbl   text;
  v_days  text[];
  v_bad   text;
  v_card  jsonb;
  v_d     text;
  v_wo    work_orders%rowtype;
  v_rows  jsonb;
begin
  if v_role is null or v_role not in ('owner', 'manager', 'billing') then
    raise exception 'Only an owner, a manager or billing can recover a work order';
  end if;
  select id, display_name into v_uid, v_name
    from user_profiles where auth_user_id = auth.uid() limit 1;

  select * into v_rec from deleted_work_orders where id = p_id for update;
  if not found then raise exception 'That deleted entry does not exist'; end if;
  if v_rec.recovered_at is not null then raise exception 'This was already recovered'; end if;
  v_snap := v_rec.snapshot;

  -- ── DAYS removed from a hold that is still there ──
  if v_rec.kind = 'hold_days' then
    select * into v_wo from work_orders w where w.id = v_rec.wo_id for update;
    if not found then
      raise exception 'The hold itself has been removed since. Recover the whole hold first, then these days.';
    end if;
    -- Days must not slide onto an invoice that has already been built.
    if v_wo.invoice_doc_path is not null
       or coalesce(v_wo.invoice_state, '') in ('needs_approval', 'approved', 'awaiting_po', 'sent', 'paid', 'closed') then
      raise exception 'This work order has been invoiced since. Add the day on the work order itself if it is still wanted.';
    end if;

    select coalesce(array_agg(distinct x ->> 'date'), '{}') into v_days
      from jsonb_array_elements(coalesce(v_snap -> 'studio_time_rows', '[]'::jsonb)) x
     where coalesce(btrim(x ->> 'studio'), '') <> '' and coalesce(x ->> 'date', '') <> '';

    -- Someone added the day back by hand: putting ours back would double it.
    select min(r.date::text) into v_bad
      from studio_time_rows r
     where r.work_order_id = v_rec.wo_id
       and coalesce(btrim(r.studio), '') <> ''
       and r.date::text = any (v_days);
    if v_bad is not null then
      raise exception '% is on this work order again already - nothing recovered', v_bad;
    end if;

    -- 1. A blanket rate that sat on one of those days — unless the day has
    --    been given another since.
    perform app_private.restore_rows('wo_rate_bundles', v_snap -> 'wo_rate_bundles');

    -- 2. The day lines, exactly as they were — all of them, or none. Two
    --    adjustments, both so a hold comes back as a hold:
    --      · the session has been CONFIRMED since: a line with no status of
    --        its own would read as confirmed, so it is marked tentative;
    --      · its blanket rate is not there to point at: the pointer is cleared.
    select coalesce(jsonb_agg(
             x
             || case when v_wo.session_status is distinct from 'tentative' and x ->> 'day_status' is null
                     then jsonb_build_object('day_status', 'tentative') else '{}'::jsonb end
             || case when x ->> 'bundle_id' is not null
                          and not exists (select 1 from wo_rate_bundles b where b.id::text = x ->> 'bundle_id')
                     then jsonb_build_object('bundle_id', null) else '{}'::jsonb end
           ), '[]'::jsonb)
      into v_rows
      from jsonb_array_elements(coalesce(v_snap -> 'studio_time_rows', '[]'::jsonb)) x;
    perform app_private.restore_rows('studio_time_rows', v_rows, null, true);

    -- 3. A one-day calendar card per recovered day and room: the card that
    --    covered that day when it was removed, narrowed to the day. Skipped
    --    where a card of this work order already covers that room and day.
    --    The next Save on the work order folds these back into one bar.
    for v_card in select * from jsonb_array_elements(coalesce(v_snap -> 'cards_before', '[]'::jsonb)) loop
      foreach v_d in array v_days loop
        if (v_card ->> 'start_date') <= v_d
           and coalesce(v_card ->> 'end_date', v_card ->> 'start_date') >= v_d
           and not exists (
             select 1 from bookings b
              where (b.work_order_id = v_rec.wo_id or b.id = v_wo.booking_id)
                and coalesce(b.studio, '') = coalesce(v_card ->> 'studio', '')
                and coalesce(b.location, '') = coalesce(v_card ->> 'location', '')
                and b.start_date::text <= v_d
                and coalesce(b.end_date::text, b.start_date::text) >= v_d)
        then
          perform app_private.restore_rows('bookings', jsonb_build_array(
            v_card
              || jsonb_build_object('id', gen_random_uuid(), 'start_date', v_d, 'end_date', v_d,
                                    'work_order_id', v_rec.wo_id, 'status', 'tentative')
              -- A second card never asks for staffing of its own (same rule the
              -- app's own projection uses for every card after the first).
              || case when v_card ? 'engineer_status'  then jsonb_build_object('engineer_status', 'not_needed')  else '{}'::jsonb end
              || case when v_card ? 'assistant_status' then jsonb_build_object('assistant_status', 'not_needed') else '{}'::jsonb end
          ), null, true);
        end if;
      end loop;
    end loop;

    insert into wo_activity (work_order_id, actor_id, actor_name, source, kind, changes)
    values (v_rec.wo_id, v_uid, coalesce(v_name, ''), 'office', 'saved',
            (select jsonb_agg(jsonb_build_object('what',
                      format('Day put back - it had been removed by %s', coalesce(nullif(v_rec.deleted_by_name, ''), 'someone')),
                      'day', d) order by d)
               from unnest(v_days) d));

    update deleted_work_orders
       set recovered_at = now(), recovered_by_name = coalesce(v_name, '')
     where id = p_id;

    return jsonb_build_object('ok', true, 'wo_number', v_rec.wo_number, 'title', v_rec.title, 'days', to_jsonb(v_days));
  end if;

  -- ── a whole work order, hold or block — unchanged from 20261006120000 ──
  if exists (
    select 1 from work_orders w
      join jsonb_array_elements(coalesce(v_snap -> 'work_orders', '[]'::jsonb)) x
        on w.id::text = x ->> 'id' or w.wo_number = x ->> 'wo_number'
  ) then
    raise exception 'This work order exists again already - nothing recovered';
  end if;
  if exists (
    select 1 from bookings b
      join jsonb_array_elements(coalesce(v_snap -> 'bookings', '[]'::jsonb)) x on b.id::text = x ->> 'id'
  ) then
    raise exception 'Its calendar card exists again already - nothing recovered';
  end if;

  -- 1. Cards first, not yet pointing at the work order (it is not back yet).
  perform app_private.restore_rows('bookings', v_snap -> 'bookings', 'work_order_id', true);

  -- 2. The work order(s).
  perform app_private.restore_rows('work_orders', v_snap -> 'work_orders', null, true);

  -- 3. Point the cards back at it.
  update bookings b
     set work_order_id = (x ->> 'work_order_id')::uuid
    from jsonb_array_elements(coalesce(v_snap -> 'bookings', '[]'::jsonb)) x
   where b.id::text = x ->> 'id' and x ->> 'work_order_id' is not null;

  -- 4. Everything else the snapshot holds. Rate bundles go first: day rows
  --    point at them. A table that has since been dropped is skipped.
  for v_tbl in
    select k from jsonb_object_keys(v_snap) k
     where k not in ('work_orders', 'bookings', 'leads')
     order by (k = 'wo_rate_bundles') desc, k
  loop
    perform app_private.restore_rows(v_tbl, v_snap -> v_tbl);
  end loop;

  -- 5. The lead that became this session: the delete blanked its link.
  update leads l
     set work_order_id = (x ->> 'work_order_id')::uuid
    from jsonb_array_elements(coalesce(v_snap -> 'leads', '[]'::jsonb)) x
   where l.id::text = x ->> 'id' and l.work_order_id is null;

  -- 6. On the record, on the work order itself.
  insert into wo_activity (work_order_id, actor_id, actor_name, source, kind, changes)
  select (x ->> 'id')::uuid, v_uid, coalesce(v_name, ''), 'office', 'saved',
         jsonb_build_array(jsonb_build_object('what',
           format('Recovered - it had been deleted by %s on %s',
             coalesce(nullif(v_rec.deleted_by_name, ''), 'someone'),
             to_char(v_rec.deleted_at at time zone 'America/Los_Angeles', 'Mon FMDD, FMHH12:MI AM'))))
    from jsonb_array_elements(coalesce(v_snap -> 'work_orders', '[]'::jsonb)) x;

  update deleted_work_orders
     set recovered_at = now(), recovered_by_name = coalesce(v_name, '')
   where id = p_id;

  return jsonb_build_object('ok', true, 'wo_number', v_rec.wo_number, 'title', v_rec.title);
end
$$;

revoke all on function public.delete_with_archive(uuid, uuid) from public, anon;
revoke all on function public.remove_hold(uuid, text[], boolean) from public, anon;
revoke all on function public.recover_deleted_work_order(uuid) from public, anon;
grant execute on function public.delete_with_archive(uuid, uuid) to authenticated;
grant execute on function public.remove_hold(uuid, text[], boolean) to authenticated;
grant execute on function public.recover_deleted_work_order(uuid) to authenticated;

-- Proof it ran: the four functions, and the kinds the log now accepts.
select p.proname as thing, 'function ready' as detail from pg_proc p
 where p.proname in ('archive_and_delete', 'delete_with_archive', 'remove_hold', 'recover_deleted_work_order')
union all
select 'deleted_work_orders.kind', pg_get_constraintdef(c.oid) from pg_constraint c
 where c.conrelid = 'public.deleted_work_orders'::regclass and c.conname = 'deleted_work_orders_kind_check';
