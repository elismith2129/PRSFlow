-- SRS HISTORY (Eli, 2026-10-01). The SRS record before PRSFlo was Eli's own
-- spreadsheet ("Paramount SRS Log"), Dec 2023 → Jun 2026. Those sessions have
-- no work orders (the calendar import only brought 2026 bookings, and dropped
-- the WP `paycode_alert` field that carried "SRS"), so they can't be derived.
-- They go in as recorded: amounts, percent and paid status exactly as the log
-- has them — not recomputed. Shown on /srs under Paid, read-only.
--
-- Skipped on Eli's ruling: Concord 2024-04-08 (cancelled, no charge) and every
-- AG Cook row ("AG isnt here anymore"). Also skipped: Ted Perlman and the
-- "TBA (unknown artist)" rows — no amount, not paid.
--
-- Idempotent: invoice_number is unique; re-running inserts nothing new.

begin;

create table if not exists public.srs_history (
  id             uuid primary key default gen_random_uuid(),
  session_date   date not null,
  date_label     text,
  client         text not null,
  invoice_number text unique,
  room_charges   numeric,
  pct            numeric,
  fee            numeric not null,
  paid           boolean not null default true,
  paid_on        date,
  note           text,
  created_at     timestamptz not null default now()
);

insert into public.srs_history (session_date, date_label, client, invoice_number, room_charges, pct, fee, note) values
  ('2023-12-04', 'Dec 4–6, 2023',          'Charlie Christie / Interscope',        '30353', 13755.00, 10, 1375.50, null),
  ('2024-01-18', 'Jan 18–31, 2024',        'Deftones',                             '30531', 19513.71, 10, 1951.37, null),
  ('2024-01-30', 'Jan 30, 2024',           'Rex Rideout',                          '30579',  1000.00, 10,  100.00, null),
  ('2024-03-11', 'Mar 11–12, 2024',        'Brian Taylor',                         '30769',  3500.00, 10,  350.00, null),
  ('2024-03-26', 'Mar 26, 2024',           'Leon Lacey',                           '30798',  1650.00, 10,  165.00, null),
  ('2024-07-14', 'Jul 14, 2024',           'Richard Stites',                       '31182',  2990.00, 10,  299.00, null),
  ('2024-08-10', 'Aug 10, 2024',           'Richard Stites',                       '31309',  2255.00, 10,  225.50, null),
  ('2025-04-13', 'Apr 13, 14, 17, 18, 2025','Paige Beedie',                        '32417',  1900.00, 10,  190.00, '10% only — heavily discounted to make it work'),
  ('2025-04-24', 'Apr 24–26, Apr 28–May 2, 2025','Paige Beedie',                   '32479',  3200.00, 10,  320.00, '10% only — heavily discounted to make it work'),
  ('2025-06-06', 'Jun 6, 2025',            'Busta Rhymes',                         '32674',  1480.00, 20,  296.00, null),
  ('2025-06-08', 'Jun 8, 10, 2025',        'Busta Rhymes',                         '32704',  2960.00, 20,  592.00, null),
  ('2025-06-10', 'Jun 10, 2025',           'Indie Legacy / Mike Brinkly / Dej Loaf','32698', 1320.00, 20,  264.00, null),
  ('2025-10-07', 'Oct 7–9, 2025',          'Concord Writing Camp',                 '32907', 20000.00, 10, 2000.00, '10% only — heavily discounted to make it work'),
  ('2026-01-07', 'Jan 7, 2026',            'Concord',                              '33291', 13370.00, 10, 1334.00, null),
  ('2026-02-06', 'Feb 6, 2026',            'Lukas Graham',                         '33704',  1050.00, 10,  105.00, null),
  ('2026-02-09', 'Feb 9, 2026',            'Jesse Haugen',                         '33667',  1950.00, 10,  195.00, null),
  ('2026-04-01', 'Apr 1–2, 2026',          'Stuart Price / Chris Morris',          '33976',  2575.00, 20,  515.00, null),
  ('2026-04-20', 'Apr 20–24, 2026',        'Stuart Price',                         '34088',  6250.00, 20, 1250.00, null),
  ('2026-06-18', 'Jun 18, 2026',           'Christina Perri',                      '34383',  1000.00, 20,  200.00, null)
on conflict (invoice_number) do nothing;

alter table public.srs_history enable row level security;
drop policy if exists "srs_history_select" on public.srs_history;
create policy "srs_history_select" on public.srs_history
  for select to authenticated
  using (get_my_role() in ('owner', 'manager', 'billing'));
drop policy if exists "srs_history_write" on public.srs_history;
create policy "srs_history_write" on public.srs_history
  for all to authenticated
  using (get_my_role() in ('owner', 'manager'))
  with check (get_my_role() in ('owner', 'manager'));
grant select, insert, update, delete on public.srs_history to authenticated;
grant all on public.srs_history to service_role;

commit;

select count(*) as history_rows, sum(fee) as total_paid from public.srs_history;
