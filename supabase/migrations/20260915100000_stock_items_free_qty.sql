-- Per-item full keyboard on the stock page (ERS runner report, 2026-09-15).
-- The qty input opens the number pad (Eli, 2026-08-31); a few items are
-- counted as "3 Sm / 3 Large" and the pad has no slash. Flagged items open
-- the full keyboard; everything else keeps the pad.
alter table stock_items add column if not exists free_qty boolean not null default false;
