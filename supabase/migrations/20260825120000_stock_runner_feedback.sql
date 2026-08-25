-- ---------------------------------------------------------------------------
-- Stock corrections from the runner's Aug 24 test pass (Eli, 2026-08-25).
--
-- 1. Category moves — items regrouped by physical location/purpose:
--    Finish/hand soap/Gain/dryer sheets + RAID + Distilled Water → Cleaning.
-- 2. PRS-X (check-daily) list corrected: it is Chobani Sweet Cream Creamer,
--    Mini Half n Half, 1/2 Gallon 2% Milk. The two individual creamer-packet
--    items lose the marker; Chobani Vanilla is RENAMED to Sweet Cream (keeps
--    its check history — Eli's ruling over adding a new row).
-- 3. French Vanilla K-Cups replaced by Pike Place on the digital list.
-- 4. Bagel order = the paper habit: Plain, Everything, Cinnamon Raisin.
--    The three rows shared slot 67 (alphabetical fallback put Cinnamon
--    first); rows 68+ shift up 2 to make room. Guarded so a re-run no-ops.
-- 5. Junk row cleanup: the add-item bug (fixed in the same push) saved an
--    item literally named "C" mid-typing. No real item is ≤3 characters.
-- 6. Mic catalog typo carried over from the PDF: AKG 300B → 3000B.
--
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

-- ── 1. Category moves → Cleaning ────────────────────────────────────────────
update stock_items set category = 'Cleaning'
where studio = 'paramount' and section = 'stock'
  and item in (
    'Finish "Powerball" All-In-One', 'Hand Soap Refill',
    'Gain Powder Laundry Detergent', 'Anti-Static Dryer Sheets',
    'RAID Bug Spray', 'Distilled Water'
  );

-- ── 2. PRS-X list ───────────────────────────────────────────────────────────
update stock_items set item = 'Ind. French Vanilla Creamer Packets'
where studio = 'paramount' and item = 'Ind. French Vanilla Creamer Packets (PRS-X)';

update stock_items set item = 'Ind. French Hazelnut Creamer Packets'
where studio = 'paramount' and item = 'Ind. French Hazelnut Creamer Packets (PRS-X)';

update stock_items set item = 'Chobani Sweet Cream Creamer (PRS-X)'
where studio = 'paramount' and item = 'Chobani Vanilla Creamer';

-- ── 3. K-Cups: French Vanilla → Pike Place ──────────────────────────────────
update stock_items set item = 'Keurig Starbucks Pike Place'
where studio = 'paramount' and item = 'Keurig Green Mountain French Van.';

-- ── 4. Bagels: Plain, Everything, Cinnamon Raisin ───────────────────────────
do $$
begin
  if (select count(distinct sort_order) from stock_items
      where studio = 'paramount' and section = 'stock'
        and item like 'Sara Lee Bagels%') = 1 then
    update stock_items set sort_order = sort_order + 2
      where studio = 'paramount' and section = 'stock'
        and sort_order >= 68 and item not like 'Sara Lee Bagels%';
    update stock_items set sort_order = 67
      where studio = 'paramount' and item = 'Sara Lee Bagels — Plain';
    update stock_items set sort_order = 68
      where studio = 'paramount' and item = 'Sara Lee Bagels — Everything';
    update stock_items set sort_order = 69
      where studio = 'paramount' and item = 'Sara Lee Bagels — Cinnamon Raisin';
  end if;
end $$;

-- ── 5. Junk row from the add-item bug (cascades its stock_checks) ───────────
delete from stock_items
where studio = 'paramount' and char_length(trim(item)) <= 3;

-- ── 6. Mic catalog typo: AKG 300B → 3000B ───────────────────────────────────
update mics set name = replace(name, '300B', '3000B')
where name ilike '%akg%300b%' and name not ilike '%3000b%';

commit;
