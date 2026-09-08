-- ─────────────────────────────────────────────────────────────────────────────
-- ap_tick_set — one atomic tick on the AP checklist.
--
-- SUPERSEDES the "cosmetic, nothing reads it" framing in migration
-- 20260908140000. Eli, 2026-09-08: "the ticks should persist across all logins
-- and save — so if we stop midway everyone knows where it's at." That makes the
-- checklist a HANDOFF, not decoration, and two things follow that the first
-- version got wrong:
--
--   1. LOST UPDATES. The client was writing the whole ap_ticks object. Two
--      coordinators working the same package — exactly the handoff this is for
--      — would clobber each other: last write wins, the other tick vanishes.
--      A tick that can silently disappear is worse than no tick, because the
--      person reading it believes it.
--      This RPC merges a single key server-side instead, so concurrent ticks
--      on different items both survive.
--
--   2. WHO AND WHEN. "Everyone knows where it's at" needs a name on it. The
--      value is now {"by": "Sam", "at": "2026-09-08T21:14:00Z"} rather than
--      `true`, so the panel can say who stopped and when.
--
-- Still no gating: nothing reads these to block anything, per the standing
-- ruling that this section is reference for new hires.
--
-- The actor name is passed in rather than derived, matching
-- dashboard_task_comments.created_by_name — the app's existing pattern for
-- "stamp the human-readable name at write time".
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ap_tick_set(
  p_work_order_id uuid,
  p_key           text,
  p_on            boolean,
  p_by            text default null
)
returns jsonb
language plpgsql
security invoker           -- RLS on work_orders still applies to the caller.
as $$
declare
  v_ticks jsonb;
begin
  -- Guard the key shape: 'pkg:0' / 'step:12'. Without this an arbitrary key
  -- could be written into the column by a malformed call.
  if p_key !~ '^(pkg|step):[0-9]{1,3}$' then
    raise exception 'ap_tick_set: bad key %', p_key;
  end if;

  if p_on then
    update public.work_orders
       set ap_ticks = coalesce(ap_ticks, '{}'::jsonb)
                      || jsonb_build_object(p_key, jsonb_build_object(
                           'by', coalesce(nullif(p_by, ''), 'Staff'),
                           'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                         ))
     where id = p_work_order_id
     returning ap_ticks into v_ticks;
  else
    update public.work_orders
       set ap_ticks = coalesce(ap_ticks, '{}'::jsonb) - p_key
     where id = p_work_order_id
     returning ap_ticks into v_ticks;
  end if;

  if v_ticks is null then
    raise exception 'ap_tick_set: no work order %', p_work_order_id;
  end if;
  return v_ticks;
end
$$;

revoke execute on function public.ap_tick_set(uuid, text, boolean, text) from public, anon;
grant  execute on function public.ap_tick_set(uuid, text, boolean, text) to authenticated;
