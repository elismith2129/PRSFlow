-- ============================================================================
-- Oct 6, 2026 — two things, one file, run once.
--
-- 1. SUBMITTED FOR THE RUNNER — a new flag on studio_time_rows.
--
--    Two rulings met on one column and one of them lost.
--      Sep 23 (v1.39.4): when the office reviews a night the runner never
--        turned in, that night is submitted in the reviewer's name — so a
--        rescued night is not left nameless.
--      Oct 5 (v1.43.0): Daily Ops keeps its red "WO not submitted" badge after
--        the office fixes it, because the question there is "did the runner
--        turn it in THAT NIGHT", and the row's status was the evidence.
--    The rescue writes status = 'submitted'. So restoring the first ruling
--    would have erased the second: review a missed night and the badge, and
--    the record of who missed it, would vanish.
--
--    This flag is how both stay true. The rescue sets it alongside the stamp.
--    Everything that asks "is this night dealt with" reads status as before.
--    The one reader that asks "did the RUNNER send it" (Daily Ops, through
--    lib/unsubmitted includeCovered) reads the flag.
--
--    Not part of save_work_order_atomic's payload — like status and the submit
--    stamp, it is written only by the act itself.
--
-- 2. RECOVER SURVIVES A COLUMN ADDED AFTER THE DELETE.
--
--    recover_deleted_work_order() (20261005180000) restored each table with
--        insert into t select * from jsonb_populate_recordset(null::t, snapshot)
--    A snapshot only has the columns that existed when it was taken. For a
--    column added later, jsonb_populate_recordset yields NULL, and `select *`
--    inserts that NULL explicitly — which does not fall back to the column's
--    default. So adding ANY `not null default …` column (no_show on Oct 5,
--    submitted_for_runner today) made every older snapshot unrecoverable:
--    "null value in column … violates not-null constraint". The safety net had
--    a hole exactly the size of the next migration.
--
--    Now each insert names only the columns the snapshot actually carries
--    (and that still exist), so anything newer takes its default and anything
--    since dropped is ignored. Same behaviour otherwise.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE the code is pushed.
-- ============================================================================

alter table public.studio_time_rows
  add column if not exists submitted_for_runner boolean not null default false;

-- The schema the save RPC's helpers already live in (20260728180000).
create schema if not exists app_private;

-- Restores one table's rows from a snapshot array, naming only the columns
-- the snapshot has.
--   p_null_col  a column to force to NULL on the way in (the booking cards go
--               back before their work order exists).
--   p_strict    every row must go in, or the whole recovery is refused. Used
--               for the cards and the work order themselves: a card skipped
--               over some constraint would otherwise come back as a work order
--               quietly missing a room. The child tables stay lenient
--               ("on conflict do nothing"), as before.
-- Called only from recover_deleted_work_order (itself security definer), so it
-- needs no rights of its own and is not exposed to any API role.
drop function if exists app_private.restore_rows(text, jsonb, text);
create or replace function app_private.restore_rows(p_table text, p_rows jsonb, p_null_col text default null, p_strict boolean default false)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_cols text;
  v_sel  text;
  v_n    integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;
  if to_regclass('public.' || quote_ident(p_table)) is null then
    return 0;  -- the table has been dropped since; nothing to restore into
  end if;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(case when c.column_name = p_null_col then 'null' else quote_ident(c.column_name) end, ', ' order by c.ordinal_position)
    into v_cols, v_sel
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = p_table
     and c.is_generated = 'NEVER'
     and (p_rows -> 0) ? c.column_name;

  if v_cols is null then
    return 0;
  end if;

  execute format(
    'insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
    p_table, v_cols, v_sel, p_table
  ) using p_rows;
  get diagnostics v_n = row_count;
  if p_strict and v_n < jsonb_array_length(p_rows) then
    raise exception 'Could not put back every % row (% of %) - something with the same details exists again. Nothing recovered.',
      p_table, v_n, jsonb_array_length(p_rows);
  end if;
  return v_n;
end
$$;

revoke all on function app_private.restore_rows(text, jsonb, text, boolean) from public, anon, authenticated;

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

revoke all on function public.recover_deleted_work_order(uuid) from public, anon;
grant execute on function public.recover_deleted_work_order(uuid) to authenticated;

-- Proof it ran: the column exists, and both functions are in place.
select 'studio_time_rows.submitted_for_runner' as thing,
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'studio_time_rows' and column_name = 'submitted_for_runner') as detail
union all
select p.proname, 'function ready' from pg_proc p
 where p.proname in ('restore_rows', 'recover_deleted_work_order');
