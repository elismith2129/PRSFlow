-- ---------------------------------------------------------------------------
-- Stock sections + the real PRS lists (Eli, 2026-08-24).
--
-- The runner Stock page shipped with a 10-item placeholder list. This
-- migration makes the table carry the REAL Paramount lists, transcribed from
-- the two paper sheets the runners have been using:
--   • "NEW PRS STOCK LIST - 2025.01"  → section 'stock'  (checked nightly;
--     the sheet's own rule: *Must Check PRS-X Items Daily*)
--   • "PRS Office Stock List - 2024"  → section 'office' (WEDNESDAYS ONLY —
--     the page greys it on other days and pulses it on Wednesday; it is also
--     the manager's Wednesday My Day duty)
--
-- New columns (all studios):
--   • section    'stock' | 'office' — office exists only for paramount today.
--   • target     the sheet's "Stock Amount" par level, display text ("1 Box").
--   • sort_order the sheet's order — the page stops sorting alphabetically.
--
-- PARAMOUNT ROWS ARE WIPED AND RESEEDED: the table went live 2026-08-18 with
-- placeholder items ("Water bottles (24-pack)" etc.), so any quantities typed
-- against those were against a list that never matched the paper. Other
-- studios' rows are untouched (default section 'stock').
--
-- Spelling normalized from the sheets: Sisscors→Scissors, Carmel→Caramel.
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

alter table stock_items add column if not exists section    text not null default 'stock';
alter table stock_items add column if not exists target     text not null default '';
alter table stock_items add column if not exists sort_order integer not null default 0;

delete from stock_items where studio = 'paramount';

-- ── PRS STOCK (nightly) — sheet order ──────────────────────────────────────
insert into stock_items (studio, section, sort_order, item, target) values
  ('paramount','stock',  1,'Chobani Vanilla Creamer','1 Bottle'),
  ('paramount','stock',  2,'Chobani Random Flavor Creamer','1 Bottle'),
  ('paramount','stock',  3,'Silk Caramel Creamer','1 Bottle'),
  ('paramount','stock',  4,'Quart Half n Half','1 Carton'),
  ('paramount','stock',  5,'Gallon 2% Milk','1 Jug'),
  ('paramount','stock',  6,'Silk Almond Milk (Unsweetened)','1 Carton'),
  ('paramount','stock',  7,'Silk Oat Yeah Oatmilk','1 Carton'),
  ('paramount','stock',  8,'Toll House Cookie Dough','8 Sheets'),
  ('paramount','stock',  9,'Philadelphia Cream Cheese Packets','1 Full Bag'),
  ('paramount','stock', 10,'Ind. French Vanilla Creamer Packets (PRS-X)','1 Box'),
  ('paramount','stock', 11,'Ind. French Hazelnut Creamer Packets (PRS-X)','1 Box'),
  ('paramount','stock', 12,'Mini Half n Half (PRS-X)','1 Jug'),
  ('paramount','stock', 13,'1/2 Gallon 2% Milk (PRS-X)','1 Jug'),
  ('paramount','stock', 14,'Spreadable Butter (Canola Oil)','1 Tub'),
  ('paramount','stock', 15,'Hand Sanitizer','3 Bottles'),
  ('paramount','stock', 16,'Windex','1 Refill Jug'),
  ('paramount','stock', 17,'Lysol Wipes','2 Cans'),
  ('paramount','stock', 18,'Pledge','2 Cans'),
  ('paramount','stock', 19,'Mop Head','2 Heads'),
  ('paramount','stock', 20,'Sponges','2 Individual'),
  ('paramount','stock', 21,'Formula 409','1 Bottle'),
  ('paramount','stock', 22,'Leather Cleaner','1 Bottle'),
  ('paramount','stock', 23,'Dawn Dish Soap','1 Bottle'),
  ('paramount','stock', 24,'Vinegar (White)','1 Bottle'),
  ('paramount','stock', 25,'Wet Swiffer Pads','1 Box'),
  ('paramount','stock', 26,'Febreeze','3 Cans'),
  ('paramount','stock', 27,'Crystal Geyser Water (Small)','4 Boxes'),
  ('paramount','stock', 28,'Crystal Geyser Water (Big)','4 Boxes'),
  ('paramount','stock', 29,'Distilled Water','1 Jug'),
  ('paramount','stock', 30,'Butter Popcorn','1 Bag'),
  ('paramount','stock', 31,'Cheesy Popcorn','1 Bag'),
  ('paramount','stock', 32,'Individual Red Apples','5 Apples'),
  ('paramount','stock', 33,'Individual Green Apples','5 Apples'),
  ('paramount','stock', 34,'Cuties','1 Large Bag'),
  ('paramount','stock', 35,'Box of Bi-Color Grapes','3 Boxes'),
  ('paramount','stock', 36,'Kleenex Ultra Soft','6 Boxes'),
  ('paramount','stock', 37,'English Breakfast Black Tea','2 Boxes'),
  ('paramount','stock', 38,'Lemon Ginger Tea','2 Boxes'),
  ('paramount','stock', 39,'Peppermint Herbal Tea','2 Boxes'),
  ('paramount','stock', 40,'Premium Green Tea','2 Boxes'),
  ('paramount','stock', 41,'Chamomile Caffeine Free Herbal Tea','2 Boxes'),
  ('paramount','stock', 42,'Throat Coat','2 Boxes'),
  ('paramount','stock', 43,'Starbucks Medium Roast House Blend Ground Coffee','2 Bags (20 oz.)'),
  ('paramount','stock', 44,'Stretch-tite Plastic Wrap','1 Box'),
  ('paramount','stock', 45,'Aluminum Foil','1 Box'),
  ('paramount','stock', 46,'Granulated Sugar Packets','1 Box'),
  ('paramount','stock', 47,'Sugar in the Raw Packets','1 Box'),
  ('paramount','stock', 48,'Jelly Packets','1 Box'),
  ('paramount','stock', 49,'Splenda','1 Box'),
  ('paramount','stock', 50,'Sweet''N''Low','1 Box'),
  ('paramount','stock', 51,'Equal','1 Box'),
  ('paramount','stock', 52,'Finish "Powerball" All-In-One','1 Jug'),
  ('paramount','stock', 53,'Hand Soap Refill','1 Large Jug'),
  ('paramount','stock', 54,'Gain Powder Laundry Detergent','1 Box'),
  ('paramount','stock', 55,'Anti-Static Dryer Sheets','2 Boxes'),
  ('paramount','stock', 56,'Keurig Starbucks Sumatra','2 Boxes (12 ct.)'),
  ('paramount','stock', 57,'Keurig Green Mountain French Van.','2 Boxes (12 ct.)'),
  ('paramount','stock', 58,'Keurig Green Mountain Car. Van. Crm.','2 Boxes (12 ct.)'),
  ('paramount','stock', 59,'Keurig Starbucks House Decaf','2 Boxes (12 ct.)'),
  ('paramount','stock', 60,'Hot Chocolate Packets','1 Box'),
  ('paramount','stock', 61,'Clear Drinking Straws','1 Box'),
  ('paramount','stock', 62,'Red Stir Straws','1 Box'),
  ('paramount','stock', 63,'Toothpicks','1 Box'),
  ('paramount','stock', 64,'Long Lighters','6 Individual'),
  ('paramount','stock', 65,'Nitrile Food Safe Gloves','1 Box'),
  ('paramount','stock', 66,'Latex Gloves','1 Box'),
  ('paramount','stock', 67,'Sara Lee Bagels (No Onion/Blueberry!)','6 Packs'),
  ('paramount','stock', 68,'Skippy Chunky Peanut Butter','1 Tub'),
  ('paramount','stock', 69,'Skippy Creamy Peanut Butter','1 Tub'),
  ('paramount','stock', 70,'Honey (Bear Jar)','1 Bear Jar'),
  ('paramount','stock', 71,'Yellow Mustard','1 Box'),
  ('paramount','stock', 72,'Ketchup','1 Bottle'),
  ('paramount','stock', 73,'Sriracha','1 Bottle'),
  ('paramount','stock', 74,'Cholula Hot Sauce','1 Bottle'),
  ('paramount','stock', 75,'Tapatio Hot Sauce','1 Bottle'),
  ('paramount','stock', 76,'Kikkoman Soy Sauce','1 Bottle'),
  ('paramount','stock', 77,'Hidden Valley Ranch Dressing','1 Bottle'),
  ('paramount','stock', 78,'A1 BBQ Sauce','1 Lg Bottle'),
  ('paramount','stock', 79,'Pepper','1 Shaker'),
  ('paramount','stock', 80,'Salt','1 Shaker'),
  ('paramount','stock', 81,'Bag of White Granulated Sugar','1 Large Bag'),
  ('paramount','stock', 82,'Blue Trash Bags','2 Boxes'),
  ('paramount','stock', 83,'White Trash Bags','2 Boxes'),
  ('paramount','stock', 84,'RAID Bug Spray','2 Cans'),
  ('paramount','stock', 85,'Toilet Paper','1 Full Box'),
  ('paramount','stock', 86,'Toilet Seat Covers','1 Pack'),
  ('paramount','stock', 87,'Vanity Fair Large Napkins','6 Packs'),
  ('paramount','stock', 88,'3000ct. Simply Value White Multifold','1 Full Box'),
  ('paramount','stock', 89,'Popcorn Paper Bowls (12 oz)','1 Pack'),
  ('paramount','stock', 90,'10" Paper Plates','1 Bag'),
  ('paramount','stock', 91,'Individual Cutlery','1 Large Bag'),
  ('paramount','stock', 92,'Glade Plug-ins Refill','4 Individual'),
  ('paramount','stock', 93,'AAA Batteries','2 Large Packs'),
  ('paramount','stock', 94,'AA Batteries','2 Large Packs'),
  ('paramount','stock', 95,'3V Batteries (2032)','1 Small Pack'),
  ('paramount','stock', 96,'3V Batteries (CR2450)','2 Small Packs'),
  ('paramount','stock', 97,'9V Batteries','2 Packs'),
  ('paramount','stock', 98,'Ear Plugs','3 Large Jars')
on conflict (studio, item) do nothing;

-- ── OFFICE (Wednesdays only) — sheet order ──────────────────────────────────
insert into stock_items (studio, section, sort_order, item, target) values
  ('paramount','office',  1,'Red Pens','1 Box'),
  ('paramount','office',  2,'Black Pens','1 Box'),
  ('paramount','office',  3,'Blue Pens','1 Box'),
  ('paramount','office',  4,'Red Sharpies','1 Box'),
  ('paramount','office',  5,'Black Sharpies','1 Box'),
  ('paramount','office',  6,'Blue Sharpies','1 Box'),
  ('paramount','office',  7,'Red Ultra Fine Sharpies','1 Box'),
  ('paramount','office',  8,'Black Ultra Fine Sharpies','1 Box'),
  ('paramount','office',  9,'Blue Ultra Fine Sharpies','1 Box'),
  ('paramount','office', 10,'Pencils','2 Boxes'),
  ('paramount','office', 11,'Large Notepads','3 Packs'),
  ('paramount','office', 12,'Small Notepads','3 Packs'),
  ('paramount','office', 13,'Large Post-It Notes','3 Packs'),
  ('paramount','office', 14,'Small Post-It Notes','3 Packs'),
  ('paramount','office', 15,'Scotch Tape','3 Rolls'),
  ('paramount','office', 16,'Printer Ink','1 Box'),
  ('paramount','office', 17,'Staples','3 Boxes'),
  ('paramount','office', 18,'Binder Clips','1 Box'),
  ('paramount','office', 19,'Big Paper Clips','2 Boxes'),
  ('paramount','office', 20,'Small Paper Clips','2 Boxes'),
  ('paramount','office', 21,'White Out','1 Pack'),
  ('paramount','office', 22,'Plain White Envelopes','1 Box'),
  ('paramount','office', 23,'Emergen-C','1 Box'),
  ('paramount','office', 24,'Advil/Ibuprofen','1 Bottle'),
  ('paramount','office', 25,'First Aid Kit','1 Kit'),
  ('paramount','office', 26,'Printer Paper','2 Packs'),
  ('paramount','office', 27,'Highlighters','1 Box'),
  ('paramount','office', 28,'Scissors','2 Pairs'),
  ('paramount','office', 29,'Post-It Flags','2 Packs'),
  ('paramount','office', 30,'Cough Drops','1 Bag'),
  ('paramount','office', 31,'Expo Markers','1 Box'),
  ('paramount','office', 32,'Allergy Medicine','1 Bottle'),
  ('paramount','office', 33,'Bandaids','1 Box'),
  ('paramount','office', 34,'Tums','1 Bottle'),
  ('paramount','office', 35,'Neosporin','1 Tube')
on conflict (studio, item) do nothing;

comment on column stock_items.section is
  'stock = the nightly runner list; office = the Wednesdays-only office list (paramount only today). Page greys office on other days.';
comment on column stock_items.target is
  'Par level from the paper sheet ("Stock Amount"), display text only.';

commit;
