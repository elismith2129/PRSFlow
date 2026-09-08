-- ─────────────────────────────────────────────────────────────────────────────
-- work_orders.ap_ticks — the AP card's checklist state, per invoice.
--
-- Eli, 2026-09-08: "probably won't get used once we get in the flow, this
-- section we're building is really just a reference for new hires — so no logic
-- or stops, just a ref and checklist to help while learning."
--
-- That ruling is why this is a COLUMN and not a table. Nothing reads these
-- ticks: they gate nothing, block no send, and appear in no query. Their entire
-- job is that a half-worked package survives a page refresh while someone is
-- learning. A table would have brought a primary key, RLS policies, a realtime
-- channel and a migration of its own for state that is decoration.
--
-- SHAPE: { "pkg:0": true, "step:3": true } — the key names which item, the
-- value is always true (unticking DELETES the key). Keys are positional, so
-- editing a profile's steps can leave a stale key behind; that is deliberate
-- and harmless, since nothing reads them and the card ignores keys it has no
-- item for. Do NOT start deriving meaning from this column — the moment
-- anything depends on it, it needs to become a real table with real writes.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.work_orders
  add column if not exists ap_ticks jsonb not null default '{}'::jsonb;

comment on column public.work_orders.ap_ticks is
  'AP card checklist ticks, cosmetic only — {"pkg:0":true,"step:2":true}. '
  'Nothing reads this; it exists so a learner''s progress survives a refresh. '
  'See migration 20260908140000.';
