-- WHO SUBMITTED THE DAY (Eli, 2026-09-17): "can we have the runner name
-- included in that tag on the rows in the WO?" A day's submit state was a
-- coloured dot; now it reads "Submitted · Hunter · 12:14 AM". Written by the
-- runner's Submit (WorkOrderPopup.handleRunnerSubmit) alongside status; never
-- part of the save payload, like status itself.
alter table public.studio_time_rows
  add column if not exists submitted_by_name text,
  add column if not exists submitted_at      timestamptz;

-- Backfill from the activity log: the runner's terminal act already logged
-- kind='submitted' with the day in changes[].day. Latest submit per WO+day wins.
with subs as (
  select a.work_order_id, (c->>'day') as day, a.actor_name, a.at,
         row_number() over (partition by a.work_order_id, (c->>'day') order by a.at desc) as rn
  from public.wo_activity a
  cross join lateral jsonb_array_elements(coalesce(a.changes, '[]'::jsonb)) c
  where a.kind = 'submitted' and (c->>'day') is not null
)
update public.studio_time_rows r
   set submitted_by_name = s.actor_name, submitted_at = s.at
  from subs s
 where s.rn = 1
   and r.work_order_id = s.work_order_id
   and r.date::text = s.day
   and r.status in ('submitted', 'approved')
   and r.submitted_at is null;

select count(*) as backfilled from public.studio_time_rows where submitted_at is not null;
