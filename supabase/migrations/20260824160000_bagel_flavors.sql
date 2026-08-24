-- ---------------------------------------------------------------------------
-- Bagels get per-flavor quantities (Eli, 2026-08-24): one "Sara Lee Bagels"
-- line can't say how many Plain vs Cinnamon Raisin vs Everything are left.
-- Split it into three items. The sheet's total was 6 Packs → 2 Packs per
-- flavor as the par (adjust the targets in SQL if the real split differs).
-- Onion/Blueberry stay banned — that's why they aren't rows.
--
-- All three share sort_order 67 (the old line's slot); the page orders by
-- (sort_order, item) so they sit together alphabetically. Deleting the old
-- row cascades away its stock_checks — it existed for hours, no history lost.
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

delete from stock_items
where studio = 'paramount' and section = 'stock'
  and item = 'Sara Lee Bagels (No Onion/Blueberry!)';

insert into stock_items (studio, section, category, sort_order, item, target)
select v.studio, v.section, v.category, v.sort_order, v.item, v.target
from (values
  ('paramount', 'stock', 'Food & Condiments', 67, 'Sara Lee Bagels — Plain', '2 Packs'),
  ('paramount', 'stock', 'Food & Condiments', 67, 'Sara Lee Bagels — Cinnamon Raisin', '2 Packs'),
  ('paramount', 'stock', 'Food & Condiments', 67, 'Sara Lee Bagels — Everything', '2 Packs')
) as v(studio, section, category, sort_order, item, target)
where not exists (
  select 1 from stock_items s
  where s.studio = v.studio and s.item = v.item
);

commit;
