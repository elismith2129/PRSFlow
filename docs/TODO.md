# PRSFlo — To-do (standing list)

*One list, kept current. Session notes in PROJECT_LOG.md say what happened; this
says what's still owed. Add when something is parked, strike when it ships
(move it to the CHANGELOG), and date every line so stale items are obvious.
Newest at the top of each group.*

## Eli's hands (settings, SQL, data — not code)

- [ ] **Hand Cris Martinez his PIN** (from `set-pins.mjs --only`). *(Sep 18)*

- [ ] **Vercel: turn off Observability Plus** — Settings → Billing → Observability Plus → toggle off. It was on by default and is the $9.88 "Observability Events" line; the free tier covers everything we use. *(Sep 17)*
- [ ] **Roomless holds:** WO-1161 / WO-1160 / WO-1132 — set the studio or Close; **WO-1131** is the Havelange duplicate — Delete WO from the billing hub ⋯ menu. *(Sep 16)*
- [ ] **Send the runner update memo** (`docs/staff/runner-update-2026-09-15.html`) with the Email toggle on, now that memo email is live. *(Sep 15)*

## Infrastructure

- [ ] **TV walls: one shared probe instead of eleven.** Every panel polls its own `/display/<room>?probe=1` every 5 s with a cache-buster — 11 panels ≈ 190k function calls/day, and that's the Sep 8 step in the Vercel bill (invocations, CPU, memory). Fix: a single `/display/version` hash all panels hit, `s-maxage=5` so the CDN answers once per 5 s for the building; any booking edit refreshes every panel (harmless). **The catch, and why it's parked:** the panels reach Vercel through the WordPress proxy, which only forwards the `/display/<room>` paths — so a new path means touching the proxy and re-entering the URL on 11 signage panels, which Eli does by hand: "updating the TV URLs is such a bitch." Do it the next time the panels have to be touched anyway. Until then the cost is a few dollars a month. *(Sep 17)*
- [ ] **Flo cron JSON** — the 8:50 briefing cron's schedule file. *(Sep 16)*

## Features parked

- [ ] **Hiring part 2 — the letters:** offer letter + job description form on the case (title, effective date, pay, hours/week, vacation with the prorate shown), send via Resend, sign at `/sign/<token>` (typed name + intent box), PDF to `hr-documents`, Documents rows tick themselves. JD seeds: Asst. Manager and Billing Coordinator from the real docs; Studio Manager drafted from Asst. Manager (no paper JD exists). *(Sep 21)*
- [ ] **Hiring: one-tap case actions** — "role changed in PRSFlo" and "deactivate + void PIN + reassign" call the real thing instead of being ticks. *(Sep 21)*

- [x] ~~Per-day status + TBD buttons on the WO~~ — shipped v1.35.1 / v1.36.0–v1.36.2. *(Sep 19)*

- [ ] **Tenants out of the billing hub** — its own page/rail entry, separate from regular billing (Eli, Sep 18). Today: a third view inside `app/(main)/billing/page.tsx` (`TenantsView`, `lib/tenants.ts`, roster is code). Next chat. *(Sep 18)*

- [ ] **Unsubmitted WOs, later layers:** a push to the closer at the booked end time ("Havelange is done — submit the work order"), and a 9:05 AM email to the office. Both are one call on `lib/unsubmitted.fetchUnsubmittedSessions`; waiting on push (below) and the cron. Also possible: an "Unsubmitted" filter chip in the billing hub if the row flag isn't enough. *(Sep 17)*
- [ ] **Push notifications for the notes room** — a mention, a task assigned to you, a memo. The second half of "you asked for Slack." *(Sep 15)*
- [ ] **Office-side mention badge on the rail** — the office gets tagged from runner notes but has no "you were mentioned" signal outside the room. *(Sep 15)*
- [ ] **Admin stock-list editor** — runners can't add items anymore (they file "Missing an item?" to the dev bin); the office edits stock lists in SQL until this exists. *(Sep 15)*

## Small / maybe

- [ ] **Phone day card / synopsis for per-day status:** the phone grid keeps separate chips per status (no spine); the tap synopsis could list the days with their status. *(Sep 19)*

- [ ] **Old "just a name" sessions:** a one-time dashboard list of work orders with a client name but no profile, so they can be put on file in one sitting (the WO card already offers "Put on file →" one at a time). *(Sep 18)*

- [ ] Drop the − / + from the WO day-date chip if Eli finds it too much; keep the picker. *(Sep 16)*
- [ ] Runner WO page studio-time scroll cap (~5 days visible, Eli wants ~8). *(Aug)*
