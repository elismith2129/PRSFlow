-- BLANKET OT BY THE HOUR (Eli, 2026-11-05; docs/design-refs/blanket-ot-options.html).
-- "15K for the day. It includes all these rooms. If they go overtime, you just put
-- in the overtime and it calculates it just like a regular single day."
-- A blanket day can now carry an OT RATE and the HOURS THE PRICE COVERS. OT hours
-- = booked hours − covered (or a typed override); ot_amount is still written as
-- the resulting dollars, so allocation, billing and the PDF keep reading it.
-- A blanket with no ot_rate behaves exactly as before (typed ot_amount).
-- Idempotent.

alter table public.wo_rate_bundles
  add column if not exists ot_rate numeric check (ot_rate is null or ot_rate >= 0),
  add column if not exists covered_hours numeric check (covered_hours is null or covered_hours >= 0),
  add column if not exists ot_hours_override numeric check (ot_hours_override is null or ot_hours_override >= 0);

comment on column public.wo_rate_bundles.ot_rate is 'Blanket OT $/hr. When set, ot_amount = OT hours × ot_rate (written on save).';
comment on column public.wo_rate_bundles.covered_hours is 'Hours the day price covers (null = 12).';
comment on column public.wo_rate_bundles.ot_hours_override is 'Typed OT hours; null = auto (booked hours − covered_hours).';

select count(*) as blanket_days from public.wo_rate_bundles;
