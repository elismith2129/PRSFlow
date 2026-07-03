-- ===========================================================================
-- Drop the anon INSERT policy on leads.
--
-- ⚠️ RUN THIS ONLY AFTER the inquiry server route + page are LIVE on production
-- (i.e. after Vercel finishes deploying commit b780463). Web Inquiry leads are
-- now created exclusively by the service-role route POST /api/inquiry (which
-- per-IP rate-limits 3/min). Dropping this policy removes the browser's direct
-- anon insert path so the rate limit can't be bypassed.
--
-- If you run this BEFORE the deploy completes, the public inquiry form will fail
-- to submit during the gap (the old page still inserts client-side as anon).
--
-- After this runs, the leads table has NO anon access at all.
-- ===========================================================================

DROP POLICY IF EXISTS leads_ins_anon ON leads;
