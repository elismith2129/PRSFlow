-- Food service fee is adjustable per work order (Eli, 2026-09-17).
-- NULL = the default (lib/woTotals FOOD_SERVICE_FEE_RATE, 45%). Stored as a
-- whole-number percent in TEXT like every WO money field; math parses it.
alter table public.work_orders add column if not exists food_fee_pct text;
