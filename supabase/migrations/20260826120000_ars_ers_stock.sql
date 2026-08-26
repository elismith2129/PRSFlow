-- ---------------------------------------------------------------------------
-- Ameraycan + Encore stock lists (Eli, 2026-08-26 — the all-studios runner
-- rollout, "start strong before their runners test").
--
-- Transcribed from the two uploaded paper sheets ("ARS Stock List" / "ERS
-- Stock List") — the same printed template, so the 83 printed items seed
-- both studios. The 5 handwritten K-Cup additions at the bottom of page 2
-- (SB Sumatra / SB Pikes Place / GM V Cream / SB Brkfst Blend / SBHB Decaf,
-- expanded to Paramount's Keurig naming) are ARS-ONLY — Eli's correction
-- 2026-08-26: ERS does not stock K-Cups. Track has NO stock lists at all
-- right now (also Eli, 2026-08-26) — deliberately not seeded.
--
-- Conventions carried from the Paramount seed (20260824140000) and the
-- Aug 25 corrections (20260825120000):
--   • sort_order = the sheet's order; target = the sheet's "Stock Amount".
--   • Categories use Paramount's group vocabulary (Food / Dairy & Creamers /
--     Coffee & Tea / Water / Condiments / Cleaning / Kitchen & Supplies /
--     Paper & Restroom / Batteries & Misc) so groups read the same at every
--     studio. Groups appear in first-encounter sheet order.
--   • RAID + hand soap + Finish pods etc. seeded straight into Cleaning
--     (the Aug 25 Paramount ruling — no need to re-learn it here).
--   • Spelling normalized: Chalula→Cholula (same as Sisscors→Scissors).
--   • No check-daily markers — these sheets have no PRS-X equivalent.
--   • section = 'stock' for everything; office lists come separately.
--
-- ARS + ERS ROWS ARE WIPED AND RESEEDED: whatever those studios hold today
-- is either the 10-item generic placeholder or stray runner-typed rows that
-- never matched a paper list. Deleting cascades their stock_checks — the
-- history is against items that never matched the sheet, accepted loss.
-- Paramount and Track are untouched.
--
-- Idempotent; run by hand in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

begin;

delete from stock_items where studio in ('ameraycan', 'encore');

insert into stock_items (studio, section, category, sort_order, item, target)
select s.studio, 'stock', v.cat, v.ord, v.item, v.amt
from (values ('ameraycan'), ('encore')) as s(studio)
cross join (values
  -- page 1 ────────────────────────────────────────────────────────────────
  ( 1,'Food','Individual Red Apples','4 Apples'),
  ( 2,'Food','Individual Green Apples','4 Apples'),
  ( 3,'Food','Cuties','1 Bag'),
  ( 4,'Food','Individual Oranges','4 Oranges'),
  ( 5,'Food','Box of Grapes','2 Boxes'),
  ( 6,'Dairy & Creamers','French Vanilla Creamer','2'),
  ( 7,'Dairy & Creamers','Hazelnut Creamer','2'),
  ( 8,'Dairy & Creamers','Random Cream Creamer','2'),
  ( 9,'Dairy & Creamers','Quart Half''n''Half','1'),
  (10,'Dairy & Creamers','Gallon 2% Milk','1'),
  (11,'Dairy & Creamers','Silk Almond Milk','1 Bottle'),
  (12,'Dairy & Creamers','Silk Oat Milk','1 Bottle'),
  (13,'Food','Spreadable Butter','1 Box'),
  (14,'Food','Philadelphia Cream Cheese Packets','1 Full Bag'),
  (15,'Food','Tollhouse Cookie Dough','3 Tubs'),
  (16,'Water','Ice','4x 7lb Bags'),
  (17,'Coffee & Tea','English Breakfast Black Tea','2 Boxes'),
  (18,'Coffee & Tea','Earl Grey Black Tea','2 Boxes'),
  (19,'Coffee & Tea','Peppermint Caffeine Free Herbal Tea','2 Boxes'),
  (20,'Coffee & Tea','Premium Green Tea','2 Boxes'),
  (21,'Coffee & Tea','Chamomile Caffeine Free Herbal Tea','2 Boxes'),
  (22,'Coffee & Tea','Throat Coat','2 Boxes'),
  (23,'Coffee & Tea','Hot Chocolate Packets','1 Box'),
  (24,'Condiments','Bag of White Granulated Sugar','1 Large Bag'),
  (25,'Food','Big Honey Bear','3 Bear Jars'),
  (26,'Coffee & Tea','Starbucks House Ground Coffee','4 Large Bags'),
  (27,'Coffee & Tea','Coffee Filters','1 Pack'),
  (28,'Condiments','Yellow Mustard','2 Bottles'),
  (29,'Condiments','Ketchup','2 Bottles'),
  (30,'Condiments','Sriracha','1 Large Bottle'),
  (31,'Condiments','Cholula Hot Sauce','2 Bottles'),
  (32,'Condiments','Tapatio Hot Sauce','2 Bottles'),
  (33,'Condiments','Kikkoman Soy Sauce','1 Bottle'),
  (34,'Condiments','Ranch Dressing','1 Lg Bottle'),
  (35,'Condiments','A1 BBQ Sauce','1 Bottle'),
  (36,'Condiments','Salt & Pepper','2 Shakers ea'),
  (37,'Food','Sara Lee Assorted Bagels','4 Packs'),
  (38,'Food','Chunky Peanut Butter','1 Tub'),
  (39,'Food','Creamy Peanut Butter','1 Tub'),
  (40,'Food','Jelly Packets','1 Box'),
  (41,'Paper & Restroom','Poms Individually Wrapped Toilet Paper','1 Full Box'),
  (42,'Paper & Restroom','Vanity Fair Square Napkins','6 Packs'),
  -- page 2 ────────────────────────────────────────────────────────────────
  (43,'Water','Crystal Geyser Waters','3 Sm / 3 Large'),
  (44,'Condiments','Granulated Sugar Packets','1 Box'),
  (45,'Condiments','Sugar in the Raw Packets','1 Box'),
  (46,'Condiments','Sweet''N''Low','1 Box'),
  (47,'Condiments','Equal','1 Box'),
  (48,'Condiments','Splenda','1 Box'),
  (49,'Kitchen & Supplies','Clear Drinking Straws','1 Box'),
  (50,'Kitchen & Supplies','Red Stir Straws','1 Box'),
  (51,'Kitchen & Supplies','Latex Gloves','1 Box'),
  (52,'Cleaning','Sponges','4'),
  (53,'Kitchen & Supplies','Toothpicks','2 Boxes'),
  (54,'Paper & Restroom','Individually Wrapped Plastic Silverware','1 Full Box'),
  (55,'Paper & Restroom','10" Paper Plates','1 Bag'),
  (56,'Paper & Restroom','Kleenex','6 Boxes'),
  (57,'Paper & Restroom','White Multifold Paper Towels','1 Full Box'),
  (58,'Kitchen & Supplies','Aluminum Wrap','1'),
  (59,'Kitchen & Supplies','Stretch-tite Plastic Wrap','2'),
  (60,'Kitchen & Supplies','12 oz. Coffee Cups','5 Bags'),
  (61,'Kitchen & Supplies','12 oz. Coffee Lids','2 Bags'),
  (62,'Paper & Restroom','Blue Trash Bags','2 Boxes'),
  (63,'Paper & Restroom','White Trash Bags','2 Boxes'),
  (64,'Cleaning','Hand Soap Refill','2 Large Jugs'),
  (65,'Cleaning','Hand Sanitizer','4 Bottles'),
  (66,'Cleaning','Febreeze','6 Cans'),
  (67,'Cleaning','Vinegar (White)','1 Bottle'),
  (68,'Cleaning','Lysol Wipes','2 Cans'),
  (69,'Cleaning','Finish Dish Detergent Pods','2 Jugs'),
  (70,'Cleaning','Dish Soap','1 Bottle'),
  (71,'Kitchen & Supplies','Long Lighters','5'),
  (72,'Cleaning','Pledge','2 Cans'),
  (73,'Cleaning','RAID Bug Spray','2 Cans'),
  (74,'Cleaning','Wet Swiffer Pads','1 Box'),
  (75,'Cleaning','Leather Cleaner','1 Bottle'),
  (76,'Paper & Restroom','Toilet Seat Covers','1 Pack'),
  (77,'Cleaning','Formula 409','2'),
  (78,'Cleaning','Windex','1 Refill Jug'),
  (79,'Batteries & Misc','Glade Plug-ins Refill','4'),
  (80,'Batteries & Misc','AAA Batteries','2 Lg Packs'),
  (81,'Batteries & Misc','AA Batteries','2 Lg Packs'),
  (82,'Batteries & Misc','2450 Batteries','1 Pack'),
  (83,'Batteries & Misc','Ear Plugs','4 Jugs')
) as v(ord, cat, item, amt);

-- Handwritten K-Cup additions (bottom of page 2) — ARS ONLY. ERS does not
-- stock K-Cups (Eli, 2026-08-26).
insert into stock_items (studio, section, category, sort_order, item, target)
values
  ('ameraycan','stock','Coffee & Tea', 84,'Keurig Starbucks Sumatra','2 Boxes'),
  ('ameraycan','stock','Coffee & Tea', 85,'Keurig Starbucks Pike Place','2 Boxes'),
  ('ameraycan','stock','Coffee & Tea', 86,'Keurig Green Mountain Vanilla Cream','2 Boxes'),
  ('ameraycan','stock','Coffee & Tea', 87,'Keurig Starbucks Breakfast Blend','2 Boxes'),
  ('ameraycan','stock','Coffee & Tea', 88,'Keurig Starbucks House Blend Decaf','2 Boxes');

-- ARS does not do Individual Oranges — Cuties only (Eli, 2026-08-26; the
-- sheet's crossed-out annotation). Deleted here too so a re-run of this
-- seed can't resurrect it regardless of order with 20260826130000.
delete from stock_items
where studio = 'ameraycan' and section = 'stock' and item = 'Individual Oranges';

commit;
