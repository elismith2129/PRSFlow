-- Daily Ops check-offs: let the BILLING role write them (Eli, 2026-10-05).
--
-- "Accountability and following up with runners that fail to submit work
-- orders is imperative. I'm going to make it the role of the billing
-- coordinator." The Daily Ops cards now carry a red "WO not submitted" badge
-- and a plain check on every missed duty; a check is one row in
-- daily_ops_reviews (date + item_key + who). The insert/delete policies from
-- 20260814160000 allow owner / manager / asst_manager only — billing was left
-- out because in August the page was the studio manager's alone. Without this
-- the Billing Coordinator's tap fails with a red "NOT saved" toast.
--
-- Nothing else changes: SELECT stays any-authenticated, there is still no
-- UPDATE policy (a check is made or removed, never edited), and tech / runner
-- still cannot write.
--
-- Idempotent. Run by hand in the Supabase SQL editor.

drop policy if exists dor_ins on daily_ops_reviews;
create policy dor_ins on daily_ops_reviews
  for insert to authenticated
  with check (get_my_role() in ('owner','manager','billing','asst_manager'));

drop policy if exists dor_del on daily_ops_reviews;
create policy dor_del on daily_ops_reviews
  for delete to authenticated
  using (get_my_role() in ('owner','manager','billing','asst_manager'));

-- Proof it ran: both rows should list 'billing'.
select policyname, cmd, coalesce(with_check, qual) as rule
  from pg_policies
 where tablename = 'daily_ops_reviews'
 order by policyname;
