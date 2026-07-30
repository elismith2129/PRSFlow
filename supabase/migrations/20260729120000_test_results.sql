-- ===========================================================================
-- test_results — verdicts for the DEV → Testing checklists.
--
-- Deliberately ONE small table. The checklists themselves (batches + items,
-- their wording and instructions) live in CODE at lib/testBatches.ts, not in the
-- database, because:
--   • Claude authors the batches as part of the same commit as the work they
--     test, so a batch and the feature it covers can never drift apart.
--   • No migration, and no SQL for Eli to run, each time a new batch is added.
--   • Only the human verdicts are data — and that's all this table holds.
--
-- One verdict per (batch, item): a single tester is running these, so there's no
-- per-user dimension. Re-testing overwrites via upsert on the unique key.
-- `tested_by` records who for the log, not for scoping.
--
-- RLS: any authenticated staff may read and record verdicts (the whole point is
-- that a helper can work through a batch). Only owner/manager may delete, so a
-- run can be reset without a tester wiping history.
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

begin;

create table if not exists test_results (
  id          uuid primary key default gen_random_uuid(),
  batch_id    text not null,
  item_id     text not null,
  status      text not null check (status in ('pass', 'fail')),
  note        text,
  tested_by   text,
  updated_at  timestamptz not null default now(),
  unique (batch_id, item_id)
);

create index if not exists test_results_batch_idx on test_results (batch_id);

alter table test_results enable row level security;

-- Read: any signed-in staff member.
drop policy if exists test_results_sel on test_results;
create policy test_results_sel on test_results for select to authenticated
  using (true);

-- Record a verdict: any signed-in staff member.
drop policy if exists test_results_ins on test_results;
create policy test_results_ins on test_results for insert to authenticated
  with check (true);

-- Change a verdict (re-test): any signed-in staff member.
drop policy if exists test_results_upd on test_results;
create policy test_results_upd on test_results for update to authenticated
  using (true)
  with check (true);

-- Reset a run: owner/manager only.
drop policy if exists test_results_del on test_results;
create policy test_results_del on test_results for delete to authenticated
  using (get_my_role() in ('owner', 'manager'));

comment on table test_results is
  'Pass/fail verdicts for DEV → Testing checklists. Batch/item definitions live in code (lib/testBatches.ts); this table holds only the human verdicts. Unique on (batch_id, item_id) — single tester, upsert to re-test.';

commit;
