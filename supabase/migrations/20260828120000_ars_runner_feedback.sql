-- ---------------------------------------------------------------------------
-- ARS runner test-pass corrections, Pass 1 of 3 (Eli, 2026-08-28).
-- Passes 2 (8:50 AM operational day) and 3 (notes boxes, odds qty, Genelec
-- qty, auth-guard retry) are code and follow separately.
--
-- 1. Soundstar lives at Ameraycan, not Paramount (end of the ARS list).
-- 2. TEST MIC deactivated (leftover seed row).
-- 3. Bagel small print: flavor order in the par text so submissions written
--    as "2/1/1" mean the same thing to everyone (same idea as the waters).
-- 4. FRIDGE section, all studios: the cold items live together because the
--    runner walks to one fridge — Dairy & Creamers is renamed Fridge and
--    butter / cream cheese / cookie dough (both spelling variants) + Ice
--    move in.
-- 5. Mic check-in TEST DATA WIPE: everything before the day this runs.
--    The Sheet's "last: HERE · 8/24" fine print was reading tap-testing
--    rows as history; real history starts tonight.
-- 6. mics.has_qty — per-item quantity flag (Genelecs first: the runners
--    write "(2)"); the mic page reads it in Pass 3.
-- 7. COD/billing card repair: SessionCard shows COD when
--    bookings.payment_type ≠ 'billing', projected from
--    work_orders.payment_status === 'Billing'. "Nine Vicious" showed COD on
--    a billing WO — a stale projection. The SELECT surfaces every mismatch;
--    the UPDATE repairs them all, not just the one.
--
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

-- ── 1. Soundstar → Ameraycan ────────────────────────────────────────────────
update mics set home_studio = 'ameraycan',
  sort_order = (select coalesce(max(sort_order), 0) + 1 from mics m2
                where m2.home_studio = 'ameraycan' and m2.category = 'mic')
where name = 'Soundstar' and home_studio = 'paramount';

-- ── 2. TEST MIC off ─────────────────────────────────────────────────────────
update mics set is_active = false where name = 'TEST MIC';

-- ── 3. Bagel flavor order in the par text ───────────────────────────────────
update stock_items set target = '4 Packs (Plain / Everything / Cin. Raisin)'
where studio in ('ameraycan', 'encore') and item = 'Sara Lee Assorted Bagels';

-- ── 4. Fridge section, all studios ──────────────────────────────────────────
update stock_items set category = 'Fridge'
where section = 'stock' and category = 'Dairy & Creamers';

update stock_items set category = 'Fridge'
where section = 'stock' and item in (
  'Spreadable Butter', 'Spreadable Butter (Canola Oil)',
  'Philadelphia Cream Cheese Packets',
  'Tollhouse Cookie Dough', 'Toll House Cookie Dough',
  'Ice'
);

-- ── 5. Mic test-data wipe (history starts tonight) ──────────────────────────
delete from mic_checkins
where date < to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD');
delete from mic_inventory_quantities
where date < to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD');
delete from mic_inventory_submissions
where date < to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD');

-- ── 6. Per-item quantity flag (read by the mic page in Pass 3) ──────────────
alter table mics add column if not exists has_qty boolean not null default false;
update mics set has_qty = true where name ilike 'Genelec%';

-- ── 7. COD/billing card repair ──────────────────────────────────────────────
-- Eyeball first: every card whose payment tag disagrees with its WO.
select b.id, b.artist, b.client_name, b.start_date,
       b.payment_type as card_says, w.payment_status as wo_says
from bookings b join work_orders w on b.work_order_id = w.id
where (w.payment_status = 'Billing') <> (b.payment_type = 'billing');

-- Repair: the WO is the source of truth (the-WO-is-the-booking).
update bookings b set payment_type = 'billing'
from work_orders w
where b.work_order_id = w.id
  and w.payment_status = 'Billing'
  and b.payment_type is distinct from 'billing';

update bookings b set payment_type = 'COD'
from work_orders w
where b.work_order_id = w.id
  and coalesce(w.payment_status, '') <> 'Billing'
  and b.payment_type = 'billing';

commit;
