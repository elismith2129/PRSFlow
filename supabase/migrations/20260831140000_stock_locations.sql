-- ---------------------------------------------------------------------------
-- Stock by LOCATION (Eli's runner notes, 2026-08-31).
--
-- The lists are grouped by what a thing IS (Cleaning, Food, Coffee & Tea). The
-- runner counting them walks a ROOM: Lysol wipes and mop heads are both
-- "Cleaning" but live in two different closets, and the black bin by the door
-- holds bagels, a coffee and the condiments — three categories, one reach.
-- Counting by category means walking the building three times.
--
-- So `location` is a SECOND grouping, not a replacement. The page opens in
-- location order (Eli's ruling) with a Type / Location toggle, and category
-- stays exactly as it is for anyone who wants to see all the cleaning supplies
-- together. Nothing about items, quantities or history moves.
--
-- The eight locations, transcribed from Eli's walk-through:
--   Kitchen Fridge · PRS X Fridge · Kitchen Closet · Stock Closet ·
--   Stock Fridge · Tea & Coffee Bin · Bagel/Condiment Bin · Office Cabinet
--
-- Assignments are BY ID, matched against the live table rather than by name,
-- because the names have drifted (the Aug 25 corrections renamed items and the
-- sheets spell several differently). Every one of the 134 Paramount rows is
-- placed; nothing lands in Unassigned today.
--
-- Three rulings folded in (2026-08-31):
--   · The Chobani creamer is ONE row. Eli's list had it in the kitchen fridge
--     under its old name ("Vanilla") and in PRS X under the new one; the Aug 25
--     rename made them the same item. It sits in PRS X Fridge.
--   · The two individual creamer-packet boxes → Kitchen Fridge; foil → Stock
--     Closet (they were absent from the walk-through list).
--   · The whole WEDNESDAY OFFICE list (34 items: pens, sharpies, first aid) →
--     Office Cabinet, one group. Note this differs from Eli's "OFFICE CABINET"
--     heading, which turned out to be the batteries and Glade refills — those
--     live in the NIGHTLY list and are also placed here. Location is
--     independent of section on purpose.
--
-- Group ORDER on the page is derived from each location's lowest sort_order,
-- so the sheet's order still drives the walk and adding a location later needs
-- no code change.
--
-- Idempotent; run by hand in the Supabase SQL editor. Verify:
--   select location, count(*) from stock_items where studio='paramount'
--   group by location order by 2 desc;
-- ---------------------------------------------------------------------------

begin;

alter table stock_items add column if not exists location text not null default '';

comment on column stock_items.location is
  'Where the item physically lives (2026-08-31) — the runner''s walk order. A SECOND grouping beside category, never a replacement; empty string = Unassigned, which the page shows as its own group at the bottom.';

create index if not exists stock_items_studio_location_idx
  on stock_items (studio, location);

-- Kitchen Fridge (11)
update stock_items set location = 'Kitchen Fridge' where id in (
    '2f6cebcb-905d-4bdd-85c4-82d076de84f4',
    '8ada8051-e541-45f3-9d31-94c0cfb6525e',
    'a97670c9-80f2-4b0a-96da-06493fef23b8',
    'b0563ab1-68fe-44bf-94b0-0bda6f9bf664',
    '12fe5214-ed4a-4ac7-8ded-2beb22936ce5',
    '6d4d578f-4ec6-4aab-b8d6-4e0602bbadfe',
    '0cbbd0db-3006-43a9-9f1a-b05ce47d5056',
    '34311e1b-e4cb-441d-9978-67cbce9ff9c2',
    'a6b5a1ef-3e0b-4d7e-a879-3f3e589da515',
    '8edb8b74-44a2-458f-8424-261fc18da4d0',
    '940292d3-5dd1-46f6-aa83-31197e1079e9'
  );

-- PRS X Fridge (3)
update stock_items set location = 'PRS X Fridge' where id in (
    '7b314133-8716-43b4-a859-60a90f7220bc',
    '2becc3f2-1471-4df0-9c09-a75a89bb98d2',
    '82f2d8a4-676b-41a8-a6c9-6e272e8e88a9'
  );

-- Kitchen Closet (16)
update stock_items set location = 'Kitchen Closet' where id in (
    '6fd71be8-ade7-453b-a156-3a475c9e7c1c',
    '98fe8225-f0ce-4c9f-8e5b-569070fe03dd',
    '2022d09f-73be-4f01-9d5b-182fd98114ad',
    '76a0b6a9-d511-4cdc-95f1-1676383fed93',
    '6ffd3d4f-24ca-465b-a128-69b8a77103a8',
    '8a5cd52e-b048-457c-8b23-fc0d1f228c1e',
    '04e8335e-c065-4cce-b7fa-1b7d245cd57f',
    '0d1e85b3-997f-496a-ac7e-4ddb6bc92c78',
    '4df0a1a2-eb56-430b-b250-cbff198594f6',
    '3c7b2e5e-909c-4f84-9a0b-80c92c53d84c',
    '6cace563-123e-40c2-b445-ec3be5781439',
    '837991ed-6854-4330-8aa5-66720f47a937',
    '4732c317-5439-4db0-bdf8-a5b176b163e7',
    '54396e14-d044-48c8-a309-7a8cca5ddc00',
    '88ce3218-f63b-4d79-9b74-672879b5d72c',
    '14e3b1e8-d7ab-4269-9040-d2af0970c4b4'
  );

-- Stock Closet (32)
update stock_items set location = 'Stock Closet' where id in (
    '093c1c02-127f-43a7-ae7e-fccf7189d195',
    '6e79aba8-2d4e-4464-832f-95264f568dc5',
    'eaed8398-1a31-464e-9824-ba1b86b32240',
    '5ae6b670-c11f-40ce-af47-857bb8642752',
    '934beb1e-53d4-4154-8e12-15509e029bb3',
    '4042e8e1-ccf9-43f9-abda-774c0da1f67a',
    'b0bc2756-5924-41ff-9fcb-c446baca1cd3',
    'dc893e27-761a-430a-84ab-0d2016ca8b6b',
    '4cc59b42-ecc2-4565-b889-da1a343928af',
    'da464913-ff27-4b9f-b722-7a5a210772ba',
    '5b2a9c8f-4a35-4c0a-bf70-486dcf20f731',
    '541301bf-9643-4ee7-97fb-a730308a2bf2',
    '15f4b7bf-7e1c-4f4d-86a6-b22aa3fa0aaa',
    'c8cae650-d3e2-4ca7-899f-6d146f628f48',
    '33e565f0-8f52-420d-9148-08eda344604b',
    'bf83be2c-99f5-4f13-bd7a-417229b79bba',
    '978dd135-67a6-481d-8380-f539a2494788',
    '2e97e47b-0659-4ec0-ad02-54f011b45990',
    '8c64eb1a-f99e-492f-add7-f6ed8806a6d5',
    '91d70103-03b4-4173-9fb5-02b26e68b64a',
    'bd2f0fde-8a3b-4cb5-b0c2-9a77eb069d17',
    '152295ec-5961-41db-9010-5c6b3a246f45',
    '3ca3669a-c183-43a5-8999-3bfced40bf61',
    'a8889299-9198-4da5-b4dd-2055e76e7bf0',
    '875d4823-c1d7-4276-9c30-1c1d30fa507d',
    'aa2f04b1-8c87-4ef5-972b-3da36750c751',
    '8d0d80a7-e5ef-4ccc-9e52-69cc9196acc1',
    'da89800f-596a-4c38-ad05-cccc17c53ba6',
    '61a6d5e4-5437-4cc5-a38e-ac4ac88f09c8',
    'ce455556-32eb-4c60-a198-98cf5ddda014',
    'a4845ac2-2f1e-4ff6-b42f-ada6b457474e',
    '7222e03b-cd38-414a-b441-a3e4c2ac3ad3'
  );

-- Stock Fridge (4)
update stock_items set location = 'Stock Fridge' where id in (
    'c940299f-e7a7-40f5-afe8-e02bacf26c77',
    '6b354d5c-4e0f-4917-9229-2e76bfab2b88',
    'c72e2f44-b8d1-481a-b747-60fded7bdcbc',
    'c3e29905-1db6-4a4f-a938-9db23613576b'
  );

-- Tea & Coffee Bin (10)
update stock_items set location = 'Tea & Coffee Bin' where id in (
    'b83edf46-c605-455b-9f65-c769aaedf38d',
    'a482d4e2-17b5-40d9-ad95-eea041e8ff01',
    'b4f4f790-e319-4d58-85ca-979c715b4f4c',
    'b143be83-c74c-4c9b-89b9-d9787331a408',
    '1523968b-bc57-4208-8e50-13455ea24d1e',
    '6b8f2049-6cc9-4660-83fa-ec2557ca730a',
    '65ec2aa9-d540-4eb6-891f-95450c8a012c',
    '72d652ce-ce41-4655-a184-22a2503e7a6f',
    '0a5f7c04-1f25-404a-9588-d4ffe840e65d',
    '8b35a510-bec5-4395-8d2f-4118e604883e'
  );

-- Bagel/Condiment Bin (17)
update stock_items set location = 'Bagel/Condiment Bin' where id in (
    '24277da8-d832-4663-be73-1444cc1483ad',
    'f9629870-6f62-4602-a067-37933ec15e01',
    'ed03e6e4-852f-4433-800f-147fd222f5be',
    'f2070fbf-0fc7-4b1b-a086-8b5918783634',
    '93980299-5067-419f-9392-1fd5690d5ef3',
    'bb5f3525-773c-4818-ae0d-05b4d201f3d1',
    'bc16c5e9-aabd-4558-b78a-6ddd575318a8',
    'd3d1eb4a-e8ca-4efb-a178-e37b73bbb561',
    '47a4f831-6feb-4f9c-84a7-31c471c999c9',
    'a49cdcc7-8827-4776-adc9-a4904a35fe29',
    '45648b14-44ed-4413-a5f3-f2b6e2b29c30',
    '7690b15e-f8a0-4914-afe0-5b7d7e3db3cf',
    'e9be55ff-15d5-4145-a372-d629307dac44',
    'de5cce33-4f2e-4b77-a56c-6f5c33b92a01',
    'cc264810-821c-4de0-90e0-3beb3076755b',
    'c9e9c285-c9b5-4863-87d1-08ab5bcdbeef',
    'ca82ef18-282c-41a9-8569-bc8de5c08fd2'
  );

-- Office Cabinet (41)
update stock_items set location = 'Office Cabinet' where id in (
    'afc4dae4-d067-4012-92c7-be27555ed26d',
    'df642f32-e65b-4a8c-99c3-c6c6d5d7cefc',
    '94b32316-9173-40f4-9468-7c8d5a9fa2a5',
    '74f0de80-4eb4-4805-a2ab-79c43c4e31d9',
    '6868a378-26d2-4ef8-837f-680044ae0b16',
    'bd27d288-9b59-4547-9788-65c5efdb3901',
    'c6e38bf7-efc0-43fc-9d48-5e0ac25664c2',
    'b5b4dfd1-edee-43dc-854d-c3843074dc16',
    '6e5545e9-4e7b-4513-a132-b1a195020360',
    '8228dfbc-2b8f-4b7e-8594-052eb24faa37',
    '65266333-6dfc-444d-8137-d090cd4b4981',
    '61ffc21a-6d8f-475b-8864-cb9a72d43578',
    '7d1c2459-7169-4501-abb0-5d26094cb896',
    'b240ee2b-26aa-43c9-b404-542807220948',
    'd38b97fa-a9c8-4c01-94c5-6ce8e5f7d4b9',
    'c10d6f9e-c55d-444c-84d0-98535ddaf669',
    '3e17147e-3466-4094-a37d-d6200beff415',
    '93c417c0-67f5-410f-94e1-e861e9d64a7d',
    '3232e573-38e7-4d03-b357-1d9e8e230116',
    'a9c09085-4a76-4e35-a1a8-fa0c965a93d2',
    '70c46d23-e2e7-41ce-a06f-fa5bbe039a39',
    '5c7a7608-0b49-4b22-8d50-06c7fbc20542',
    'ecf3b278-a73f-4b83-bea9-fae91b8ccbe5',
    '16fc4066-95d4-49be-a59c-f4c735edff57',
    '42e204db-0c44-4714-8d93-ad7e2003dd67',
    'cd79def7-8de2-44b6-ac5d-aa33f2e5a31d',
    '03d26303-1277-405c-8496-b9c93bd37b7f',
    '920c84e9-9751-4e13-8f09-0888515ecfc3',
    '78e4caff-a709-4b37-974b-7cc794f3d522',
    '80db860a-0c9b-420c-8795-c8184a5b07ad',
    '93f0b3c8-3eb9-4f4c-82b6-4091ac9bc542',
    '93df3563-f20d-4480-a432-38a9bf5e88ac',
    '6a359f4d-7d0e-42c6-beee-2ca1aa75d112',
    '69b19510-c473-4b14-b5f3-9feb5c1838da',
    '9327d7e2-08fe-43f4-b360-327ca03c1457',
    '0077332f-c404-4577-af39-e91ec80ad291',
    'b79ed652-6cad-48e1-9afc-f4ddfd153fca',
    '51bc27bc-fb56-4d0e-9fe2-5065cb434c15',
    'b56962ce-dca1-499e-8f61-75a72f265e4b',
    '23c919d2-c730-4c6f-ae83-1ceb181430d9',
    '12fa5ce3-f9ba-4253-afe7-b3728c841f49'
  );

commit;
