-- Petty cash closing count (ERS runner report, 2026-09-15).
-- The ledger computes the closing balance; the closer now also types what is
-- actually in the box. Both live on the day's balance row so the daily-ops
-- modal shows "computed vs counted" and the difference, if any.
alter table petty_cash_balances add column if not exists counted_close numeric(10,2);
