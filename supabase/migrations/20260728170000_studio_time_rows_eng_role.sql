-- studio_time_rows.eng_role — the role of the person on a row's staff sub-row:
-- 'engineer' (1ST) or 'assistant' (2ND). Every session has an engineer OR an
-- assistant; the card projection writes bookings.engineer_name or
-- bookings.assistant_name from this. Idempotent / additive.

alter table studio_time_rows
  add column if not exists eng_role text not null default 'engineer';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'studio_time_rows_eng_role_check'
  ) then
    alter table studio_time_rows
      add constraint studio_time_rows_eng_role_check
      check (eng_role in ('engineer', 'assistant'));
  end if;
end $$;
