-- ---------------------------------------------------------------------------
-- Stock regroup (Eli, 2026-08-24): "put all food in one and all water in
-- one" — and Food & Condiments loses the food, becoming plain Condiments.
-- Run AFTER 20260824150000/160000 (Eli ran the equivalent by hand the same
-- day; this file exists so migration history matches the live DB).
--
-- Result: Dairy & Creamers · Food · Water · Condiments · Cleaning ·
-- Coffee & Tea · Kitchen & Supplies · Paper & Restroom · Batteries & Misc.
-- Idempotent.
-- ---------------------------------------------------------------------------

begin;

update stock_items set category = 'Water'
where studio = 'paramount' and section = 'stock'
  and item in ('Crystal Geyser Water (Small)', 'Crystal Geyser Water (Big)', 'Distilled Water');

update stock_items set category = 'Food'
where studio = 'paramount' and section = 'stock'
  and item in (
    'Toll House Cookie Dough', 'Philadelphia Cream Cheese Packets',
    'Spreadable Butter (Canola Oil)',
    'Butter Popcorn', 'Cheesy Popcorn',
    'Individual Red Apples', 'Individual Green Apples',
    'Cuties', 'Box of Bi-Color Grapes',
    'Sara Lee Bagels — Plain', 'Sara Lee Bagels — Cinnamon Raisin', 'Sara Lee Bagels — Everything',
    'Skippy Chunky Peanut Butter', 'Skippy Creamy Peanut Butter',
    'Honey (Bear Jar)', 'Jelly Packets'
  );

update stock_items set category = 'Condiments'
where studio = 'paramount' and section = 'stock'
  and category in ('Food & Condiments', 'Water & Snacks');

commit;
