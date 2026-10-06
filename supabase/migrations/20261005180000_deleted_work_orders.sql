-- ============================================================================
-- DELETED WORK ORDERS — every delete is kept, and can be put back.
-- (Eli, 2026-10-05, after WO-1240 — Epic / Molly Santana, seven nights,
-- runner-submitted and invoiced — vanished on Oct 2 with no trace.)
--
-- WHAT WENT WRONG. "Delete session" sat on every work order. It deleted the
-- WHOLE work order behind whichever calendar card was open — all its cards,
-- days, payments — and, because wo_activity cascades from the work order, its
-- own history too. Someone removing one tentative night removed a week, and
-- the app could not say who or when. It came back only because the nightly
-- backup still had it.
--
-- THE RULING: "get rid of the delete button that's on the WOs. only a delete
-- button from the billing hub… I do want Lori and Fernando to be able to do
-- this. I just want an in-app log for all deletions and a recover function."
--
-- SO:
--   · deleted_work_orders — one row per delete: who, when, what it was, and a
--     SNAPSHOT of every row that went (the work order, its calendar cards, and
--     every table that carries a work_order_id).
--   · delete_with_archive() — the ONLY way the app deletes a work order (or a
--     Tour / Tech / Open-hours block). Snapshot and delete are one
--     transaction: nothing can be deleted without being kept.
--   · recover_deleted_work_order() — puts a snapshot back with its original
--     ids, re-links its lead, and writes the recovery into the history.
--
-- WHY THIS IS AN RPC WHEN THE HOUSE LAW SAYS "RPCs are dumb appliers, all
-- values computed in TS": the law is about BUSINESS values (rates, totals,
-- projections). This is custody. A client-side "read everything, save a copy,
-- then delete" is three round trips that can stop between any two — and the
-- failure this exists to prevent is exactly a delete with no copy.
--
-- "DISCOVER, NEVER ENUMERATE" (the backup script's rule): the snapshot finds
-- child tables by asking the catalogue which tables have a work_order_id
-- column, so a table added next month is kept without anyone remembering this
-- file. The DELETE list is explicit, mirroring the old lib/deleteSession, with
-- the FK cascades behind it.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code ships —
-- the billing hub's Delete calls delete_with_archive() and will fail without it.
-- ============================================================================

create table if not exists public.deleted_work_orders (
  id                uuid primary key default gen_random_uuid(),
  deleted_at        timestamptz not null default now(),
  deleted_by        uuid,                      -- user_profiles.id
  deleted_by_name   text not null default '',
  kind              text not null default 'work_order' check (kind in ('work_order', 'block')),
  -- NOT named work_order_id, on purpose: the snapshot discovers child tables by
  -- that column name, and the archive must never archive itself.
  wo_id             uuid,
  wo_number         text,
  title             text not null default '',  -- "Epic Records · Molly Santana"
  detail            text not null default '',  -- "Ameraycan · Studio B · Sep 23 – Oct 3 · 7 days · invoice 34828"
  snapshot          jsonb not null,            -- { "<table>": [ rows… ], … }
  recovered_at      timestamptz,
  recovered_by_name text
);

create index if not exists deleted_work_orders_at on public.deleted_work_orders (deleted_at desc);

alter table public.deleted_work_orders enable row level security;

-- Read: the three roles that can delete. No INSERT / UPDATE / DELETE policy at
-- all — rows are written only by the two SECURITY DEFINER functions below, so
-- the log cannot be edited or emptied from the app.
drop policy if exists deleted_work_orders_sel on public.deleted_work_orders;
create policy deleted_work_orders_sel on public.deleted_work_orders
  for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'));

-- Post-2026-05-30 tables are not grandfathered: explicit grants required.
grant select on public.deleted_work_orders to authenticated;
grant all on public.deleted_work_orders to service_role;

alter table public.deleted_work_orders replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.deleted_work_orders;
exception when duplicate_object then null;
end $$;

-- ── DELETE, KEEPING A COPY ──────────────────────────────────────────────────
-- p_wo_id      — the billing hub: this work order, with all its cards.
-- p_booking_id — a calendar block (Tour / Tech / Open hours / Tenant): that
--                card, plus any dormant work order still attached to it.
create or replace function public.delete_with_archive(p_wo_id uuid default null, p_booking_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text := get_my_role();
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
  if v_role is null or v_role not in ('owner', 'manager', 'billing') then
    raise exception 'Only an owner, a manager or billing can delete a work order';
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

  return jsonb_build_object('ok', true, 'archive_id', v_id, 'title', v_title, 'wo_number', v_wo_num);
end
$$;

-- ── RECOVER ─────────────────────────────────────────────────────────────────
-- Puts a snapshot back with its original ids. Refuses if the work order (or
-- its number) already exists again, or if this entry was already recovered.
-- All or nothing: any conflict raises and nothing is changed.
create or replace function public.recover_deleted_work_order(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
  v_uid  uuid;
  v_name text;
  v_rec  deleted_work_orders%rowtype;
  v_snap jsonb;
  v_tbl  text;
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
  insert into bookings
  select * from jsonb_populate_recordset(null::bookings,
    (select coalesce(jsonb_agg(x || jsonb_build_object('work_order_id', null)), '[]'::jsonb)
       from jsonb_array_elements(coalesce(v_snap -> 'bookings', '[]'::jsonb)) x));

  -- 2. The work order(s).
  insert into work_orders
  select * from jsonb_populate_recordset(null::work_orders, coalesce(v_snap -> 'work_orders', '[]'::jsonb));

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
    if to_regclass('public.' || quote_ident(v_tbl)) is not null then
      execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing', v_tbl, v_tbl)
        using v_snap -> v_tbl;
    end if;
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
revoke all on function public.recover_deleted_work_order(uuid) from public, anon;
grant execute on function public.delete_with_archive(uuid, uuid) to authenticated;
grant execute on function public.recover_deleted_work_order(uuid) to authenticated;

-- Proof it ran: the table (0 rows on first run) and both functions.
select 'deleted_work_orders' as thing, count(*)::text as detail from public.deleted_work_orders
union all
select p.proname, 'function ready' from pg_proc p
 where p.proname in ('delete_with_archive', 'recover_deleted_work_order');
