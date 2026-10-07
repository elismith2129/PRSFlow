# PRSFlo — To-do (standing list)

*One list, kept current. Session notes in PROJECT_LOG.md say what happened; this
says what's still owed. Add when something is parked, strike when it ships
(move it to the CHANGELOG), and date every line so stale items are obvious.
Newest at the top of each group.*

## Parked from Remove hold (Oct 7)

- [ ] **Remove hold is desktop only** - hidden on the phone layout, like the block Delete. Say so if holds need dropping from a phone. *(Oct 7)*
- [ ] **Recovering a removed day does not check the room is still free.** A day is often removed so someone else can have it, and the entry stays recoverable. Same for a whole hold. *(Oct 7)*
- [ ] **A lead that became a hold stays "booked"** after the hold is removed (pre-existing: the hub Delete does the same). *(Oct 7)*
- [ ] **The Billing SOP rebuild must cover** Remove hold, the Removed holds tab, and the approval strip on every tab. *(Oct 7)*

## Eli's hands (settings, SQL, data — not code)

- [ ] **Run `20261007120000_remove_hold.sql` BEFORE the v1.43.7 push** - Remove hold and the Removed holds tab call it; the hub's own Delete is replaced by it too. Needs the Oct 5 and Oct 6 files run first. *(Oct 7)*
- [ ] **Try Remove hold on a throwaway hold** (Testing → the Oct 5 batch, the four "hold" items). The SQL has only run on a local copy with a made-up schema, never against the live tables. *(Oct 7)*
- [ ] **Run `20261006120000_st_rows_submitted_for_runner.sql` BEFORE the v1.43.6 push** - Mark reviewed's rescue and Cancel's restore both name the new column; it also replaces `recover_deleted_work_order`. *(Oct 6)*
- [ ] **Can Lori pull an invoice back?** The repo's `enforce_invoice_approver` lets only an owner change the approval stamps, which Pull it back does. If that is what is live, Pull it back is owners-only in practice (it now fails cleanly and says so). Decide: leave it, or let billing clear an approval. *(Oct 6)*
- [ ] **Run `20261005190000_st_rows_no_show.sql` BEFORE the No show push** - every work order save sends the new column and fails without it. *(Oct 5)*
- [ ] **Confirm WO-1240 is back** (Epic / Molly Santana, Ameraycan B, Sep 23–29) in the billing hub and on the calendar — restored from the Oct 2 backup with `restore-WO-1240.sql`. **Bill Oct 3 once:** QuickBooks invoice 34828 lists it, and that night now lives on the newer October work order. *(Oct 5)*
- [ ] **Test delete → recover on a throwaway work order** as Lori or Fernando (Testing → the Oct 5 batch, last four items). The SQL was only ever run against a copy of the Oct 2 backup. *(Oct 5)*
- [x] ~~Run `20261005180000_deleted_work_orders.sql`~~ — Eli confirmed at wrap-up Oct 5; the code that depends on it is on `main`. *(Oct 5)*
- [x] ~~Run `20261005120000_daily_ops_reviews_billing.sql`~~ — ran Oct 5; `dor_ins` and `dor_del` both list `billing` (Eli's screenshot of pg_policies). The Billing role can check items off on Daily Ops. *(Oct 5)*

- [ ] **Run** `20261001150000_lakers_games.sql` before the v1.42.0 push. When the Lakers drop the 26–27 schedule: Admin → Lakers → 26–27 → Paste schedule. *(Oct 1)*

- [ ] **Run the SRS migrations** `20261001120000_srs_payouts.sql`, `…130000_srs_backfill_wo_flag.sql`, `…140000_srs_history.sql`. *(Oct 1)*
- [ ] **SRS on a lease** (AG Cook was 10% of a $5,000/mo lockout) isn't modelled — build a % on the lease if it ever comes back. *(Oct 1)*

- [ ] **Hand Cris Martinez his PIN** (from `set-pins.mjs --only`). *(Sep 18)*

- [ ] **Vercel: turn off Observability Plus** — Settings → Billing → Observability Plus → toggle off. It was on by default and is the $9.88 "Observability Events" line; the free tier covers everything we use. *(Sep 17)*
- [x] ~~Tenant cleanup SQL (v1.40.0)~~ — ran Sep 28: Camper's three lockouts are `tenant` blocks with no WO, Mustard's 61 rows at $0 room. MBA's calendar block is Eli's to add (status Tenant, Track South, from Sep 16). *(Sep 28)*
- [ ] **Roomless holds:** WO-1161 / WO-1160 / WO-1132 — set the studio or Close; **WO-1131** is the Havelange duplicate — Delete WO from the billing hub ⋯ menu. *(Sep 16)*
- [ ] **Send the runner update memo** (`docs/staff/runner-update-2026-09-15.html`) with the Email toggle on, now that memo email is live. *(Sep 15)*

## Infrastructure

- [ ] **TV walls: one shared probe instead of eleven.** *(Oct 6: `POLL_MS` 5s → 15s as a stopgap - usage was $16.38 in ten days, ~240k calls/day. Check the next Vercel export: calls should sit near 80k/day. Still open: the shared probe, and/or remembering the probe answer in memory for a few seconds.)* Every panel polls its own `/display/<room>?probe=1` every 5 s with a cache-buster — 11 panels ≈ 190k function calls/day, and that's the Sep 8 step in the Vercel bill (invocations, CPU, memory). Fix: a single `/display/version` hash all panels hit, `s-maxage=5` so the CDN answers once per 5 s for the building; any booking edit refreshes every panel (harmless). **The catch, and why it's parked:** the panels reach Vercel through the WordPress proxy, which only forwards the `/display/<room>` paths — so a new path means touching the proxy and re-entering the URL on 11 signage panels, which Eli does by hand: "updating the TV URLs is such a bitch." Do it the next time the panels have to be touched anyway. Until then the cost is a few dollars a month. *(Sep 17)*
- [ ] **Flo cron JSON** — the 8:50 briefing cron's schedule file. *(Sep 16)*

## Features parked

- [ ] **Hiring part 2 — the letters:** offer letter + job description form on the case (title, effective date, pay, hours/week, vacation with the prorate shown), send via Resend, sign at `/sign/<token>` (typed name + intent box), PDF to `hr-documents`, Documents rows tick themselves. JD seeds: Asst. Manager and Billing Coordinator from the real docs; Studio Manager drafted from Asst. Manager (no paper JD exists). *(Sep 21)*
- [ ] **Hiring: one-tap case actions** — "role changed in PRSFlo" and "deactivate + void PIN + reassign" call the real thing instead of being ticks. *(Sep 21)*
- [ ] **Positions → profiles:** the "role and position changed in PRSFlo" step should set `user_profiles.role` + `position_title` from the case's position in one tap; until then set the position on the profile by hand (SQL) so the next promotion knows whether they already supervise. Also: a way to set `position_title` for everyone currently on staff (one-time). *(Sep 21)*
- [ ] **Studio Manager JD** is a draft written from the Asst. Manager JD + PRG-P01 — Eli to read it on Admin → Positions and mark Final. *(Sep 21)*

- [x] ~~Per-day status + TBD buttons on the WO~~ — shipped v1.35.1 / v1.36.0–v1.36.2. *(Sep 19)*

- [x] ~~Tenants out of the billing hub~~ — ruled the other way Sep 28: stays a tab. Rework shipped v1.40.0 (leases table, ledger, `tenant` booking status). *(Sep 28)*
- [ ] **Tenants follow-ups:** drop `tenant_rent_months.room_id` once old stamps don't matter; the 25th/10th rent email as a cron off `leases.anchor_day`; real start dates on the seeded leases (placeholder 2025-01-01). *(Sep 28)*

- [ ] **Unsubmitted WOs, later layers:** a push to the closer at the booked end time ("Havelange is done — submit the work order"), and a 9:05 AM email to the office. Both are one call on `lib/unsubmitted.fetchUnsubmittedSessions`; waiting on push (below) and the cron. Also possible: an "Unsubmitted" filter chip in the billing hub if the row flag isn't enough. *(Sep 17)*
- [ ] **Push notifications for the notes room** — a mention, a task assigned to you, a memo. The second half of "you asked for Slack." *(Sep 15)*
- [ ] **Office-side mention badge on the rail** — the office gets tagged from runner notes but has no "you were mentioned" signal outside the room. *(Sep 15)*
- [ ] **Admin stock-list editor** — runners can't add items anymore (they file "Missing an item?" to the dev bin); the office edits stock lists in SQL until this exists. *(Sep 15)*

- [ ] **Billing hub Mark paid takes a date** — same as the Tenants tab now does: a small pop-up, date received, defaults to today. Today it stamps "now". COD is fine (its payment rows carry their own date). *(Sep 28)*

- [ ] **Texting: the sending side** — provider (Twilio/etc.), 10DLC brand + campaign registration (needs a public privacy-policy URL on the website), STOP/HELP webhook → `sms_consent_log` source `sms`, quiet hours 8am–9pm. The list and consent record exist (v1.40.1). *(Sep 29)*

- [ ] **"Delete day" leaves no trace if the WO is closed without saving** — the rows go at once, the history entry is only written on save. Either log it at the moment of delete or stage it until save. Same family as WO-1240. *(Oct 5)*
- [ ] **Two routines in WorkOrderPopup delete rows by themselves** — the "live date range sync" effect (looks dead) and the day-rate "dedup by date" reconcile. Read both, remove or log. *(Oct 5)*
- [ ] **Billing hub line-item loads are unpaginated** (`fetchInvoices`: studio time, rentals, payments, expenses `.in(ids)`) — they will meet the 1,000-row cap and under-total quietly. Paginate like Top clients does. *(Oct 5)*
- [ ] **Tighten RLS so nothing but `delete_with_archive()` can delete a work order or a card** — check how `save_work_order_atomic` removes projection cards first. Today the guarantee is the code path only. *(Oct 5)*
- [ ] **Assistant managers can no longer delete a Tour / Tech block** (the RPC is owner / manager / billing). Add `asst_manager` for blocks only if Sam or Isaac need it. *(Oct 5)*
- [ ] `lib/dailyOps.loadNight` still builds the "Needs you" queue nobody renders — remove once the new page has had a week. *(Oct 5)*

- [ ] **Rewrite the other manuals the same way as Billing (v1.43.5):** Runner app guide, Studio Manager SOP, Owner's page, and the older CRM / Clients / Tasks / Flags sections of the main SOP. Facts from the code, then an independent fact-check pass. *(Oct 6)*
- [x] ~~Found writing the Billing SOP: Mark reviewed lost its submit-in-your-name; COLLECT ignored food~~ - fixed v1.43.6. *(Oct 6)*
- [x] ~~Seven more gaps from the SOP fact-check (wrong-row drops, package-window edits lost, paid stamp after Pull it back, Flo counting closed COD, COD "Built, not sent", Reopen, Cancel on a deleted day)~~ - each verified in code, then fixed v1.43.6. *(Oct 6)*

- [ ] **Seed reloads every day from the database** and drops unsaved edits to existing days; the x on a room's staff line clears it in the database at once and Cancel does not restore it. Both noted by the v1.43.6 review, not fixed. *(Oct 6)*
- [ ] **The runner's Submit never clears `submitted_for_runner`** - only matters if a runner submits from a stale phone after an office rescue. Add `submitted_for_runner: false` to `handleRunnerSubmit`'s stamp once the column has been live a while. *(Oct 6)*

## Small / maybe

- [ ] Delete Admin's dead SRS Log section (`app/(main)/admin/page.tsx`) and, once nothing writes it, `srs_log`. Ask Eli whether a WO discount should reduce the SRS fee (today it doesn't). *(Oct 1)*

- [ ] **Phone day card / synopsis for per-day status:** the phone grid keeps separate chips per status (no spine); the tap synopsis could list the days with their status. *(Sep 19)*

- [ ] **Old "just a name" sessions:** a one-time dashboard list of work orders with a client name but no profile, so they can be put on file in one sitting (the WO card already offers "Put on file →" one at a time). *(Sep 18)*

- [ ] Drop the − / + from the WO day-date chip if Eli finds it too much; keep the picker. *(Sep 16)*
- [ ] Runner WO page studio-time scroll cap (~5 days visible, Eli wants ~8). *(Aug)*
