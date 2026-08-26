-- ---------------------------------------------------------------------------
-- Ameraycan + Encore OFFICE stock lists (Eli, 2026-08-26) + the ARS oranges
-- correction. Run AFTER 20260826120000_ars_ers_stock.sql.
--
-- Transcribed from the uploaded "ARS Office Stock List" and "ERS Office
-- Stock List - 2024" sheets. Same template through Highlighters (26 items);
-- targets kept per each studio's own sheet where they differ (White Out,
-- Post-Its, First Aid Kit, Highlighters).
--
-- ELI'S CUT (2026-08-26, confirmed twice): on the ERS sheet, NOTHING below
-- Printer Paper is included EXCEPT Bandaids — so Highlighters, Sisscors,
-- Post-It Flags, Coughdrops, Expo Markers, Allergy Medicine, Tums and
-- Neosporin are all deliberately absent from ERS. ARS keeps Highlighters
-- (the cut was scoped to ERS; ARS's own sheet lists it). Spelling note: the
-- dropped "Sisscors" would have been normalized to Scissors.
--
-- ALSO: BOTH studios drop Individual Oranges from the nightly list — "we
-- just do the cuties" (the sheets' crossed-out annotation, confirmed by
-- Eli for ARS then extended to ERS). Idempotent deletes, so this file works
-- whether or not the 120000 seed ran first or is re-run later.
--
-- Office rows are flat (category NULL), same as Paramount's office list.
-- The stock page's two-button landing (ARS Stock / Office, Wednesdays-only
-- office) appears automatically once these rows exist — no code change.
--
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

-- ── Nightly correction, both studios: no Individual Oranges, Cuties only ────
delete from stock_items
where studio in ('ameraycan', 'encore') and section = 'stock' and item = 'Individual Oranges';

-- ── Office lists: wipe-and-reseed office rows for these two studios only ────
delete from stock_items where studio in ('ameraycan', 'encore') and section = 'office';

-- Shared template (26 items) — per-studio targets from each sheet.
insert into stock_items (studio, section, sort_order, item, target)
values
  -- Ameraycan ("ARS Office Stock List")
  ('ameraycan','office', 1,'Red Pens','1 Box'),
  ('ameraycan','office', 2,'Black Pens','1 Box'),
  ('ameraycan','office', 3,'Blue Pens','1 Box'),
  ('ameraycan','office', 4,'Red Sharpies','1 Box'),
  ('ameraycan','office', 5,'Black Sharpies','1 Box'),
  ('ameraycan','office', 6,'Blue Sharpies','1 Box'),
  ('ameraycan','office', 7,'Red Ultra Fine Sharpies','1 Box'),
  ('ameraycan','office', 8,'Black Ultra Fine Sharpies','1 Box'),
  ('ameraycan','office', 9,'Blue Ultra Fine Sharpies','1 Box'),
  ('ameraycan','office',10,'Pencils','2 Boxes'),
  ('ameraycan','office',11,'Large Notepads','3 Packs'),
  ('ameraycan','office',12,'Small Notepads','3 Packs'),
  ('ameraycan','office',13,'Large Post-It Notes','6 Individuals (at least)'),
  ('ameraycan','office',14,'Small Post-It Notes','6 Individuals (at least)'),
  ('ameraycan','office',15,'Scotch Tape','3 Rolls (at least)'),
  ('ameraycan','office',16,'Printer Ink','1 Box'),
  ('ameraycan','office',17,'Staples','1 Box'),
  ('ameraycan','office',18,'Binder Clips','1 Box'),
  ('ameraycan','office',19,'Paper Clips','1 Box'),
  ('ameraycan','office',20,'White Out','2'),
  ('ameraycan','office',21,'Plain White Envelopes','1 Box'),
  ('ameraycan','office',22,'Emergen-C','1 Box'),
  ('ameraycan','office',23,'Advil/Ibuprofen','1 Bottle'),
  ('ameraycan','office',24,'First Aid Kit','1'),
  ('ameraycan','office',25,'Printer Paper','2 Packs'),
  ('ameraycan','office',26,'Highlighters','1 Pack'),
  -- Encore ("ERS Office Stock List - 2024")
  ('encore','office', 1,'Red Pens','1 Box'),
  ('encore','office', 2,'Black Pens','1 Box'),
  ('encore','office', 3,'Blue Pens','1 Box'),
  ('encore','office', 4,'Red Sharpies','1 Box'),
  ('encore','office', 5,'Black Sharpies','1 Box'),
  ('encore','office', 6,'Blue Sharpies','1 Box'),
  ('encore','office', 7,'Red Ultra Fine Sharpies','1 Box'),
  ('encore','office', 8,'Black Ultra Fine Sharpies','1 Box'),
  ('encore','office', 9,'Blue Ultra Fine Sharpies','1 Box'),
  ('encore','office',10,'Pencils','2 Boxes'),
  ('encore','office',11,'Large Notepads','3 Packs'),
  ('encore','office',12,'Small Notepads','3 Packs'),
  ('encore','office',13,'Large Post-It Notes','6 Individuals'),
  ('encore','office',14,'Small Post-It Notes','6 Individuals'),
  ('encore','office',15,'Scotch Tape','3 Rolls'),
  ('encore','office',16,'Printer Ink','1 Box'),
  ('encore','office',17,'Staples','1 Box'),
  ('encore','office',18,'Binder Clips','1 Box'),
  ('encore','office',19,'Paper Clips','1 Box'),
  ('encore','office',20,'White Out','1 Pack'),
  ('encore','office',21,'Plain White Envelopes','1 Box'),
  ('encore','office',22,'Emergen-C','1 Box'),
  ('encore','office',23,'Advil/Ibuprofen','1 Bottle'),
  ('encore','office',24,'First Aid Kit','1 Kit'),
  ('encore','office',25,'Printer Paper','2 Packs'),
  -- ERS keeps ONE item from below Printer Paper: Bandaids (Eli's cut —
  -- Highlighters and the rest of the tail are out).
  ('encore','office',26,'Bandaids','1 Box');

commit;
