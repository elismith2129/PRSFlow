// ─────────────────────────────────────────────────────────────────────────────
// Test batches for DEV → Testing.
//
// Batches live HERE, in code, not in the database. That's deliberate: a batch is
// written in the same commit as the work it covers, so the checklist and the
// feature can never drift apart, and adding a batch needs no migration and no SQL.
// Only the pass/fail verdicts are data (table `test_results`).
//
// Batches are BATCHES, not one growing list — each one pairs with a release and
// gets worked through once. Newest first.
//
// Writing items: `what` is the outcome being checked, `how` is the exact steps.
// Assume the tester has never seen the feature and is reading this on a phone.
// One check per item — if an item needs "and also", split it.
// ─────────────────────────────────────────────────────────────────────────────

export type TestItem = {
  // Stable within the batch — this is half of the results key, so DON'T rename an
  // id once testing has started or its verdict is orphaned.
  id: string
  area: string
  what: string
  how: string
  // Which screen the tester performs this on. Runner work happens on a PHONE while
  // the checklist stays open on a computer, so an item needs to say which device it
  // belongs to or the tester is guessing. Optional: falls back to the area name,
  // which covers every current item without 40 duplicate declarations.
  device?: 'phone' | 'desktop'
}

// Runner areas are phone work; everything else is done at the computer.
export function deviceFor(item: TestItem): 'phone' | 'desktop' {
  return item.device ?? (item.area.startsWith('Runner') ? 'phone' : 'desktop')
}

// Does this batch need a phone? Drives the prominent setup callout — a tester who
// gets halfway down a batch before discovering they need the app on their phone
// has already wasted the trip.
export function batchNeedsPhone(batch: TestBatch): boolean {
  return batch.items.some(i => deviceFor(i) === 'phone')
}

export function phoneItemCount(batch: TestBatch): number {
  return batch.items.filter(i => deviceFor(i) === 'phone').length
}

export type TestBatch = {
  id: string
  title: string
  version: string
  date: string
  intro: string
  items: TestItem[]
}

export const TEST_BATCHES: TestBatch[] = [
  {
    id: 'sep-3-2026-billing',
    title: 'Billing badges, the button ladder, and the late PO',
    version: 'v1.22.0',
    date: 'Sep 3, 2026',
    intro:
      'The billing list now wears COD-style stage badges (the three dots are gone), rows carry at most one of four buttons, POs added after approval happen in a strip under the row, and future sessions moved to a Not started tab. Everything here is on the desktop Billing page; two items need an owner login. The COD side should look completely unchanged — that is itself a check.',
    items: [
      {
        id: 'v122-badges', area: 'Billing', device: 'desktop',
        what: 'Every billing row leads with a colored stage badge and the Reviewed/Invoiced/Approved dots are gone',
        how: 'Open Billing → In progress. Each row starts with one badge — Needs review, Needs invoice, Needs approval, Awaiting PO (light blue), Approved (green), or Not approved (red). Nowhere on the billing side should you still see the three little progress dots. Check both dark and light themes.',
      },
      {
        id: 'v122-buttons', area: 'Billing', device: 'desktop',
        what: 'Row buttons are only ever Add PO, Download, Mark sent, or Mark paid — and none are green or greyed',
        how: 'Scan the In progress and Awaiting payment tabs. No row shows "Attach invoice", "Approve", or "Send for approval" as its button, no button is filled green, and no button sits greyed-out/disabled. Rows that have nothing actionable show no button at all.',
      },
      {
        id: 'v122-attach-click', area: 'Billing', device: 'desktop',
        what: 'Clicking "Drop invoice here · or click" opens the file picker and attaches',
        how: 'Find a Needs invoice row. Click the "Drop invoice here · or click" text (not the row around it). A file picker opens; choose a PDF. The row should flip to Needs approval without opening the work order behind it.',
      },
      {
        id: 'v122-notstarted-tab', area: 'Billing', device: 'desktop',
        what: 'Future sessions live in the Not started tab, not In progress',
        how: 'In progress should contain no session whose first day is after today (the Mustard/DJ Camper monthlies covering today still count as started). Click the Not started tab: only future sessions, soonest first, each wearing a dimmed blue Not started badge.',
      },
      {
        id: 'v122-sort', area: 'Billing', device: 'desktop',
        what: 'Header click sorts, second click reverses, third returns to date order — and day headers only show in date order',
        how: 'On In progress, click the Balance header: biggest balance first, ▼ beside Balance, and the little day headers (like "Wed, Sep 3") disappear. Click Balance again: smallest first, ▲. Click a third time: back to date order with the day headers back.',
      },
      {
        id: 'v122-pagesize', area: 'Billing', device: 'desktop',
        what: 'Lists page at 15 rows',
        how: 'On any billing tab with more than 15 rows, the pager at the bottom should read "1–15 of …". (If no tab has 16+ rows, check the count on In progress + Not started combined and mark this pass if neither pages early.)',
      },
      {
        id: 'v122-addpo', area: 'Billing', device: 'desktop',
        what: 'Add PO on an approved row runs the whole flow in a strip under the row',
        how: 'Find an approved row with the light-blue Awaiting PO badge (its button says Add PO). Press it: a strip unfolds under the row with a PO number field and an invoice drop. Type a PO, choose a replacement PDF, press Save & download. The package downloads, the badge becomes Approved, and the button now says Mark sent. Open the work order: the PO number is on it.',
      },
      {
        id: 'v122-addpo-noapproval', area: 'Billing', device: 'desktop',
        what: 'Adding a PO does NOT send the row back for approval',
        how: 'After the previous item, confirm the row did not return to Needs approval and it does not appear in the "Ready for your approval" strip. The approval date on the package window header is unchanged.',
      },
      {
        id: 'v122-drift-guard', area: 'Billing', device: 'desktop',
        what: 'Editing money after approval demotes the row — and attaching a new PDF does NOT sneak it back to Approved',
        how: 'Open an approved work order, change a rate, save. The row should drop to Needs approval with the red "Changed since invoiced" flag. Now drop a new PDF on that row. It must STAY at Needs approval (this used to silently re-approve). Owner then approves from the strip to restore it — which also clears the drift flag.',
      },
      {
        id: 'v122-requeue', area: 'Billing', device: 'desktop',
        what: 'A Not approved row goes back to the owner when the corrected invoice is dropped on it',
        how: 'OWNER: open a Needs approval row\'s package and press "Don\'t approve…" with a note. The row turns red Not approved with no button. Now drop any PDF onto that row: the badge returns to Needs approval and the row reappears in the "Ready for your approval" strip.',
      },
      {
        id: 'v122-assent-frozen', area: 'Billing', device: 'desktop',
        what: 'A sent package always re-opens exactly as it went out, even after edits',
        how: 'On a row in Awaiting payment (already sent), open it and look at the "As sent" tab — note the total on the PDF. Close, open the work order, change a rate, save. Re-open the row\'s "As sent" tab: the PDF still shows the ORIGINAL figures, not the edit.',
      },
      {
        id: 'v122-cod-unchanged', area: 'COD', device: 'desktop',
        what: 'The COD side is completely untouched',
        how: 'Switch to COD. The latching tabs, the bin badges when 2+ tabs are on, the three progress dots on rows, and the Approve buttons on paid+reviewed rows all still look and work exactly as before.',
      },
    ],
  },
  {
    id: 'sep-3-2026',
    title: 'Tenants, the Mustard exception, and the stale-page fixes',
    version: 'v1.21.0',
    date: 'Sep 3, 2026',
    intro:
      'A new Tenants section in Billing, lockouts as the designated exception on work orders, a save gate on confirming, and fixes for two bugs where the screen appeared to lose work. Billing items need an owner or billing login; runner items need the phone. The Mustard month sheet only shows numbers once his runner hours are typed on his lockout WO — check the empty state honestly if they are not in yet.',
    items: [
      {
        id: 'v121-ten-tab', area: 'Tenants', device: 'desktop',
        what: 'Tenants is the third word in the Billing heading and lists every monthly room',
        how: 'Open Billing. Beside "Billing" and "COD" there is "Tenants" — click it. You should see a month at the top and every tenant room grouped by venue: Paramount (Studio D empty, Studio F, Treehouse), Ameraycan (Studio C), Track (PR1 empty, PR2, PR3, North), Encore (Studio B). Empty rooms show a dashed outline and the word "empty".',
      },
      {
        id: 'v121-ten-ladder', area: 'Tenants', device: 'desktop',
        what: 'A row moves Mark sent → Mark paid → In QB, one button at a time',
        how: 'On any tenant row press "Mark sent". The chip becomes "Open" and the button becomes "Mark paid". Press that — the chip becomes "Paid" with today\'s date and the button becomes "In QB". Press that — the chip reads "In QB" with the date and there is no button left.',
      },
      {
        id: 'v121-ten-undo', area: 'Tenants', device: 'desktop',
        what: 'The ↩ arrow undoes the last stamp only',
        how: 'On a row you just marked "In QB", press the small ↩ next to the chip. It should drop back to "Paid" (not all the way to Not sent). Press ↩ again — back to "Open". Refresh the page and the state you left it in is still there.',
      },
      {
        id: 'v121-ten-figures', area: 'Tenants', device: 'desktop',
        what: 'The four figures at the top agree with the rows underneath',
        how: 'Note "Collected" before marking a row paid, then mark one paid. Collected should increase by exactly that room\'s rent and "Still open" should drop by the same amount. "Rooms occupied" should read 7 / 9.',
      },
      {
        id: 'v121-mus-sheet', area: 'Tenants', device: 'desktop',
        what: 'The Mustard month sheet opens and shows the day-by-day split',
        how: 'On the Encore Studio B row, the incidentals sub-line says "Month sheet →". Click it. You get four figures (Runner hrs, Solo, Shared, Billable) and one row per day showing his runner times, the ERS·A session times, and the solo/shared hours for that day. Billable should equal solo + half of shared.',
      },
      {
        id: 'v121-mus-gap', area: 'Tenants', device: 'desktop',
        what: 'A day with ERS·A sessions but no runner hours shows as a dashed empty row',
        how: 'In the month sheet, look for any day where Encore A ran but nothing was typed on Mustard\'s work order. It must render with a dashed outline and the words "no hours on Mustard\'s WO" — never as a 0. If every day has hours, skip this item.',
      },
      {
        id: 'v121-lock-banner', area: 'Work orders', device: 'phone',
        what: 'A lockout work order shows NO missing-times banner',
        how: 'On the phone, open Mustard\'s work order (WO-1083) from the Encore runner hub. There must be no red "rows are missing times" bar at the top, even though most days have no times yet.',
      },
      {
        id: 'v121-lock-hub', area: 'Runner hub', device: 'phone',
        what: 'A lockout session appears on the runner hub',
        how: 'On the phone, open the Encore studio hub on a day Mustard\'s lockout covers. His session card should be listed with the other sessions so the runner can open the WO and type the day\'s hours.',
      },
      {
        id: 'v121-confirm-gate', area: 'Work orders', device: 'desktop',
        what: 'A Confirmed work order will not save while a day is missing times',
        how: 'Open any normal (non-lockout) work order, clear the From time on one dated studio day, make sure the status is CONFIRMED, and press Save. It must refuse, name the day, and highlight that row. Now switch the status to TENTATIVE and press Save — it saves.',
      },
      {
        id: 'v121-banner-cap', area: 'Work orders', device: 'phone',
        what: 'The missing-times banner never lists more than four days',
        how: 'On a long session with several blank days, the red banner should name at most four of them and then say "+ N more" rather than filling the screen.',
      },
      {
        id: 'v121-status-pills', area: 'Work orders', device: 'desktop',
        what: 'All seven session-status buttons fit on one line',
        how: 'Open any work order on a laptop. The status row must show CONFIRMED · TENTATIVE · CANCELLED · TOUR · TECH · OPEN HRS · LOCKOUT all at once, on one line, with none cut off and no sideways scrolling. Check it in a narrow window too.',
      },
      {
        id: 'v121-monthly-staff', area: 'Work orders', device: 'desktop',
        what: 'The monthly lockout modal has its own Staff choice',
        how: 'Open a work order, start the Monthly split panel. Under the times there is a Staff row with "No staff" and "Assistant". Pick No staff and apply to a fresh date range — the created days must have no staff line at all. Pick Assistant instead and each created day gets a 2ND line with an empty name.',
      },
      {
        id: 'v121-myday-keep', area: 'My Day', device: 'desktop',
        what: 'Duty checkboxes survive leaving the page and coming back',
        how: 'Tick two or three duties on My Day. Go to the calendar, wait a few seconds, come back. They must still be ticked. Lock the laptop for ten minutes and come back — still ticked, and no red "not saved" toast.',
      },
      {
        id: 'v121-mics-fresh', area: 'Runner mics', device: 'phone',
        what: 'Another person\'s mic submission appears without force-quitting',
        how: 'Have someone submit mic inventory for a studio while you have that studio\'s mics page open (or open on another phone). Switch away from the app and back. Their submission should be showing — no need to close and reopen the app repeatedly.',
      },
      {
        id: 'v121-runner-home', area: 'Runner hub', device: 'phone',
        what: 'The app always opens on the studio picker',
        how: 'Open a studio, then fully close the runner app and reopen it. It must land on the "Where are you tonight?" picker every time — never jump straight into the studio you used last.',
      },
      {
        id: 'v121-runner-register', area: 'Runner hub', device: 'phone',
        what: 'Punch, guide, manual and report-a-bug are on the first screen',
        how: 'On the runner home page, scroll down. "Missed a punch?", "App guide", "Runners manual" and "Report a bug or an idea" are all there, plus Runner notes with a studio tab row (PRS / ARS / ERS / TRS) that starts with none selected.',
      },
      {
        id: 'v121-mics-soon', area: 'Runner hub', device: 'phone',
        what: 'Mic inventory is greyed out and says Coming soon',
        how: 'On a studio hub, the Mic inventory tile should be dimmed, read "Coming soon" instead of "Not started", and do nothing when tapped. The other four tiles work normally.',
      },
      {
        id: 'v121-petty-same', area: 'Petty cash', device: 'phone',
        what: '"Counted — no change" records the count',
        how: 'Open petty cash for a studio and type nothing. Above Save there is a "Counted — no change" button — tap it. It should record and return you to the hub, and the studio\'s petty cash should show as done for the night on the office side.',
      },
      {
        id: 'v121-receipt-thumb', area: 'Work orders', device: 'phone',
        what: 'A receipt photo becomes a thumbnail on the expense line',
        how: 'On a work order with a food budget, add an expense and attach a receipt photo. The camera button on that line should turn into a small picture of the receipt with a teal ring. Tap it to see the full photo.',
      },
      {
        id: 'v121-notes-popover', area: 'Work orders', device: 'desktop',
        what: 'The session-notes popover is solid, not see-through',
        how: 'In the work order\'s Studio Time list view, click a Session Info cell. The little notes panel that opens must be a solid card — you should not be able to read the table rows through it.',
      },
      {
        id: 'v121-daysheet-footer', area: 'Work orders', device: 'phone',
        what: 'The day sheet\'s Cancel / Save buttons are fully visible',
        how: 'On the phone, open a work order and tap a day card to open the day sheet. Scroll to the bottom — the Cancel and Save buttons must sit fully above the home indicator, not clipped by the bottom edge.',
      },
    ],
  },
  {
    id: 'sep-1-2026',
    title: 'WO history, the approvals queue, the runner notes channel, actual vs billed',
    version: 'v1.20.0',
    date: 'Sep 1, 2026',
    intro:
      'One big session: work-order history, the owner approvals queue (billing AND COD), the runner notes channel on the studio hub, actual-vs-billed times, and the Daily Ops Opener/Closer split. Owner items need an owner login; runner items need the phone. Several checks are about what must NOT change — read those twice.',
    items: [
      {
        id: 'v120-appr-badge', area: 'Billing approvals', device: 'desktop',
        what: 'Owners see a green count on Billing in the side menu',
        how: 'Sign in as an owner with at least one invoice attached but not yet approved. The Billing item in the left menu shows a small green number. Sign in as Fernando or an assistant manager — no green number for them.',
      },
      {
        id: 'v120-appr-banner', area: 'Billing approvals', device: 'desktop',
        what: 'The dashboard banner counts the same invoices and opens Billing',
        how: 'As an owner, open the dashboard. A banner reads "Invoices ready for approval" with the same count as the menu badge and a dollar total. Click it — you land on Billing.',
      },
      {
        id: 'v120-appr-strip', area: 'Billing approvals', device: 'desktop',
        what: 'The approval strip approves in one tap and everything counts down together',
        how: 'On Billing, the "Ready for your approval" list sits above the rows. Press Approve on one. It leaves the strip, the menu badge and dashboard banner both drop by one, and the row\'s third light turns on.',
      },
      {
        id: 'v120-cod-approve', area: 'Billing approvals', device: 'desktop',
        what: 'A paid, reviewed COD session still asks for owner approval',
        how: 'Switch to COD. A session that is paid with an invoice attached shows three lights (Approved unlit) and an Approve button in the Paid bin. Approve it — the button disappears and the third light turns on.',
      },
      {
        id: 'v120-hist-entry', area: 'WO history', device: 'desktop',
        what: 'A saved change appears in History with your name and both values',
        how: 'Open any work order, change a rate or a time, Save. Press the ⟲ HISTORY button top-right. The newest entry shows your name, the time, and the change as "old → new".',
      },
      {
        id: 'v120-hist-original', area: 'WO history', device: 'desktop',
        what: 'A new session\'s History holds the Original card and the compare view',
        how: 'Create a fresh booking, open its WO, then ⟲ History. The bottom card reads "Original" with the created details. Change a time, save, reopen History, press "Compare to now" — the changed line is tinted on both sides.',
      },
      {
        id: 'v120-hist-runner', area: 'WO history', device: 'desktop',
        what: 'Runner submits and admin reviews show up as their own entries',
        how: 'After a runner submits a day (or you toggle a day\'s review lock as admin), open that WO\'s History. You should see "Submitted the day" with an amber Runner chip, and "Reviewed the day" with the admin\'s name.',
      },
      {
        id: 'v120-midnight-submit', area: 'Runner WO', device: 'phone',
        what: 'Submitting after midnight still finds tonight\'s session',
        how: 'After midnight (before 8:50 AM), open tonight\'s work order on the runner phone. The button must read "Submit today" / "Update submission" and pressing it must mark tonight\'s rows — the footer must NOT say "No rows dated today".',
      },
      {
        id: 'v120-notes-channel', area: 'Runner notes', device: 'phone',
        what: 'The channel lives on the studio hub with all history, newest first',
        how: 'Open your studio\'s hub page and scroll down to Runner notes. Old shift notes appear as messages with names and times, newest at the top. There is no separate Shift notes tile anymore.',
      },
      {
        id: 'v120-notes-draft', area: 'Runner notes', device: 'phone',
        what: 'Typed text AND an attached photo survive leaving the app before Send',
        how: 'Type a few words, attach a photo with the 📷 button, wait for the thumbnail. Switch to another app, then come back. Words, photo and your shift chip are all still in the composer. Send — the note posts with the photo.',
      },
      {
        id: 'v120-notes-admin', area: 'Daily Ops', device: 'desktop',
        what: 'The office reads and posts into the channel from Daily Ops',
        how: 'Daily Ops → Runner notes at the bottom. Pick a studio tab — same messages as the phone. Post one; it appears with an "Office" badge, and shows up on the runner phone without a refresh.',
      },
      {
        id: 'v120-notes-night', area: 'Daily Ops', device: 'desktop',
        what: 'A post-midnight note files under the night it belongs to',
        how: 'In the sweep, open a studio\'s shift-notes popup for a given night. A note posted at 1–2 AM after that night\'s session should appear with THAT night, not the next day.',
      },
      {
        id: 'v120-actual-wells', area: 'Work order', device: 'desktop',
        what: 'Arrived/Left record without touching the money',
        how: 'Open a WO day sheet. Under the room\'s times, dashed "Client actually here" boxes. Type 12p and 8p, Save. The booked times, hours and charge must not change AT ALL. The day card now shows a quiet "Actually here 12:00 PM – 8:00 PM" line.',
      },
      {
        id: 'v120-actual-pdf', area: 'Work order', device: 'desktop',
        what: 'Actual times never appear on the client PDF',
        how: 'On that same WO press Save & download. Open the PDF: the times shown are the BOOKED times only — no arrived/left anywhere on the document.',
      },
      {
        id: 'v120-flags-name', area: 'Daily Ops', device: 'desktop',
        what: 'A new flag shows who raised it',
        how: 'Have a runner submit a checklist with Needs Attention (initials filled in). On Daily Ops, the flag\'s sub-line ends with those initials. Flags from before today show no name — that\'s expected.',
      },
      {
        id: 'v120-sweep-split', area: 'Daily Ops', device: 'desktop',
        what: 'Each studio card splits Opener / Closer with the right person on each',
        how: 'In the sweep, each card shows OPENER (Opening · Petty cash · Stock) then CLOSER (Closing · Petty cash · Mic inventory), with initials on each header from that shift\'s own submissions. Petty cash appears under both — one duty, both shifts touch the box.',
      },
      {
        id: 'v120-sheet-studio', area: 'Work order', device: 'desktop',
        what: 'The day sheet can change the room',
        how: 'Open a WO in card view, tap a day. The STUDIO heading is a dropdown — change PRS B to PRS A and Save. List view shows the same room, and History logs "Studio: PRS B → PRS A".',
      },
      {
        id: 'v120-asst-invoice', area: 'Billing approvals', device: 'desktop',
        what: 'An assistant manager can attach an invoice',
        how: 'Signed in as Sam or Isaac, drop a PDF onto a Needs-review COD row (or use Attach invoice). It attaches with no red "row-level security" error, and the row advances.',
      },
      {
        id: 'v120-sam-tasks', area: 'Tasks', device: 'desktop',
        what: 'The Asst Mgr tab belongs to Sam now and nothing vanished',
        how: 'Dashboard → Tasks → Asst Mgr tab. Tasks that were assigned to Quinn are still listed (now on Sam). Assign a new task to "Asst Mgr" — both Sam and Isaac can see it when signed in.',
      },
    ],
  },
  {
    id: 'aug-31-2026-second',
    title: 'Notes that survive, Billing Ops, the phone calendar, stock by location',
    version: 'v1.19.1',
    date: 'Aug 31, 2026',
    intro:
      'One session\'s worth of fixes, most of them from things people hit in real use this week. Four areas: My Day notes, billing approval, the runner stock list, and the calendar on a phone. The runner items need a phone; the billing items need an owner login.',
    items: [
      {
        id: 'v191-notes-survive', area: 'My Day notes', device: 'desktop',
        what: 'Unsubmitted notes survive leaving the page',
        how: 'My Day → Shift notes. Type a few lines and do NOT submit. Go to the Calendar, come back. Your text should still be there, and the line above the boxes should say "kept — safe to leave this page".',
      },
      {
        id: 'v191-notes-device', area: 'My Day notes', device: 'desktop',
        what: 'The unfinished note follows you to another device',
        how: 'With unsubmitted text on your computer, open My Day on your phone or iPad signed in as yourself. The same unfinished text should be waiting.',
      },
      {
        id: 'v191-notes-submit', area: 'My Day notes', device: 'desktop',
        what: 'Submit clears the boxes and they STAY clear',
        how: 'Submit your notes. The boxes empty and the post appears in the log. Now leave the page and come back — the boxes must still be empty. Text reappearing after a submit is the bug this checks for.',
      },
      {
        id: 'v191-approve-no-po', area: 'Billing', device: 'desktop',
        what: 'An invoice can be approved with no PO number',
        how: 'Sign in as an owner. Billing → find a billing (not COD) row at the Approve step whose work order has no PO and is not marked "Not req\'d" — it should show an "Awaiting PO" chip. Press Approve. It must go through.',
      },
      {
        id: 'v191-send-blocked-no-po', area: 'Billing', device: 'desktop',
        what: 'That same invoice still cannot be SENT without a PO',
        how: 'On the row you just approved, the button should now read Download and be greyed out, with a tooltip saying it needs a PO before it can be sent. Open the work order, type a PO number (or press Not req\'d), save, and the button should come alive.',
      },
      {
        id: 'v191-billing-ops-toggle', area: 'My Day', device: 'desktop',
        what: 'The card is called Billing Ops, and Fernando can open it',
        how: 'On /my-day the switch top-right should read your name and "Billing Ops" — not "Aaron". Have Fernando sign in and check he sees the same switch and can open the Billing Ops card.',
      },
      {
        id: 'v191-dailyops-today', area: 'Daily ops', device: 'desktop',
        what: 'Daily Ops pages forward to Today, and today is not all red',
        how: 'Daily Ops → press the › arrow past Yesterday. The heading should say "Today · still coming in". Duties not turned in yet should be grey dots reading "not yet", NOT red "never submitted" — and the Needs You queue should not fill with rows about tonight.',
      },
      {
        id: 'v191-track-dormant', area: 'Daily ops', device: 'desktop',
        what: 'Track is greyed out and raises no alarms',
        how: 'On the same page, the Track card should be dimmed and say "Long-term lease · not staffed", with grey duty dots. No Track rows should appear in Needs You.',
      },
      {
        id: 'v191-runner-report', area: 'Runner hub',
        what: 'You can report a bug or an idea from the hub',
        how: 'Runner → your studio. Near the bottom, past "App guide", tap "Report a bug or an idea". Pick Something broken or An idea, type a sentence, optionally add a photo, Submit. It should say Sent.',
      },
      {
        id: 'v191-runner-report-draft', area: 'Runner hub',
        what: 'A half-typed report is still there after you leave',
        how: 'Start a report, type a few words, do NOT submit. Leave the page (or lock the phone), come back to the hub. The card should be open with your text still in it.',
      },
      {
        id: 'v191-runner-report-office', area: 'DEV', device: 'desktop',
        what: 'The office sees it',
        how: 'On a computer go to DEV → Runner. The report you just sent should be listed with the studio, your name, the time, and the photo if you added one. Mark resolved and confirm it moves to the Resolved tab.',
      },
      {
        id: 'v191-stock-keypad', area: 'Runner stock',
        what: 'The number keypad opens for counts',
        how: 'Runner → Stock → PRS Stock. Tap any Qty box. The numeric keypad should appear straight away — not the letter keyboard. Check you can still switch to ABC and type a word like OK.',
      },
      {
        id: 'v191-stock-last-count', area: 'Runner stock',
        what: 'The previous day\'s count shows next to the box',
        how: 'On an item that was counted on an earlier day, there should be a dim number to the LEFT of the Qty box with a date under it (like 12 over 8/29). It must be a previous day, never something typed today.',
      },
      {
        id: 'v191-stock-location', area: 'Runner stock',
        what: 'The list is grouped by location, and the toggle works',
        how: 'PRS Stock should open in groups like Kitchen Fridge, Kitchen Closet, Stock Closet, Tea & Coffee Bin, Bagel/Condiment Bin. Tap "Group by · Type" and it should switch back to Cleaning / Food / Coffee & Tea. Leave the page and return — it should remember your choice.',
      },
      {
        id: 'v191-stock-office-location', area: 'Runner stock',
        what: 'The Wednesday office list groups too',
        how: 'Runner → Stock → Office. In Location mode everything should sit under one "Office Cabinet" group rather than a flat list.',
      },
      {
        id: 'v191-grid-all-rooms', area: 'Calendar', device: 'phone',
        what: 'The phone grid shows all eleven rooms at once',
        how: 'On your phone open Calendar → Grid. You should see every room — PRS A through TRK South — without scrolling. Each session chip shows just the artist name.',
      },
      {
        id: 'v191-grid-synopsis', area: 'Calendar', device: 'phone',
        what: 'Tapping a chip gives a summary card with Expand',
        how: 'Tap any session chip. A card should slide up from the bottom with the name, room, date and time, staff and invoice number. Press Expand ↗ — the work order should open. Press Close on another one and confirm nothing was changed.',
      },
      {
        id: 'v191-day-picker', area: 'Calendar', device: 'phone',
        what: 'The day view has a pinned month calendar with dots',
        how: 'Calendar → Day on your phone. A month grid should sit above the rooms and stay there while you scroll. Days with sessions carry a small green dot. Tap a date — the rooms below should change to that day.',
      },
      {
        id: 'v191-centred', area: 'Calendar', device: 'phone',
        what: 'The page is evenly centred',
        how: 'On the phone calendar, look at the left and right edges of the cards. The gap should be the same on both sides — this used to sit hard against the left with a gap down the right.',
      },
      {
        id: 'v191-bullets', area: 'Notes', device: 'phone',
        what: 'Bullets show a bullet, and the buttons show their state',
        how: 'Open a shift note or My Day note. Tap the • button — you should get a visible dot, not a blank indent. The • button should fill in while the caret is inside the list, and empty when you move out of it. Same for B inside bold text.',
      },
    ],
  },
  {
    id: 'week-of-aug-26-2026',
    title: 'Notes that survive, the 8:50 night, monthly money, the 2026 import',
    version: 'v1.19.0',
    date: 'Aug 31, 2026',
    intro:
      'Six days of work in one batch (Aug 26–31 ran without wrap-ups). Four areas: notes that no longer disappear, the runner day rolling at 8:50 AM instead of midnight, the money rules on work orders (monthly split, day-rate law, 3% card fee), and the imported 2026 calendar. The 8:50 item needs someone working past midnight — leave it until a real night shift rather than faking it.',
    items: [
      {
        id: 'myday-notes-survive', area: 'My Day notes', device: 'desktop',
        what: 'Typed notes are still there after leaving the page',
        how: 'My Day → Shift notes. Type a few lines into Session notes WITHOUT submitting. The line above the boxes should change to "kept — safe to leave this page". Now go to the Calendar, then come back to My Day. Your text must still be in the box, exactly as you left it.',
      },
      {
        id: 'myday-notes-reload', area: 'My Day notes', device: 'desktop',
        what: 'They survive a full reload and a second device',
        how: 'With unsubmitted text in the boxes, reload the page (⌘R). The text should come back. Then open My Day on your phone or iPad signed in as yourself — the same unfinished text should be waiting there too.',
      },
      {
        id: 'myday-notes-submit-clears', area: 'My Day notes', device: 'desktop',
        what: 'Submit posts the note and leaves the boxes empty — and it stays empty',
        how: 'Type something, hit Submit shift notes. The boxes should clear and the post should appear in the log below. Now go to the Calendar and come back: the boxes must STILL be empty. (If your submitted text reappears in the box, that is the bug this item exists to catch — report it.)',
      },
      {
        id: 'myday-notes-edit-resume', area: 'My Day notes', device: 'desktop',
        what: 'Editing your own post and wandering off does not create a duplicate',
        how: 'In the log below, hit Edit on one of your own posts — it loads into the boxes and the header says "editing your post". Change a word, do NOT submit, go to the Calendar and come back. It should still say you are editing that post. Now Submit: the original post should be UPDATED. Check the log has no second copy.',
      },
      {
        id: 'runner-shift-note-autosave', area: 'Runner shift notes',
        what: 'The shift note saves itself while you type',
        how: 'Runner → Shift notes. Type a couple of lines, wait two seconds, then close the app entirely and reopen it. Your text should be there. Nothing to submit.',
      },
      {
        id: 'richnote-formatting', area: 'Runner shift notes',
        what: 'Bold and bullets work in notes',
        how: 'In a shift note, tap the B and type — the text should be bold. Tap the • button (or just start typing, which auto-bullets) and press return: you should get a second bullet, not a new paragraph. On a keyboard, Tab should indent a bullet.',
      },
      {
        id: 'ops-day-midnight', area: 'Runner hub',
        what: 'A night does not reset at midnight',
        how: 'DO THIS ON A REAL NIGHT SHIFT, past 12am. Around 11:50pm note which sessions and work orders your hub shows. After midnight, refresh. The same sessions and WOs should still be listed, and any checklist you started should still be the same one — nothing should have rolled over to a new day. (The day rolls at 8:50 AM instead.)',
      },
      {
        id: 'section-notes', area: 'Runner stock',
        what: 'The stock list has a notes box for the whole list',
        how: 'Runner → Stock → PRS Stock. Find the general notes box (not the per-item notes). Type something like "office run already done". Leave the page and come back — it should still be there. Ask the office to confirm they can see it in the Daily Ops notes popup.',
      },
      {
        id: 'runner-no-logout-typing', area: 'Runner stock',
        what: 'You do not get logged out mid-count',
        how: 'Start a long stock count and keep typing on and off for a while without leaving the page. You should stay signed in the whole time. (Previously a long count could hit the session expiry and dump you at the login screen.)',
      },
      {
        id: 'wo-day-hourly-twin', area: 'Work order', device: 'desktop',
        what: 'Day rate and hourly rate move together, 10 to 1',
        how: 'Open any work order with a studio row. Set the hourly rate to 75 — the day rate should become 750. Now type 900 into the day rate — hourly should become 90, and that row\'s OT rate should follow to 90 as well.',
      },
      {
        id: 'wo-monthly-split', area: 'Work order', device: 'desktop',
        what: 'A monthly amount splits across the days exactly',
        how: 'Open a lockout/monthly WO with a full month of dated rows. Open the Monthly popup, type the monthly figure (e.g. 19500) and apply. Add up the day rows: they must total EXACTLY 19,500 — some days will be a cent higher than others, which is correct. Add a day and re-run it; it should re-split, not double up.',
      },
      {
        id: 'wo-card-fee', area: 'Work order', device: 'desktop',
        what: 'The 3% card figure is calculated for you',
        how: 'Open a COD work order with a balance. Under Balance Due there should be a line "If paying by card (incl. 3%)" showing the balance × 1.03. Add a Credit Card payment for that exact charged amount: the balance should drop by the BASE amount (the pre-fee figure), not by the full charged amount, and it should land at zero.',
      },
      {
        id: 'lockout-status', area: 'Calendar', device: 'desktop',
        what: 'A lockout room shows as occupied but stays out of daily ops',
        how: 'Find a monthly lockout booking on the calendar (e.g. Track North). It should read green like a booked room and have a real work order. Then check the runner hub and daily ops for that studio on the same date — the lockout must NOT appear as a session to run, with no checklist or approval attached to it.',
      },
      {
        id: 'imported-history-readonly', area: 'Calendar', device: 'desktop',
        what: 'Imported past bookings are look-only',
        how: 'Scroll the calendar back to an earlier month of 2026 and open an imported session. It should open as a compact read-only card — not the editable work order — and it should have no invoice number. Confirm it is not in daily ops or the WO hub.',
      },
      {
        id: 'imported-future-promotes', area: 'Calendar', device: 'desktop',
        what: 'An imported booking in the future still becomes a real session',
        how: 'Find an imported booking dated today or later. Open it: it should open the work order editor, and saving should create a proper WO with an invoice number. It should then behave like any other session everywhere.',
      },
      {
        id: 'registration-confirm-sticks', area: 'Registration', device: 'desktop',
        what: 'Create profile stays done after a refresh',
        how: 'On the registration banner, hit Create profile for a pending registration. The row should clear. Now reload the page: it must NOT come back. (It used to reappear every refresh as if you had never confirmed it.)',
      },
      {
        id: 'leasing-status', area: 'CRM', device: 'desktop',
        what: 'Leasing is a lead status and stays out of Needs Action',
        how: 'CRM → open a lead → set its status to Leasing (purple). It should show under the Leasing tab in All Leads. Then check the dashboard Needs Action panel and CRM Needs Action: that lead must NOT be listed there.',
      },
      {
        id: 'iphone-calendar-rows', area: 'Calendar', device: 'phone',
        what: 'Stacked sessions on the phone calendar each get their own slot',
        how: 'On your phone, open the calendar on a day where one room has two or three sessions. Each session chip should be fully visible in its own slot — the room row should be taller to fit them, not overlapping them on top of each other.',
      },
    ],
  },
  {
    id: 'runner-feedback-mic-sheet-2026-08-25',
    title: 'Runner feedback fixes + the new mic Sheet',
    version: 'v1.18.0 (mic Sheet merged to main Aug 26 — the "PREVIEW LINK" items below are now live)',
    date: 'Aug 25, 2026',
    intro:
      'Two things at once: the fixes from the Aug 24 runner test pass (stock list corrections, add-item bug, initials, help tips), and the mic inventory page rebuilt as a tap-grid "sheet". The mic items run on the PREVIEW link until Eli merges — everything else is live. This batch also stands in for Aug 24\'s unwritten batch: the expense report, Reopen and shift-notes items at the bottom cover that session\'s settled work.',
    items: [
      {
        id: 'stock-categories', area: 'Runner stock',
        what: 'Cleaning supplies are grouped under Cleaning',
        how: 'Runner → Stock → PRS Stock. Open the Cleaning group: Finish "Powerball", Hand Soap Refill, Gain detergent, dryer sheets, RAID Bug Spray and Distilled Water should all be in there — not under Kitchen, Batteries or Water.',
      },
      {
        id: 'stock-x-items', area: 'Runner stock',
        what: 'The X (check-daily) items are the three dairy ones',
        how: 'In PRS Stock, find the items marked (PRS-X). They should be exactly: Chobani Sweet Cream Creamer, Mini Half n Half, 1/2 Gallon 2% Milk. The two individual creamer-packet items should NOT carry the marker anymore.',
      },
      {
        id: 'stock-bagels-kcups', area: 'Runner stock',
        what: 'Bagels read Plain, Everything, Cinnamon — and Pike Place replaced French Vanilla K-Cups',
        how: 'In the Food group, the three bagel lines should appear in that order top to bottom. In Coffee & Tea, there should be a Keurig Starbucks Pike Place line and no French Vanilla K-Cups.',
      },
      {
        id: 'stock-add-item', area: 'Runner stock',
        what: 'Adding a new stock item lets you type the whole name — and back out',
        how: 'In any group tap + Add item. Type a full made-up name (every letter should land in the box — this used to lock after one letter). Then tap the × on that row to remove it WITHOUT saving. Reload: the item should not exist.',
      },
      {
        id: 'initials-autofill', area: 'Runner checklist',
        what: 'Your initials fill themselves in from your login',
        how: 'Sign in as yourself (not the shared runner login) and open a checklist. The Initials box at the bottom should already show your initials without typing. Same on the mic page.',
      },
      {
        id: 'checklist-wednesday', area: 'Runner checklist',
        what: 'The opening checklist says the office run is Wednesdays',
        how: 'Open the PRS opening checklist and find the office-run line under Runs. It should say "(Wednesdays)" — it used to say Thursdays.',
      },
      {
        id: 'hint-solid', area: 'Help tips',
        what: 'The "?" help tips are solid, not see-through',
        how: 'With hints on, tap any small "?" bubble (the runner hub has them next to the section titles). The tip that pops up must be fully solid and readable — not faded or transparent.',
      },
      {
        id: 'mic-tabs', area: 'Runner mics',
        what: 'Every studio has its own mic tab with a progress counter',
        how: 'PREVIEW LINK. Runner → Mic Inventory. Across the top: your studio first, then the other three, Floating, Odds — each with a count like 0/86. Tap through them; each shows that studio\'s own list.',
      },
      {
        id: 'mic-tap-here', area: 'Runner mics',
        what: 'One tap marks a mic HERE; a second tap offers Room / Missing / Clear',
        how: 'PREVIEW LINK. Tap any mic square once — it turns green and says HERE, and the tab counter goes up. Tap the same square again — a small menu appears with the rooms, MISSING and Clear. Pick a room; the square turns blue with the room name.',
      },
      {
        id: 'mic-no-jump', area: 'Runner mics',
        what: 'The list stays where you are when you tap',
        how: 'PREVIEW LINK. Scroll halfway down a long tab (PRS) and tap a few squares. The page must stay exactly where you are — it used to jump back to the top on every tap.',
      },
      {
        id: 'mic-search-refs', area: 'Runner mics',
        what: 'Search stays pinned while you scroll, and each mic shows where it was last seen',
        how: 'PREVIEW LINK. Scroll deep into a tab — the search box should still be visible at the top. Type "C800" — the grid filters as you type. Each square\'s small grey line should read like "last: HERE · 8/24" once a night or two of checks exist.',
      },
      {
        id: 'mic-draft', area: 'Runner mics',
        what: 'Half-finished mic checks survive leaving the page',
        how: 'PREVIEW LINK. Mark a few mics, then go back to the hub WITHOUT saving and reopen Mic Inventory. Your marks should still be there. Save, reopen — still there, now from the server.',
      },
      {
        id: 'wo-expenses', area: 'Runner work order',
        what: 'Food expenses and receipt photos save instantly on the work order',
        how: 'Open a session\'s work order from the runner hub. In the expense section add a row (date / place / amount) and attach a receipt photo. Leave the page WITHOUT tapping Save and come back — the row and photo must still be there.',
      },
      {
        id: 'wo-reopen', area: 'Work orders',
        what: 'A completed work order can be reopened',
        how: 'On a completed WO, the Complete button should now read Reopen. Tap it — it asks first, then the WO is OPEN again and editable.',
        device: 'desktop',
      },
      {
        id: 'wo-cod-balance', area: 'Work orders',
        what: 'The red "Balance due" only shows on COD sessions',
        how: 'Open one COD work order with money owed (balance shows red) and one Billing/label work order (the balance line shows plain, no red). Red = collect at the desk.',
        device: 'desktop',
      },
    ],
  },
  {
    id: 'ribbon-mark-2026-08-22',
    title: 'The Ribbon — new logo and app icon',
    version: 'v1.16.1 (production)',
    date: 'Aug 22, 2026',
    intro:
      'The PRSFlo logo is now one solid sea-green ribbon (it used to be three faint grey lines), and the phone app icon matches it. This batch is all looking, no doing — anyone can run it.',
    items: [
      {
        id: 'ribbon-login', area: 'Login',
        what: 'The login screen shows the solid sea-green ribbon above the name',
        how: 'Sign out, then look at the login screen. Above the PIN pad you should see ONE solid green wave-ribbon shape — not three separate grey lines, and no glow around it.',
      },
      {
        id: 'ribbon-rail', area: 'Side rail',
        what: 'The little logo at the top of the side rail is the same green ribbon',
        how: 'Sign in at a computer and look at the top of the left rail. The small mark next to "PRSFlo" should be the same solid green ribbon, clearly readable even at that small size.',
        device: 'desktop',
      },
      {
        id: 'ribbon-wordmark', area: 'Wordmark',
        what: 'The name reads "PRSFlo" — capital F, small l-o',
        how: 'Anywhere the name appears (login, side rail), check the second half says "Flo", not "FLO". PRS stays all caps and solid; Flo sits next to it slightly faded.',
      },
      {
        id: 'ribbon-both-themes', area: 'Themes',
        what: 'The ribbon stays the SAME green in light and dark mode',
        how: 'Toggle the theme in Settings. The ribbon must stay the same sea green in both — it should NOT turn grey, white or blue in either theme.',
        device: 'desktop',
      },
      {
        id: 'ribbon-app-icon', area: 'Phone icon',
        what: 'A freshly added home-screen app shows the new icon',
        how: 'On your phone, remove PRSFlo from your home screen if you have it, then re-add it from the browser (Share → Add to Home Screen). The icon should be the green ribbon on a dark rounded square. If you keep the OLD icon without re-adding, that is expected, not a fail.',
        device: 'phone',
      },
      {
        id: 'ribbon-runner-icon', area: 'Phone icon',
        what: 'The Runner app icon is the same ribbon in orange',
        how: 'On a phone, remove and re-add the Runner app (from /runner → Add to Home Screen). Its icon should be the same ribbon shape but ORANGE on the dark square, so the two apps are easy to tell apart.',
        device: 'phone',
      },
    ],
  },
  {
    id: 'financials-2026-08-20',
    title: 'Financials — the revenue graph in the Billing hub',
    version: 'v1.16.0 (production)',
    date: 'Aug 20, 2026',
    intro:
      'A new owner-only screen holding every dollar Paramount has billed since 2017, plus what the app records now. OWNERS ONLY — if you are not an owner, the word "Financials" should not appear for you at all, and item 1 is the only thing you can check. Do this at a computer.',
    items: [
      {
        id: 'fin-visible', area: 'Financials',
        what: 'Financials appears in the Billing hub — and only for owners',
        how: 'Open Billing from the side rail. Along the top you should see "Billing", "COD" and "Financials". If you are NOT an owner, "Financials" must not be there — that is a pass, and you are done with this batch.',
      },
      {
        id: 'fin-history', area: 'Financials',
        what: 'The old years are actually there',
        how: 'Click Financials. Drag the LEFT handle of the bar under the graph all the way to the left. The line should run from 2017 to now — roughly $200k to $650k a month, not a flat line and not one bump.',
      },
      {
        id: 'fin-metric', area: 'Financials',
        what: 'The line changes subject',
        how: 'Click ENGINEERING in the row of buttons at the top left. The whole graph should redraw showing engineering only, with much smaller numbers up the left side. Click TOTAL to go back.',
      },
      {
        id: 'fin-room', area: 'Financials',
        what: 'One room can be picked out',
        how: 'From the "All rooms" dropdown choose any single room. The line should drop to that room\'s share alone. Choose a "— all rooms" option for a whole building and it should rise again. Set it back to All rooms.',
      },
      {
        id: 'fin-hover', area: 'Financials',
        what: 'Hovering answers "how does this month compare to last year"',
        how: 'Move the mouse across the graph. The bar above it should follow, showing the month, its figure, the same month a year earlier with a green or red percentage, and the change from the month before.',
      },
      {
        id: 'fin-compare', area: 'Financials',
        what: 'The dashed line can be pinned to a chosen year',
        how: 'In the "Compare to" dropdown pick 2019. The dashed line should redraw against 2019, and the hover bar should now say "vs 2019". Choose "Nothing" and the dashed line should disappear entirely.',
      },
      {
        id: 'fin-years', area: 'Financials',
        what: 'Years mode stacks the years on one Jan–Dec axis',
        how: 'Click YEARS at the top right. The bottom of the graph should read Jan through Dec, with one line per year labelled at its right-hand end and the newest drawn brightest. Click a year button underneath to add or remove it.',
      },
      {
        id: 'fin-partial', area: 'Financials',
        what: 'This month is marked unfinished, not shown as a crash',
        how: 'Back in TIMELINE, look at the far right of the line. The last stretch should be DASHED with a hollow dot, and the readout should say something like "Aug 1–20, partial month". Its comparison should say "same days" — it must NOT look like revenue fell off a cliff.',
      },
      {
        id: 'fin-zoom', area: 'Financials',
        what: 'Zooming and sliding behave',
        how: 'Drag the handles at each end of the bar under the graph to squeeze the range, then drag the MIDDLE of the lit section to slide it along. The graph should follow smoothly and the months along the bottom should stay in order.',
      },
      {
        id: 'fin-export', area: 'Financials',
        what: 'Export gives you a file you can open',
        how: 'Click EXPORT CSV. A file should download. Open it in Excel or Numbers — it should have a row per month with columns for each stream.',
      },
    ],
  },
  {
    id: 'launch-night-2026-08-20b',
    title: 'Launch night — PIN login, building a session, equipment, registrations',
    version: 'v1.15.1 (production)',
    date: 'Aug 20, 2026',
    intro:
      'Everything here was found by using the app on launch day and fixed the same night. Most of it is about BUILDING a session — the rate and the engineer are now on the day itself. Do this at a computer with one throwaway session you can delete afterwards. You will need your own 6-digit PIN.',
    items: [
      {
        id: 'ln-pin', area: 'Login',
        what: 'Your six-digit PIN logs you in',
        how: 'Sign out. Tap your 6-digit PIN on the number pad. It should log you straight in. (If it was refusing earlier today, that was the app, not your PIN — same PIN.)',
      },
      {
        id: 'ln-pin-error', area: 'Login',
        what: 'A wrong PIN says "incorrect", not something vague',
        how: 'On the login screen tap six WRONG digits. The pad should shake and say incorrect — not "something went wrong". Then log in properly with your real PIN.',
      },
      {
        id: 'ln-room-rate', area: 'Work order',
        what: 'The room rate is under the room times when you open a day',
        how: 'Make a new booking for a throwaway session, open its work order, and click the day card. In the panel, under STUDIO and its Start/End times, there should be a /HR · /DAY switch and a rate box. Type a rate. You should NOT have to scroll to the bottom to find it.',
      },
      {
        id: 'ln-staff-line', area: 'Work order',
        what: 'A staff line is already there — no need to add one',
        how: 'In that same day panel, below the studio block there should already be a staff block with a 2ND tag, a name box and a rate box. Tap 2ND — it should flip to 1ST. Type a name and a rate.',
      },
      {
        id: 'ln-staff-times', area: 'Work order',
        what: 'Staff times fill in from the room times, even if you set the room times afterwards',
        how: 'On a day where the room has no times yet, look at the staff block — its Start/End should be empty. Now type the ROOM Start and End at the top. The staff line should show those same times without you typing them again.',
      },
      {
        id: 'ln-rate-warn', area: 'Work order',
        what: 'A named engineer with no rate is flagged in orange',
        how: 'On a staff line, set it to 1ST, type a name, and leave the rate blank. The rate box should tint orange. Close the panel — the day card should show "rate?" in orange next to that person. Type a rate and both should go back to normal.',
      },
      {
        id: 'ln-card-rates', area: 'Work order',
        what: 'The day card shows the rates behind its total',
        how: 'Close the day panel and look at the day card. Next to the times you should see the room rate ("Day $1,400" or "$150/hr"), and next to the staff member their rate. Check the day total looks right for those numbers.',
      },
      {
        id: 'ln-staff-x', area: 'Work order',
        what: 'An accidentally added second engineer can be removed',
        how: 'In the day panel click "+ Add engineer" to add a second staff block. Now click the small × at the top right of that block — it should disappear. The original staff line should still be there.',
      },
      {
        id: 'ln-tab', area: 'Work order',
        what: 'Tab goes straight from Start to End',
        how: 'Click into a Start time box and type a time, then press Tab ONCE. The cursor should land in the End box — not on the little arrow next to it.',
      },
      {
        id: 'ln-equip-clear', area: 'Work order',
        what: 'Equipment pills can be cleared back to not-checked',
        how: 'On a day, tap an equipment pill once (goes green/OK), again (goes red/Not OK), and a third time. It should go back to plain grey — not checked. Tap it to red again and check any note you wrote is still there.',
      },
      {
        id: 'ln-equip-runner', area: 'Runner (phone)',
        what: 'Same clearing works on the runner side',
        how: 'On the tablet, open tonight\'s work order and tap an equipment pill three times. It should end up grey/not-checked, same as on the computer.', device: 'phone',
      },
      {
        id: 'ln-reg-banner', area: 'CRM',
        what: 'A returned registration shows the person\'s name with a Create profile button',
        how: 'When a client completes a registration, open the CRM. Above the tabs you should see a teal-edged block with a pulsing dot, "REGISTRATIONS BACK", and a row per person — initials, name, how long ago, and a Create profile button. Click Create profile: it should take you to that client\'s profile and the row should go.',
      },
      {
        id: 'ln-newlead-dd', area: 'CRM',
        what: 'The New Lead search list is solid, not see-through',
        how: 'Click + New Lead and start typing a client name in the first box. The suggestions list that drops down should be solid — you should NOT be able to read the form fields through it.',
      },
      {
        id: 'ln-cleanup', area: 'Work order',
        what: 'Delete the throwaway session',
        how: 'Open the throwaway session\'s work order and use Delete at the bottom left, or delete the booking from the calendar. Confirm it is gone from the calendar and from Billing.',
      },
    ],
  },
  {
    id: 'launch-day-2026-08-20',
    title: 'Launch day — PINs, names everywhere, shift notes, billing tabs',
    version: 'v1.15.0 (production)',
    date: 'Aug 20, 2026',
    intro:
      'The app is LIVE now, so this batch runs on the real site, not a preview. It covers the launch-day wave: six-digit PIN login, your name showing wherever work is filed, editable shift notes that seal at 8:50 AM, the reorganized billing tabs, and the work order polish. You will need your own PIN (Eli hands those out), a computer, and one of the runner tablets. One item can only be checked the MORNING AFTER a shift note is written — leave it open until then.',
    items: [
      {
        id: 'ld-pin-login', area: 'Login',
        what: 'The number pad takes your six-digit PIN and logs you in as YOU',
        how: 'Sign out, then on the login screen tap your six-digit PIN on the number pad. It should log you in without asking for anything else. Check the dashboard greets you with YOUR name. A wrong PIN should shake and say incorrect.',
      },
      {
        id: 'ld-runner-gate', area: 'Runner (phone)',
        what: 'The runner app demands a login when nobody is signed in',
        how: 'On a tablet or phone that is signed out, go to the runner app address. It must land you on the LOGIN screen, not an empty-looking runner app. PIN in as a runner and it should go straight to the runner hub.', device: 'phone',
      },
      {
        id: 'ld-runner-name', area: 'Runner (phone)',
        what: 'The runner app shows whose session the tablet is',
        how: 'Signed in as a runner, look at the studio-picker screen: it should greet by first name and say "signed in as [full name]" under the date. Pick a studio: the hub header should also show the name next to the date.', device: 'phone',
      },
      {
        id: 'ld-punch-as', area: 'Runner (phone)',
        what: 'The missed-punch form names who it files under, on the button itself',
        how: 'From the runner hub open Missed a punch. Under the title it should say "Filing as [name]", and the submit button should read "Submit as [name]". Confirm the name is the person actually signed in.', device: 'phone',
      },
      {
        id: 'ld-shift-edit', area: 'Runner (phone)',
        what: 'A shift note can be tapped and fixed, and shows an "edited" tag after',
        how: 'Open Shift notes, add an entry with a deliberate typo, then tap the entry text. It should turn into a text box. Fix the typo, tap Save fix. The entry should show the fixed text with a small "· edited" next to the initials and time.', device: 'phone',
      },
      {
        id: 'ld-shift-seal', area: 'Runner (phone)',
        what: 'After 8:50 AM, yesterday\'s shift note refuses to be edited',
        how: 'THE MORNING AFTER writing a shift note (any time after 8:50 AM): open Shift notes — the log should be a fresh empty page. Ask the office to open Daily Ops and find last night\'s note there. If you can still edit last night\'s entry from anywhere after 8:50, report it.', device: 'phone',
      },
      {
        id: 'ld-upcoming-gone', area: 'Billing',
        what: 'There is no Upcoming list — future sessions sit in In progress with a "Not started" tag',
        how: 'On a computer open Billing. There should be NO "Upcoming sessions" bar anywhere. Book a throwaway session for next week, come back to Billing: the new work order should appear at the BOTTOM of In progress with a "Not started" tag on the row. Delete the throwaway after.',
      },
      {
        id: 'ld-cod-latch', area: 'Billing',
        what: 'COD tabs latch — two on at once shows one combined list with colored tags',
        how: 'In Billing switch to COD. Click Balance due and In progress so BOTH look pressed. The list should show rows from both, Balance due rows first, each row carrying a small colored tag naming its bin. Click one tab off — the tags disappear when only one bin is shown. The last lit tab should refuse to turn off.',
      },
      {
        id: 'ld-wo-top', area: 'Work order',
        what: 'The work order opens at the top of the screen with big Cancel / Complete / Save buttons',
        how: 'Open any work order on a computer. It should start just under the top of the window — no "Work Order · WO-x" bar above the letterhead — with the three buttons top right, comfortably large. The status pills (Confirmed / Tentative / …) should fit on ONE row in the left column.',
      },
      {
        id: 'ld-wo-delete-day', area: 'Work order',
        what: 'A day card can be deleted with the × (with a confirm), and Cancel brings it back',
        how: 'On a multi-day work order in card view, click the small × next to "✎ edit" on one day. It should ask "Delete day?" — click Delete. The card disappears. Now click Cancel on the work order and re-open it: the day should be BACK (cancel undoes the delete). Repeat and press Save instead: the day should stay gone. Use a test session.',
      },
      {
        id: 'ld-crm-density', area: 'CRM',
        what: 'The CRM fits comfortably on screen — nothing important cut off',
        how: 'Open the CRM on a computer at normal (100%) browser zoom. The lead list and the detail panel should both fit without things overlapping or getting clipped, matching how it used to look at 90% zoom. Scan the detail panel: session fields, notes and buttons all visible.',
      },
      {
        id: 'ld-training', area: 'Training',
        what: 'Training holds all three guides and the hints switch',
        how: 'Open Training in the sidebar. There should be cards for App guide (SOP), Billing SOP and Studio Manager SOP — each opens its guide — plus the Helpful hints on/off switch. The app guide should be in the new dark look with the version history at the end showing v1.15.0 on top.',
      },
      {
        id: 'ld-reg-preview', area: 'CRM',
        what: 'A texted registration link previews as "Paramount Client Registration"',
        how: 'Send YOURSELF a registration link by text (or paste one into iMessage). The link preview should say "Paramount Client Registration" with our paramountrecording.com address — not "PRSFlo" and not a vercel address. New links only; an old thread may show a cached preview.',
      },
    ],
  },
  {
    id: 'wo-two-column-2026-08-18',
    title: 'The work order in two columns — words left, numbers right',
    version: 'v1.14.0 (preview branch)',
    date: 'Aug 18, 2026',
    intro:
      'The work order was rearranged on a computer into two halves: the client and the notes on the left, every number on the right. Nothing was removed and nothing became read-only, so most of this batch is checking that things you could type into before you still can. The phone version was not touched at all — the last two items check exactly that. Do items 1–12 at a computer with a MULTI-DAY label session open (3 days is ideal); you will need a one-day COD session for two of them.',
    items: [
      {
        id: 'wo2c-two-columns', area: 'Work order',
        what: 'The work order opens in two columns, not one long page',
        how: 'On a computer, open the calendar and click a session that has 3 days. The work order should open WIDE, with the client details down the left side and the studio days, rentals and payments down the right. If it is one single column top to bottom, stop and report it.',
      },
      {
        id: 'wo2c-letterhead', area: 'Work order',
        what: 'The top left is a letterhead with the WO number large on the right',
        how: 'Look at the very top of the left column. You should see "Paramount Recording" with our address and phone under it, and on the right of that block the work order number (like WO-1032) in large type, with "Invoice #…" underneath and an OPEN or COMPLETED tag under that. Check the WO number matches the one in the window title bar.',
      },
      {
        id: 'wo2c-label-hero', area: 'Work order',
        what: 'On a label job the LABEL is the big name on the client card',
        how: 'On that same label session, look at the client card under the letterhead. The big bold name should be the LABEL (e.g. Interscope), not the A&R person. There should be a LABEL/BILLING tag beside it. Report it if the person\'s name is the big one.',
      },
      {
        id: 'wo2c-anr-admin', area: 'Work order',
        what: 'A&R and Admin sit side by side and neither one wraps onto extra lines',
        how: 'On the client card, A&R should be on the left and Admin on the right, each with a name, an email and a phone. Long emails should be cut off with "…" rather than wrapping. Beside each name there should be three small icons — an envelope, a phone and a speech bubble. Nothing should be spilling outside the card.',
      },
      {
        id: 'wo2c-contact-actions', area: 'Work order',
        what: 'The ✉ ☎ 💬 icons still open mail, phone and text',
        how: 'On the A&R line, hover the envelope — a tooltip should show the email address. Click it; your mail app should open a new message to that address. Do the same with the phone icon. If a contact has no email or phone, that icon should look faded and do nothing when clicked.',
      },
      {
        id: 'wo2c-everything-editable', area: 'Work order',
        what: 'Every field on the left column still accepts typing',
        how: 'Working down the left column, type into each of these and confirm the text appears: Artist, A&R name, A&R email, A&R phone, Admin name, Admin email, Admin phone, Invoice #, PO #, Food $, and Booking Notes. Then press Cancel so nothing is saved. If any of them refuses to take text, report which one.',
      },
      {
        id: 'wo2c-needs-attention', area: 'Work order',
        what: 'Needs attention is a slim strip that opens when you click + Add',
        how: 'Look at the very bottom of the LEFT column. On a session with no attention notes you should see one slim strip reading "Needs attention · Internal" with "+ Add" on the right — not a big empty box. Click + Add: a text box and "+ Add photo" should appear. Type something, then click Hide and Show again — your text must still be there.',
      },
      {
        id: 'wo2c-scroll-hint', area: 'Work order',
        what: 'The days list says how many more days are below, and stops saying it at the bottom',
        how: 'You need a session with at least 5 days for this (add days with + Seed if you have none). Look at the bottom of the studio days area: it should fade out and show a small tag like "↓ 2 more days". Scroll that list to the very bottom — the fade and the tag must BOTH disappear. Scroll back up and they should come back.',
      },
      {
        id: 'wo2c-two-bins', area: 'Work order',
        what: 'Days and rentals scroll separately',
        how: 'On a multi-day session, add 5 or 6 rental rows with + Add row. Scroll inside the studio days list — the rentals list below must NOT move. Then scroll inside the rentals list — the days list must not move. Each one should scroll on its own.',
      },
      {
        id: 'wo2c-itemized-total', area: 'Work order',
        what: 'The running total under the days is itemized and adds up',
        how: 'Under the studio days list, find the total panel. It should list "Studio" with an amount, then a separate line for each engineer/assistant by name with their own amount, then the big total. Add the Studio line and every staff line together on a calculator — it must equal the big total exactly. Then check that big total matches "Studio Total" + "Eng Total" in the Payments box on the bottom right.',
      },
      {
        id: 'wo2c-song-notes', area: 'Work order',
        what: 'Each day card shows that day\'s song / session notes in its middle',
        how: 'Switch the studio days to card view (the ▦ button beside "Studio Time"). Each day card should have three parts: the room and times on the left, "Song / session notes · <date>" in the middle, and the day total on the right. Click a card, type a song title into the day sheet, press Save — that title should now show in the middle of that card and NOT on any other day\'s card.',
      },
      {
        id: 'wo2c-pdf-unchanged', area: 'Work order',
        what: 'The PDF is exactly what it was before this change',
        how: 'Open /billing, find a work order you have a previously-downloaded PDF for, and download the package again. Open both PDFs side by side — every page must be identical. If ANYTHING differs, stop and report it; this change was not supposed to touch the PDF at all.',
      },
      {
        id: 'wo2c-phone-unchanged', area: 'Runner', device: 'phone',
        what: 'The runner work order on a phone looks exactly as it did',
        how: 'On your phone, open a runner studio and tap into a session\'s work order. It should look and behave exactly as it did yesterday — session info card at the top, day cards, notes, then the Submit button at the bottom. Anything that looks rearranged, out of order, or squashed is a bug.',
      },
      {
        id: 'wo2c-phone-order', area: 'Runner', device: 'phone',
        what: 'The sections on the phone are still in the right order',
        how: 'On that same phone work order, scroll from top to bottom and check the order is: Session Info → Studio Time → Rentals → Session Notes → Payments/Totals → Needs Attention. If Session Notes or Needs Attention has jumped to the top, report it.',
      },
    ],
  },
  {
    id: 'launch-prep-2026-08-17',
    title: 'Launch prep — guides, hints, Settings, Engineers, Daily Ops paging',
    version: 'v1.13.0 (preview branch)',
    date: 'Aug 17, 2026',
    intro:
      'Pre-launch housekeeping: runners get an in-app App Guide, small helpful-hint markers appear across the app (toggleable), the rail\'s rarely-used items moved into a Settings disclosure, Engineers got its own page, and Daily Ops gained queue paging plus browse-any-day on the sweep. Admin checks on a computer; the two runner checks on a phone.',
    items: [
      {
        id: 'lp-hints-visible', area: 'Hints',
        what: 'Blue ? markers appear and show a tip when tapped',
        how: 'Open the dashboard. You should see a small pulsing blue ? next to the Flo box header and next to "My day — duties". Click one — a dark tip bubble should appear; click anywhere else and it closes. Clicking the ? must NOT trigger anything behind it.',
      },
      {
        id: 'lp-hints-toggle', area: 'Hints',
        what: 'Hints turn off from Settings and stay off after a reload',
        how: 'Bottom of the left menu → Settings → "Hints: on". Click it. Every blue ? should vanish immediately. Reload the page — they must STAY gone. Turn them back on the same way.',
      },
      {
        id: 'lp-settings', area: 'Rail',
        what: 'Settings holds SOP, DEV, hints, theme and Sign Out; Admin is gone from the menu',
        how: 'Click ⚙ Settings at the bottom of the left menu. It should expand to show SOP, DEV, Hints, Light/Dark mode and Sign Out. Confirm "Admin" appears NOWHERE in the menu (typing /admin in the address bar should still load the old page).',
      },
      {
        id: 'lp-engineers', area: 'Engineers',
        what: 'The Engineers page lists the roster and edits save',
        how: 'Left menu → Operations → Engineers. The roster should load with initials, role tags and contact info. Edit someone, change their phone, Save — the row should update without a reload. Deactivate then Reactivate someone and confirm the INACTIVE tag comes and goes ("Show inactive" reveals hidden people).',
      },
      {
        id: 'lp-ops-paging', area: 'Daily Ops',
        what: 'The queue pages at 10 and the studio tasks card stays visible',
        how: 'Open Daily Ops. If "Needs you" has more than 10 items, page arrows with "Page 1 of N" appear at its foot and the Studio tasks card below stays on screen. Fewer than 10 items = no pager at all.',
      },
      {
        id: 'lp-ops-swipe', area: 'Daily Ops',
        what: 'The sweep leads with the date and browses previous days',
        how: 'On Daily Ops, the right side should say "Yesterday" big, with the date beside it. Click ‹ a few times — the heading becomes the actual date and the four studio cards change to that day. › returns; it stops at Yesterday. On a touch screen, swiping the sweep area left/right should do the same.',
      },
      {
        id: 'lp-runner-guide', area: 'Runner hub', device: 'phone',
        what: 'The App Guide opens from the studio page and reads on a phone',
        how: 'On the runner studio page, scroll to the bottom register and tap "App guide". A guide with chapter pills across the top should open; tap through two chapters, then ← back to the hub. "Runners manual" should still say Coming soon.',
      },
      {
        id: 'lp-runner-hints', area: 'Runner hub', device: 'phone',
        what: 'The 💡 on the hub toggles hints for runners',
        how: 'On the studio page header, tap the 💡 to the right of the studio pills. Blue ? markers should appear next to "Today" and the duties heading; tap one for the tip. Tap 💡 again to turn them off.',
      },
      {
        id: 'lp-venue-guard', area: 'Work order',
        what: 'A session cannot be saved without a venue on each studio day',
        how: 'Calendar → + New Booking. Pick a client, add a studio time row with a date and times but leave the studio dropdown on a bare letter (no venue). Press Save. A red banner should appear telling you to pick a venue, and the row should be highlighted — the popup must NOT close. Pick "Paramount · A" and Save again — now it should save and the chip should appear on the calendar.',
      },
      {
        id: 'lp-desktop-sheet', area: 'Work order',
        what: 'Editing a day from card view on desktop opens a centered window',
        how: 'On a computer, open a work order, switch Studio Time to the cards view (grid icon), and click a day card. The editor should open as a centered window with a dark background — not a phone-style sheet stuck to the bottom or anything overlapping the left menu. Esc/clicking outside closes it.',
      },
      {
        id: 'lp-day-words', area: 'Wording',
        what: 'Daily Ops says "Yesterday", not "Last night"',
        how: 'Open Daily Ops on the most recent day. The sweep heading must read "Yesterday". A missing-checklist item in the queue should say "find out why before the next shift" — no "tonight".',
      },
    ],
  },
  {
    id: 'runner-wo-2026-08-16',
    title: 'The runner work order — one work order, two views',
    version: 'v1.11.0–v1.12.0 (preview branch)',
    date: 'Aug 16, 2026',
    intro:
      'The runner work order is now the same work order the office uses, with the office\'s parts locked. Runners land on day cards, tap one for a big-input day sheet, swipe between days, and Submit without penalty. Overtime now calculates itself from the times. And the open work order is LIVE — office edits appear on the runner\'s screen while they have it open. Most of this is phone work; the admin checks are on a computer. You will need one session on the calendar for today, with booked start and end times.',
    items: [
      {
        id: 'rwo-locked-top', area: 'Runner WO', device: 'phone',
        what: 'The client info at the top is locked, and the phone number dials',
        how: 'From the studio hub, open today\'s session. The top card should say "Set by the office" with a lock, and none of it should be editable. If the client has a phone number, tap the phone pill — your phone should offer to call it.',
      },
      {
        id: 'rwo-cards-default', area: 'Runner WO', device: 'phone',
        what: 'Every session opens as cards; the toggle switches to the list and back',
        how: 'Open any session. Studio Time should show one card per day, never the wide table. Find the small toggle above the cards (two icons: lines and blocks), tap the lines icon for the compact table, then tap back.',
      },
      {
        id: 'rwo-sheet', area: 'Runner WO', device: 'phone',
        what: 'The day sheet: studio and staff each get matching big time blocks',
        how: 'Tap today\'s card (or its ✎ Edit pill). A sheet slides up: the studio with two large Start/End boxes and an hours chip, then each engineer/assistant in an identical block right below with their own times. Change the studio End time, tap Done, and check the card shows the new time.',
      },
      {
        id: 'rwo-dropdown', area: 'Runner WO', device: 'phone',
        what: 'The time dropdown opens on the current time, and typing works too',
        how: 'In the day sheet, tap the small ▾ on a time box. The list should appear already scrolled to the time that was showing, with it highlighted — not at 12:00 AM. Pick a time a couple of slots away. Then try typing directly into the box: "930p" should become 9:30 PM.',
      },
      {
        id: 'rwo-ot-auto', area: 'Runner WO', device: 'phone',
        what: 'Overtime fills itself in when the session runs past the booked end',
        how: 'On an hourly session booked 12P–8P, set the End time to 11:00 PM in the day sheet. Without typing anything else, the Overtime box should say it ran 3h past the agreed end, and the billing list below should show an OT line with the amount. Set End back to 8:00 PM and the OT line should disappear.',
      },
      {
        id: 'rwo-ampm', area: 'Runner WO', device: 'phone',
        what: 'A wrong AM/PM gets flagged, not blocked',
        how: 'In the day sheet, set a Start of 12:00 PM and an End of 8:00 AM (next morning). A small red note should appear under the times warning it is a very long day and to double-check AM/PM. It should NOT stop you from saving.',
      },
      {
        id: 'rwo-swipe', area: 'Runner WO', device: 'phone',
        what: 'You can swipe between days inside the day sheet',
        how: 'On a multi-day session, open a day sheet and swipe left — the next day should slide in (the header date changes, with a "2/3" style counter). Swipe right to go back. The ‹ › arrows next to the date do the same.',
      },
      {
        id: 'rwo-rates-locked', area: 'Runner WO', device: 'phone',
        what: 'You can see every rate but cannot change any of them',
        how: 'Look at the rates in the list view, the day sheet\'s Billing box, and the totals at the bottom. All the dollar amounts should be visible but none of the rate fields should let you type. If any rate accepts typing, report it.',
      },
      {
        id: 'rwo-equip', area: 'Runner WO', device: 'phone',
        what: 'Equipment pills cycle OK → Not OK and never go back to blank',
        how: 'On a day card, tap the Speakers pill: it goes OK (green). Tap again: Not OK (red) and a note box opens. Keep tapping — it should only ever switch between OK and Not OK, never back to grey. Write a note in the box and tap Done.',
      },
      {
        id: 'rwo-payment', area: 'Runner WO', device: 'phone',
        what: 'You can record a payment taken at the desk',
        how: 'Scroll to Payments, tap + Add payment, pick Cash, enter 100, then press Save at the top. Reopen the work order — the payment should still be there and the Balance Due at the bottom should be $100 lower.',
      },
      {
        id: 'rwo-submit', area: 'Runner WO', device: 'phone',
        what: 'Submit sends today and the button changes to "Update submission"',
        how: 'Press the green "Submit today" button at the bottom. You should land back on the studio hub. Reopen the same work order — the bottom button should now say "Update submission", and today\'s date should show a small orange dot.',
      },
      {
        id: 'rwo-resubmit', area: 'Runner WO', device: 'phone',
        what: 'You can still edit after submitting — no penalty, no warning',
        how: 'After submitting, open today\'s card and change the End time. Press "Update submission". It should save and close like normal — no error, no warning, nothing asking you to justify it.',
      },
      {
        id: 'rwo-flag', area: 'Runner WO', device: 'phone',
        what: 'A needs-attention note raises a flag the office can see',
        how: 'In "Needs Attention / Runner Notes", type "test flag from runner WO" and add a photo with + Add photo. Press Save. On a computer, check the dashboard Flags panel — the flag should be there with your note. (Resolve it after.)',
      },
      {
        id: 'rwo-locked-day', area: 'Runner WO', device: 'phone',
        what: 'A day the office approved is greyed out and cannot be edited',
        how: 'On a computer, open the same work order from the calendar and click the ✓ lock pill on one day\'s row so it shows 🔒. On the phone, reopen the work order — that day\'s card should be dimmed, say "Approved by the office — locked", and tapping it should do nothing.',
      },
      {
        id: 'awo-regression', area: 'Work Orders', device: 'desktop',
        what: 'The office work order still works exactly as before',
        how: 'Open any work order from the calendar. Check the table looks normal and Batch edit, Seed, + Add Studio Time, rate typing, the lock pills, and Complete WO are all still there and working. This is the most important check in the batch — the runner build must not have changed the office side.',
      },
      {
        id: 'rwo-live', area: 'Runner WO', device: 'phone',
        what: 'THE BIG ONE — office edits appear live while the runner has the work order open',
        how: 'Two screens: the work order open on the phone (day sheet open), the SAME work order open on a computer from the calendar. On the computer, change the room rate and press Save. Within a second or two the phone\'s billing numbers should update by themselves — no refresh, no closing the sheet. Then on the phone change a time and press Update submission, and watch the computer\'s table update.',
      },
      {
        id: 'rn-pill', area: 'Runner', device: 'phone',
        what: 'The session pill on the hub answers "have I turned in today?"',
        how: 'On the studio hub, a session you have not submitted should show a grey "Not submitted" pill. Press Submit today inside its work order, come back — it should say "Submitted" in amber, live. When the office approves the day, it turns green "Approved".',
      },
      {
        id: 'awo-cards', area: 'Work Orders', device: 'desktop',
        what: 'The office also gets the card view, with editable rates in the sheet',
        how: 'On a work order, find the same list/cards toggle above Studio Time and switch to cards. Click a day card — in the sheet\'s Billing box you SHOULD be able to type rates (unlike the runner). Change one, press Done, then Save, and confirm it stuck.',
      },
      {
        id: 'run-daypart', area: 'Runner', device: 'phone',
        what: 'The app greets you by time of day, not always "tonight"',
        how: 'Open the runner app and look at the studio picker heading and the duties section on the hub. Before noon they should say "this morning"; midday through late afternoon "today"; evening "tonight". Check whichever applies right now.',
      },
    ],
  },
  {
    id: 'runner-dailyops-2026-08-14',
    title: 'The runner app, missed punches, and the new Daily Ops page',
    version: 'v1.10.0 (preview branch)',
    date: 'Aug 14, 2026',
    intro:
      'A lot changed for runners: the app remembers which studio you are at, the office can leave tasks, shift notes move off Slack, and you can report a missed punch. Managers get a new Daily Ops page for reviewing last night. Nothing here emails anybody or charges anything. Phone items are best done on an actual phone.',
    items: [
      {
        id: 'rn-remember', area: 'Runner', device: 'phone',
        what: 'The app remembers your studio instead of asking every time',
        how: 'Open the runner app. If it asks where you are, tap a studio. Now close the app fully and open it again — it should go straight into that studio, no picker. Report it if it asks again.',
      },
      {
        id: 'rn-switch', area: 'Runner', device: 'phone',
        what: 'You can switch studios from the top of the hub',
        how: 'On the studio hub, look top right for four small buttons: PRS, ARS, ERS, TRK. Tap a different one. You should land on that studio straight away, with its own sessions.',
      },
      {
        id: 'rn-back-picker', area: 'Runner', device: 'phone',
        what: 'The back arrow returns you to the studio picker',
        how: 'On the studio hub, tap the ← arrow at the top left. You should get the "Where are you tonight?" screen. Pick a studio again to carry on.',
      },
      {
        id: 'rn-task', area: 'Runner', device: 'phone',
        what: 'A task left by the office appears at the top of the hub, and can be checked off',
        how: 'First, on a computer, open Daily Ops and use the "Studio tasks" box at the bottom left to add a task for your studio. Then on the phone, open that studio hub — the task should be at the very top, above the sessions. Tap the circle beside it. It should tick green and cross out.',
      },
      {
        id: 'rn-session-card', area: 'Runner', device: 'phone',
        what: 'Session cards look like the calendar cards',
        how: 'On a studio hub with a session today, look at the card. It should be coloured like the calendar (green for confirmed, amber for a hold), with the artist or client name, the times, and a red COD strip along the bottom if the session is COD. Report it if a COD session shows no red strip.',
      },
      {
        id: 'rn-shift-log', area: 'Runner', device: 'phone',
        what: 'Shift notes save as a log, and a second person can add to the same night',
        how: 'On the hub, tap "Shift notes". Type a few lines, put your initials in the small box, and tap "Add to log". It should appear below with your initials and the time. Now add a SECOND entry with different initials. Both should be listed, oldest first.',
      },
      {
        id: 'rn-checklist-look', area: 'Runner', device: 'phone',
        what: 'The checklists still work after the redesign',
        how: 'Open the opening or closing checklist. Tap a few items — each should turn green immediately with no save button. Type something in the notes box at the bottom. Leave the page and come back: your ticks and your note should still be there.',
      },
      {
        id: 'rn-mics', area: 'Runner', device: 'phone',
        what: 'Mic inventory Here / Room / Missing still works',
        how: 'Open Mic inventory, open a section, and tap HERE on a mic (it fills green), then ROOM on another (it fills blue and offers rooms — pick one), then MISS on a third (it fills red). Add your initials and Submit. Report anything that will not change colour when tapped.',
      },
      {
        id: 'pn-submit', area: 'Punches', device: 'phone',
        what: 'A missed punch can be reported from the runner hub',
        how: 'On the studio hub, scroll to the bottom and tap "Missed a punch?". Pick the shift, pick what was missed (clock in / clock out / meal out / meal in), type a time like 6:00 PM, and submit. You should see a confirmation, and the report should appear in "Your last 90 days" underneath. NOTE: if this device is on the shared runner login it will say personal logins are coming — that is correct, report it only if you are on your own login.',
      },
      {
        id: 'pn-queue', area: 'Punches', device: 'desktop',
        what: 'A submitted punch reaches the manager queue and can be approved',
        how: 'On a computer, open Punches in the HR section of the left menu. The report from the previous step should be at the top under "Punch queue". Press Approve. It should move down to "Enter in ADP" with a sentence ready to copy.',
      },
      {
        id: 'pn-record', area: 'Punches', device: 'desktop',
        what: 'The record shows counts per person, colour-coded',
        how: 'On the Punches page, scroll to "The record · last 90 days". Every staff member should be listed with a coloured dot — green if they have no misses, amber for one or two, red for three or more. Report anyone showing a percentage; there should not be one.',
      },
      {
        id: 'do-queue', area: 'Daily Ops', device: 'desktop',
        what: 'Last night\'s problems are listed, and clearing one sticks',
        how: 'Open Daily Ops from the Operations section of the left menu. The left column lists anything that needs you from last night. Click an item — it should tick green and cross out. Now reload the page: it should STILL be crossed out. Report it if it comes back.',
      },
      {
        id: 'do-missing', area: 'Daily Ops', device: 'desktop',
        what: 'A checklist that was never submitted shows up as a problem',
        how: 'On Daily Ops, look for any red item saying a checklist "never submitted". Cross-check one against the studio card on the right — that duty should have a red dot and say "never submitted". This is the main thing the page exists for, so report it if a studio that clearly did nothing last night looks clean.',
      },
      {
        id: 'do-sweep', area: 'Daily Ops', device: 'desktop',
        what: 'Each studio card shows last night, and the shift log opens',
        how: 'On the right of Daily Ops there are four studio cards. Each lists opening, closing, mic inventory, petty cash and stock with a coloured dot and a time or a note. If a studio has shift notes, click the grey shift-log box on its card — a window should open with the full night, each entry showing who wrote it and when.',
      },
      {
        id: 'do-add-task', area: 'Daily Ops', device: 'desktop',
        what: 'You can leave a task for tonight\'s opener',
        how: 'Bottom left of Daily Ops, choose a studio from the small dropdown, type a task, press Add. It should appear in the list immediately — and on that studio\'s runner hub on a phone.',
      },
      {
        id: 'ui-cards', area: 'Dashboard', device: 'desktop',
        what: 'Room cards are all the same size whether or not there is a session',
        how: 'On the dashboard, look at "Today\'s sessions". Every room card should be exactly the same height — a row with a booking in it must not be taller than the rows around it. Also check the date arrows sit on the same line as the "TODAY\'S SESSIONS" heading.',
      },
      {
        id: 'ui-lead-dates', area: 'CRM', device: 'desktop',
        what: 'Session dates on a lead are fully visible',
        how: 'Open CRM, click any lead, and look at the Session box. The session date should read in full (like 08/16/2026), not cut off part way. Everything should be in the same place it was before.',
      },
      {
        id: 'sec-access', area: 'Security', device: 'desktop',
        what: 'Everything you normally do still saves after the permissions clean-up',
        how: 'IMPORTANT — this is the highest-risk item in the batch. Do your ordinary work for a few minutes: open a lead and change something, open a work order and save it, tick a task, open Billing. Everything should save silently. If you see a red "NOT saved" message anywhere, stop and report exactly which screen and which action.',
      },
    ],
  },
  {
    id: 'wo-pdf-2026-08-13',
    title: 'The work order PDF, and buttons that used to do nothing',
    version: 'v1.9.1 (preview branch)',
    date: 'Aug 13, 2026',
    intro:
      'Downloading a work order now produces a document that looks like the work order. Several controls that appeared to work but quietly did nothing have also been fixed. Downloading is safe — it saves a file to your own computer and emails nobody. Do all of this on a work order you do not mind editing.',
    items: [
      {
        id: 'wp-looks', area: 'Billing',
        what: 'A downloaded work order looks like the work order on screen',
        how: 'Open Billing, find any line with an invoice attached, and use Download (or open a work order and press Save & download). Open the file. It should have the Paramount letterhead, then the client details, then a Studio Time table with the same columns as the screen — Studio, Date, Session Info, From, To, Hrs, Type, Rate, OT, Total — then rentals, notes, payments and the totals. Report it if it looks like a plain invoice instead.',
      },
      {
        id: 'wp-session-info', area: 'Billing',
        what: 'A long Session Info prints in full, not cut off',
        how: 'Open a work order. In Studio Time, click a Session Info cell and type several song names — enough that it is clearly too long for the box. Save, then download. On the PDF that line should be fully readable, wrapped onto as many lines as it needs. Report ANY text that is cut off.',
      },
      {
        id: 'wp-internal', area: 'Billing',
        what: 'Internal notes never appear on the PDF',
        how: 'On the same work order type something obvious like "INTERNAL TEST" into Booking Notes AND into Needs Attention / Runner Notes. Save and download. Search the PDF for that text. It must not appear anywhere. This one matters — clients receive this file.',
      },
      {
        id: 'wp-blank', area: 'Billing',
        what: 'Generate WO makes a blank form you can type into',
        how: 'On the Billing page click the ⋯ at the top right, beside the Billing / COD switch. Choose "Generate WO". A blank work order downloads. Open it and try clicking into the Client box and typing — it should accept text. Then check the calendar: NOTHING new should have appeared on it.',
      },
      {
        id: 'wp-studio-code', area: 'Billing',
        what: 'The PDF names the venue, not just the room letter',
        how: 'On any downloaded work order look at the Studio column in Studio Time. It should read like "PRS A", "ARS B" or "TRS North" — never a bare "A".',
      },
      {
        id: 'wp-approve', area: 'Billing',
        what: 'Approve works on an invoice that was edited after invoicing',
        how: 'Find a line on In progress showing "Changed since invoiced" in the flag column (or make one: attach an invoice, then open the work order and change a rate). Press Approve. The line should move on. Report it if you press Approve and absolutely nothing happens.',
      },
      {
        id: 'wp-complete', area: 'Work order',
        what: 'Complete WO saves and closes in one press',
        how: 'Open a work order, change something small — a session note is fine — and press Complete WO. It should save AND close, without asking you anything and without you needing to press Close afterwards.',
      },
      {
        id: 'wp-dirty', area: 'Work order',
        what: 'Editing notes un-greys Complete WO',
        how: 'Open a work order that is already completed. Complete WO should be greyed out. Now type into Session Notes. It should become pressable. Try the same with Print Name and with Needs Attention.',
      },
      {
        id: 'wp-equipment', area: 'Work order',
        what: 'Equipment can be set on every day, not just the first',
        how: 'Open a work order covering more than one day (add a second day in Studio Time if you need to, and save). Each day now has its own EQUIPMENT line. Tap an item on the SECOND day, and the third. Every day must respond. Report any day where tapping does nothing — that was a real bug: days added after the work order was created had no equipment behind them.',
      },
      {
        id: 'wp-dblclick', area: 'Billing',
        what: 'Double-clicking a button does not also open the work order',
        how: 'On the Billing list, double-click directly on a row button — Approve, Mark sent or Attach invoice. The button should do its job and the work order should NOT open behind it. Double-clicking empty space on the row should still open it.',
      },
      {
        id: 'wp-warn-rate', area: 'Work order',
        what: 'A warning appears when an engineer has hours but no rate',
        how: 'Open a work order with a 1ST engineer line. Clear the rate on that line. A red bar should appear near the top saying the line will bill $0. Now switch that line to 2ND (assistant) — the warning should disappear, because assistants are never rated.',
      },
      {
        id: 'wp-warn-dupe', area: 'Work order',
        what: 'A warning appears when the same person is on two lines for one day',
        how: 'Open a work order, note who is on the engineer line for a day, then press "+ Add Engineer" and give the new line the SAME name and the same times. A red bar should appear at the top saying they will be charged twice. Delete the extra line and it should go away.',
      },
      {
        id: 'wp-top-buttons', area: 'Work order',
        what: 'The buttons and the warning bar are at the TOP',
        how: 'Open any work order. Cancel, Complete WO, Close, Save & download and Delete should all be near the title at the top, and stay visible as you scroll down the work order. Report it if they are still at the bottom.',
      },
      {
        id: 'wp-grouping', area: 'Work order',
        what: 'Studio Time groups each day with its engineer or assistant',
        how: 'Open a work order with a few days on it. Each day and the staff line under it should sit together in one shaded block, with a clear gap before the next day. There should be no stripey alternating rows, and no square corners meeting rounded ones.',
      },
      {
        id: 'wp-eq-day', area: 'Work order',
        what: 'Equipment is now a line inside each day, and tapping changes its colour',
        how: 'Open a work order with a few days on it. Under each day\'s staff line there is an EQUIPMENT line with Speakers, Microphone and Console. Tap Speakers once — it should turn GREEN. Tap it again — RED, and a box should open asking what was wrong. Tap once more — back to green. Report it if tapping only moves a small dot and the pill does not change colour.',
      },
      {
        id: 'wp-eq-blank', area: 'Work order',
        what: 'An untouched equipment item cannot be put back to blank',
        how: 'Find a day where an item has never been tapped — it looks grey and faded. Tap it a few times. It should move between green and red only, and never return to the faded state. That is deliberate: faded means nobody has checked it.',
      },
      {
        id: 'wp-eq-note', area: 'Work order',
        what: 'A Not OK note saves and is still there when you come back',
        how: 'Set an item to Not OK, type a sentence in the box, press Done, then close the work order and re-open it. The item should still be red and the note still there. If you have the runner app open on that session, check the same note appears there too.',
      },
      {
        id: 'wp-po-chip', area: 'Work order',
        what: 'The PO box has a "Not req\'d" button inside it',
        how: 'Look at the PO # box at the top. At its right-hand end is a small "Not req\'d" button. Press it — it should fill in and the PO field should stop accepting typing. Press again to undo. There should be no separate PO Yes/No switch anywhere.',
      },
      {
        id: 'wp-header-sticky', area: 'Work order',
        what: 'The title and buttons stay on screen while you scroll',
        how: 'Open a work order long enough to scroll. Scroll to the bottom. The title and the Cancel / Complete WO / Save buttons should stay visible the whole way down.',
      },
      {
        id: 'wp-billing-title', area: 'Billing',
        what: 'Billing and COD are both in the page title, each with a count',
        how: 'Open Billing. The big heading should read "Billing" and "COD" side by side, each followed by a number, with the one you are on at full strength. Click COD — they swap. If any COD session has money outstanding, COD\'s number should be red.',
      },
      {
        id: 'wp-runner-hub', area: 'Runner', device: 'phone',
        what: 'The runner studio page has the new look and still works',
        how: 'On a phone, open the Runner hub and pick a studio. The room name should be large at the top of each session card, cards should be soft rounded blocks with no outlines, and the tiles below (Opening, Closing, Mic inventory, Petty cash, Stock) should show "Submitted" or "Not started". Tap a session — it must still open its work order.',
      },
    ],
  },
  {
    id: 'billing-2026-08-12',
    title: 'Billing — the new hub, and the work order buttons',
    version: 'v1.9.0 (preview branch)',
    date: 'Aug 12, 2026',
    intro:
      'The old WO Hub is gone and Billing has taken its place in the left menu. This is where every work order and invoice now lives — it replaces the Dropbox folders entirely. Nothing you do here emails a client; the furthest anything goes is downloading a PDF to your own computer. NOTE: do NOT use the Download button on a real invoice yet — the PDF layout is still being rebuilt, and pressing Download saves a copy of it.',
    items: [
      {
        id: 'bh-tabs', area: 'Billing',
        what: 'The Billing page opens on In progress, with a Billing / COD switch at the top right',
        how: 'Click Billing in the left menu. You should land on a tab called "In progress". Top right, beside the Billing heading, there is a two-part switch: Billing and COD. Click COD — the tabs below should change to Balance due, Needs review, Paid.',
      },
      {
        id: 'bh-lights', area: 'Billing',
        what: 'Each line shows three lights — Reviewed, Invoiced, Approved — with one amber',
        how: 'On the In progress tab, look at any line in the Progress column. You should see three small labels in a row. Green means done, amber means that is the step being waited on, grey means not yet. Report it if a line shows no lights at all.',
      },
      {
        id: 'bh-dblclick', area: 'Billing',
        what: 'Double-clicking a line opens the work order',
        how: 'Double-click anywhere on a line that has an amber REVIEWED light. The work order should open. Close it again.',
      },
      {
        id: 'bh-meta', area: 'Billing',
        what: 'Each line shows the real date range and room, not a raw date',
        how: 'Look at the client column. After the artist name you should see something like "Aug 5–8 · B". Find a session you know ran more than one day and check the range covers all of it. Report anything showing a date like 2026-08-05.',
      },
      {
        id: 'bh-attach', area: 'Billing',
        what: 'Dragging a PDF onto a line attaches it as the invoice',
        how: 'Find a line whose flag column says "Drop invoice here". Drag any PDF from your computer onto that line and release. The line should turn green while you hover, and afterwards the INVOICED light should go green.',
      },
      {
        id: 'bh-approve-block', area: 'Billing',
        what: 'Approve is greyed out until the PO is answered',
        how: 'On a billing line that has just had an invoice attached, look at the far right. If the flag column says AWAITING PO, the Approve button should be there but greyed and unclickable. Hover it — a message should explain that the PO goes on the work order.',
      },
      {
        id: 'bh-no-po', area: 'Work order', device: 'desktop',
        what: 'The work order has a "PO req\'d — Yes / No" switch beside the PO number',
        how: 'Double-click that same line to open the work order. Near the top, beside "Inv #" and "PO #", there should be a small Yes / No switch labelled PO req\'d. Press No, then Complete WO. Back on the Billing page the AWAITING PO flag should be gone and Approve should now be clickable.',
      },
      {
        id: 'bh-approve', area: 'Billing',
        what: 'Approving moves the line on and turns the third light green',
        how: 'Click Approve on that line. The APPROVED light should go green and the button should change to Download. (Only Eli and Adam-Mike will see an Approve button at all — if you are anyone else, check that you do NOT see one and report if you do.)',
      },
      {
        id: 'bh-package', area: 'Billing',
        what: 'Double-clicking an invoiced line opens the package window with tabs',
        how: 'Double-click a line that has an invoice attached. A wide window should open with a Work order / Invoice switch at the top. Click Invoice — the PDF you attached should appear. Click Work order — the work order should appear. Close it.',
      },
      {
        id: 'bh-more', area: 'Billing',
        what: 'The ⋯ at the end of a line opens a menu that actually does something',
        how: 'Find a line with an invoice attached and click the ⋯ at the far right edge. A small menu should open listing "Open the attached invoice PDF" and, further along the process, "Pull it back". If clicking ⋯ does nothing at all, report it.',
      },
      {
        id: 'bh-search', area: 'Billing',
        what: 'Search finds things in every tab, not just the one you are on',
        how: 'Type a client name into the search box. Results should appear even for invoices that are Paid or in another tab, and each result should say which bucket it lives in. Clear the search and you should be back where you were.',
      },
      {
        id: 'bh-paging', area: 'Billing',
        what: 'In progress shows 20 per page, the other tabs show 10',
        how: 'Look at the bottom left of the list on In progress — it should read something like "1–20 of 24". Switch to Paid and it should count in tens.',
      },
      {
        id: 'bh-buttons-flat', area: 'Billing',
        what: 'The buttons on the lines are small and flat, not big floating bubbles',
        how: 'Look at any Approve, Download or Mark paid button on a line. It should be a small flat pill sitting neatly in the last column, level with the rest of the row. Report anything that looks raised, oversized, or floating between two rows.',
      },
      {
        id: 'wo-close-quiet', area: 'Work order', device: 'desktop',
        what: 'Closing a work order you did not change just closes it',
        how: 'Open any work order, change nothing, and press Close. It should close immediately with no questions asked.',
      },
      {
        id: 'wo-close-prompt', area: 'Work order', device: 'desktop',
        what: 'Closing a work order you DID change asks what to do',
        how: 'Open a work order, change something (a rate, a time, the notes), then press Close. You should be asked: save changes and close / discard my changes / keep editing. Press "Discard my changes", reopen it, and check your change is gone.',
      },
      {
        id: 'wo-complete-grey', area: 'Work order', device: 'desktop',
        what: 'On a completed work order, Complete WO is greyed until you change something',
        how: 'Open a work order that has already been completed. The Complete WO button should be greyed out. Change any field — it should become clickable. Press it: it should save AND close in one go, with no follow-up question.',
      },
      {
        id: 'wo-no-print', area: 'Work order', device: 'desktop',
        what: 'The Print button is gone and Export PDF is now Save & download',
        how: 'Open any work order and look at the bottom row of buttons. There should be no Print button. Where Export PDF used to be it should now say "Save & download".',
      },
      {
        id: 'bh-nav', area: 'Billing',
        what: 'The old WO Hub is no longer in the menu',
        how: 'Look down the left menu. There should be a Billing item and no WO Hub item.',
      },
    ],
  },
  {
    id: 'my-day-2026-08-10',
    title: 'My Day — your daily checklist',
    version: 'v1.8.0 (preview branch)',
    date: 'Aug 10, 2026',
    intro:
      'New: a daily checklist of the things your role is responsible for. It shows on the dashboard (short list) and on a new "My Day" page in the left menu (the full version, with holds, balances and shift notes). The Flo box at the top of the dashboard now writes a real briefing from it instead of the made-up example text. Only Fernando, Aaron and Eli have this. Ticking things is safe — nothing is sent anywhere and you can untick.',
    items: [
      {
        id: 'md-dash-list', area: 'Dashboard', device: 'desktop',
        what: 'The "My day — duties" box on the dashboard lists real duties, not the old example ones',
        how: 'Open the dashboard. The My Day box should list your actual duties (studio check-ins, timecards, and so on). If you still see "Morning briefing reviewed" or "Sign vendor invoices", that is the OLD placeholder text — report it.',
      },
      {
        id: 'md-tick', area: 'Dashboard', device: 'desktop',
        what: 'Ticking a duty sticks after a refresh',
        how: 'Click a duty so it goes green and crosses out. Refresh the page. It should still be ticked. Click it again to untick, refresh again, and it should stay unticked.',
      },
      {
        id: 'md-count', area: 'Dashboard', device: 'desktop',
        what: 'The little count next to "My day — duties" matches what you ticked',
        how: 'Note the count (like "2 of 8"). Tick one more duty. The first number should go up by one straight away.',
      },
      {
        id: 'md-number', area: 'Dashboard', device: 'desktop',
        what: 'Duties that ask for a number show a small box once ticked, and it saves',
        how: 'Tick "ADP runner timecards" (Fernando) or "Approve Ramp transactions" (Aaron). A small number box appears. Type a number, click elsewhere, then refresh. The number should still be there.',
      },
      {
        id: 'md-page', area: 'My Day page', device: 'desktop',
        what: 'The "My Day" item in the left menu opens the full page',
        how: 'Click "My Day" in the left menu, just under Dashboard. You should get a page headed My Day with your duties on the left and holds, notes and other boxes on the right.',
      },
      {
        id: 'md-sync', area: 'My Day page', device: 'desktop',
        what: 'Ticking on one screen shows on the other without refreshing',
        how: 'Open the dashboard in one browser tab and My Day in another. Tick a duty on the My Day page, then look at the dashboard tab WITHOUT refreshing it. It should tick itself within a few seconds.',
      },
      {
        id: 'md-weekly', area: 'My Day page', device: 'desktop',
        what: 'Weekly duties only appear on their own day',
        how: 'Fernando: Valley checks should ONLY appear on Tuesdays and Fridays, Office stock ONLY on Wednesdays. On any other day they should not be in the list at all. Report if they show up on the wrong day.',
      },
      {
        id: 'md-notes', area: 'My Day page', device: 'desktop',
        what: 'Shift notes save on their own',
        how: 'Type something into Session notes on the My Day page. Wait about two seconds, then refresh. Your text should still be there. You should not have to press save.',
      },
      {
        id: 'md-billing-peek', area: 'My Day page', device: 'desktop',
        what: 'Fernando sees a read-only billing summary; Aaron does not',
        how: 'On My Day as Fernando (or use the Manager/Billing switch if you are Eli), there should be a "Billing — this period" box with four numbers and no buttons. Switch to Billing — that box should be replaced by a Balances list. Report if the numbers look obviously wrong.',
      },
      {
        id: 'md-flo', area: 'Dashboard', device: 'desktop',
        what: 'The Flo briefing describes real things, not the old sample sentences',
        how: 'Read the Flo box at the top of the dashboard. It should mention real counts. If it still says "Aaron missed the AR follow-up queue again" or mentions Kestrel and Harbor, that is the OLD example text — report it.',
      },
      {
        id: 'md-grid', area: 'Dashboard', device: 'desktop',
        what: 'The 14-day staff grid is not a wall of red',
        how: 'Eli only. Look at the "Staff — 14 days" grid. Because this is brand new, most squares should be blank or green — NOT a block of red. A wall of red means it is counting days before My Day existed. Report it.',
      },
      {
        id: 'md-wo-times', area: 'Work orders', device: 'desktop',
        what: 'A work order will not complete while a time is blank',
        how: 'Open any work order. Clear the To time on a studio time row. Click Complete WO. It should refuse, show a red message naming the row, and tint that row. Put the time back and Complete should work normally.',
      },
      {
        id: 'md-wo-runner', area: 'Runner', device: 'phone',
        what: 'The runner is warned about blank times but can still save',
        how: 'On your phone, open a work order from the runner hub. Clear a From or To time. A red message should appear above the buttons naming the row. Save should STILL work — report it if Save is blocked.',
      },
      {
        id: 'md-wo-totals', area: 'Work orders', device: 'desktop',
        what: 'Work order totals are unchanged',
        how: 'IMPORTANT — this is the regression check. Open a work order that has an engineer and a rental. Check Studio Total, Engineer Total, Rentals, Grand Total and Balance Due are the same figures you would expect. The code behind these moved; the numbers should not have.',
      },
      {
        id: 'md-themes', area: 'My Day page', device: 'desktop',
        what: 'The My Day page looks right in both light and dark mode',
        how: 'On the My Day page, switch theme with the sun/moon at the bottom of the left menu. Check nothing is unreadable, invisible, or a strange colour in either mode.',
      },
    ],
  },
  {
    id: 'soft-rail-dash-2026-08-10',
    title: 'New look — side menu, dashboard, softer style',
    version: 'v1.7.0 (preview branch)',
    date: 'Aug 10, 2026',
    intro:
      'Big visual update: the menu moved from the top to the LEFT side, the dashboard is rebuilt, and the whole app has a softer, flatter look. How things WORK has not changed — if something stops saving or a number is wrong, shout. The "My Day" checklist and the Flo briefing on the dashboard are PREVIEW content — the items in them are not real yet. Do every item in light AND dark mode (toggle is at the bottom of the left menu now).',
    items: [
      {
        id: 'rail-links', area: 'Menu', device: 'desktop',
        what: 'Every item in the left menu opens a page (some say "Coming soon" — that is expected for Daily Ops, Punches, Hiring, Training)',
        how: 'Click every item in the left menu top to bottom. Report any that error, or land somewhere that looks broken rather than a page or a "Coming soon" card.',
      },
      {
        id: 'rail-mobile', area: 'Menu', device: 'phone',
        what: 'On a phone there is a top bar with a ≡ button that slides the menu in from the left',
        how: 'Open the app on your phone. Tap ≡ top right. The menu should slide in; tapping a link should close it and go there. Report if the menu will not open or will not close.',
      },
      {
        id: 'dash-pipeline', area: 'Dashboard', device: 'desktop',
        what: 'The big PIPELINE number matches how many leads need action in the CRM, and clicking it opens the CRM',
        how: 'Note the Pipeline number on the dashboard, then open CRM → Needs Action and compare the count. Click the Pipeline block — it should land you in the CRM.',
      },
      {
        id: 'dash-inqbar', area: 'Dashboard', device: 'desktop',
        what: 'A new web inquiry makes a red pulsing "NEW INQUIRY" bar appear in the Pipeline block without refreshing',
        how: 'Have someone submit the public inquiry form while you watch the dashboard. The red bar should appear on its own. Open the lead in the CRM; the bar should clear once the lead is moved off uncontacted.',
      },
      {
        id: 'dash-studios', area: 'Dashboard', device: 'desktop',
        what: 'The four studio cards (PRS/ARS/ERS/TRK) show the right session counts for today',
        how: 'Compare each card’s number against the calendar for today. Flip the little ‹ › day arrows in Today’s Sessions — the room grid changes day; the studio cards follow the same viewed day.',
      },
      {
        id: 'dash-tasks-personal', area: 'Dashboard', device: 'desktop',
        what: 'My Tasks shows only YOUR tasks; adding a task assigned to someone else makes it appear on THEIR dashboard, not yours',
        how: 'Log in as yourself and read the My Tasks list — everything should be assigned to you. Add a task assigned to a teammate, then check with them (or log in as them) that it shows on their dashboard.',
      },
      {
        id: 'dash-rooms', area: 'Dashboard', device: 'desktop',
        what: 'Booked room cards open the Work Order; empty rooms start a new booking; the PRS · Nadine’s card does nothing',
        how: 'Click a booked room card (should open the WO), an empty one (should open the calendar’s new-booking flow for that room and day), and Nadine’s (should do nothing — it is display-only for now).',
      },
      {
        id: 'soft-wo', area: 'Work Order', device: 'desktop',
        what: 'The WO popup looks softer (no sunken/embossed fields) and an empty rentals or payments row shows obvious separate boxes to fill in',
        how: 'Open any WO. Add a rentals row and a payment row without typing — each should show clearly separated field chips (Qty / Item / Supplier… and type / amount / memo). Report any field you cannot tell is a field.',
      },
      {
        id: 'soft-crm', area: 'CRM', device: 'desktop',
        what: 'A lead profile fits on one screen — status, contact, session, notes, Activity, Tags and Delete all visible without scrolling',
        how: 'Open a normal lead (not one with a novel in the notes). Everything from the status pill to the Delete button should be in view. Shrink the window narrower — the session fields should stack instead of clipping.',
      },
      {
        id: 'cal-no-slab', area: 'Calendar', device: 'desktop',
        what: 'The calendar ends right after the TRACK rows — no big black empty area beneath',
        how: 'Open the calendar and scroll the grid to the bottom. The page should end at the last studio row. Report any large dead space below it.',
      },
    ],
  },
  {
    id: 'carved-cal-wo-2026-08-06',
    title: 'New look — calendar and work orders',
    version: 'v1.6.0 (preview branch)',
    date: 'Aug 6, 2026',
    intro:
      'The calendar and the work order have both been rebuilt to match the new look. Nothing about how they WORK has changed — so if something stops saving, or a number comes out wrong, that is a real bug and worth shouting about. Admin, the WO list and the runner still look the old way; that is expected. Please do every item TWICE — once in light mode and once in dark (sun/moon icon, top right).',
    items: [
      {
        id: 'cal-card-full', area: 'Calendar', device: 'desktop',
        what: 'A normal session card shows the artist, the client, the times, and a bottom strip with the invoice number and staff initials',
        how: 'Open the calendar on a day with a booked session. Read the card top to bottom. Report anything cut off mid-word, or any field you expected and cannot see.',
      },
      {
        id: 'cal-cod-bar', area: 'Calendar', device: 'desktop',
        what: 'COD sessions have a red bar across the bottom of the card; billing sessions have nothing',
        how: 'Find a COD session and a billing session. The COD one should have a red strip at the very bottom naming the payment method. The billing one should have no payment marking at all. Report a red bar on a billing session immediately.',
      },
      {
        id: 'cal-block-no-cod', area: 'Calendar', device: 'desktop',
        what: 'Tech work, tour and open-hours blocks have no red bar',
        how: 'Find a Tech Work, Tour or Open Hours block on the calendar. It must have no red strip and no payment text. A red bar there would mean money to collect that does not exist.',
      },
      {
        id: 'cal-status-colours', area: 'Calendar', device: 'desktop',
        what: 'Each status is its own colour',
        how: 'Check one of each you can find: Confirmed = green, Tentative = amber, Cancelled = red, Tour = light blue, Tech Work = light purple, Open Hours = grey. Report any two that look the same, and especially anything green that is not confirmed.',
      },
      {
        id: 'dash-matches-cal', area: 'Dashboard', device: 'desktop',
        what: 'The room cards on the dashboard look the same as the calendar cards',
        how: 'Open the dashboard, note a booked room card, then open the calendar and find the same session. Apart from the room name at the top of the dashboard card, they should be identical — same colour, same layout, same strip at the bottom.',
      },
      {
        id: 'cal-two-sessions', area: 'Calendar', device: 'desktop',
        what: 'Two sessions in one room on one day both stay readable and the row does not get taller',
        how: 'Find (or make) a day where one room has two sessions. Both cards should share the normal row height, both should still show the name and times, and the row should be the same height as every other row. Report a row that has grown taller than its neighbours.',
      },
      {
        id: 'cal-pinch-zoom', area: 'Calendar', device: 'desktop',
        what: 'Pinching on the trackpad spreads the days apart and squeezes them together',
        how: 'On the calendar, pinch out and in on the trackpad. Days should get wider and narrower smoothly. The leftmost day should stay put rather than the grid sliding sideways. Report drifting.',
      },
      {
        id: 'cal-month-rail', area: 'Calendar', device: 'desktop',
        what: 'The month name stays stuck to the left edge while you scroll through that month',
        how: 'Scroll the calendar sideways across a month boundary. The month name in the thin band at the top should stay pinned at the left, then get pushed off by the next month. Report it scrolling away immediately.',
      },
      {
        id: 'wo-open-save', area: 'Work order', device: 'desktop',
        what: 'A work order opens, edits and saves normally',
        how: 'Open a work order from the calendar. Change something small — a note, a rate. Press Close & Save. Re-open it and confirm the change stuck. This is the most important item on the list.',
      },
      {
        id: 'wo-studio-table', area: 'Work order', device: 'desktop',
        what: 'The studio time table lines up and nothing is cut off',
        how: 'Look at the Studio Time table. Every column heading should sit directly above its values. Times should read in full ("10:00 AM", not "10:00 A"). Staff names should not be chopped. Report any column where the heading and the values do not line up.',
      },
      {
        id: 'wo-table-typing', area: 'Work order', device: 'desktop',
        what: 'Typing in a table cell works and the cell highlights while you are in it',
        how: 'Click into a rate or a time in the Studio Time table. The cell should shade slightly while hovered and a shade more while you are typing in it. At rest it should be plain text with no box around it. Report any resting cell that has a box or bubble.',
      },
      {
        id: 'wo-meta-row', area: 'Work order', device: 'desktop',
        what: 'Invoice #, PO # and Food sit on one line and all work',
        how: 'Near the top left, find the row with Inv #, PO # and Food. Type in each. Switch Food to Yes — a dollar box should appear beside it. Type a number, switch back to No, then to Yes again. The number should still be there.',
      },
      {
        id: 'wo-status-colour', area: 'Work order', device: 'desktop',
        what: 'The status buttons sit in one rounded housing and the selected one fills with its colour',
        how: 'At the top of the work order, click through Confirmed, Tentative and Cancelled. They should all sit inside a single rounded strip, and the selected one should press IN and fill with its own colour (green, amber, red). Report separate floating buttons.',
      },
      {
        id: 'wo-buttons', area: 'Work order', device: 'desktop',
        what: 'Close & Save is at the top right; Export PDF, Print and Delete are at the bottom',
        how: 'Look at the top right of the work order — it should have Cancel and a large white Close & Save. Scroll to the bottom — Export PDF, Print and Delete should be there. Report either one appearing in both places.',
      },
      {
        id: 'wo-print', area: 'Work order', device: 'desktop',
        what: 'Printing a work order produces a plain document, not a screenshot of the app',
        how: 'Open a work order and press Export PDF. In the print preview: the page should not be blank, there should be no coloured pills or shadows, and Open/Completed should not appear anywhere. Report a blank preview immediately.',
      },
      {
        id: 'wo-block-buttons', area: 'Work order', device: 'desktop',
        what: 'Tech work, tour and open-hours blocks have no Complete WO and no Export PDF',
        how: 'Open a Tech Work, Tour or Open Hours block from the calendar. The footer should have no Complete WO button and no Export PDF — there is no work order to complete or print.',
      },
      {
        id: 'theme-default-dark', area: 'Whole app', device: 'desktop',
        what: 'A device that has never been used opens in dark mode',
        how: 'Open the app in a private/incognito window. It should be dark. Then in your normal window, if you had picked light before, it should still be light — your choice is not overridden.',
      },
      {
        id: 'splash-light', area: 'Login', device: 'desktop',
        what: 'The welcome screen after login matches the app, in both themes',
        how: 'Switch to light mode, sign out, sign back in. The full-screen welcome should be the same warm paper colour as the app. Report any blue or pink tint — that is the old design showing through.',
      },
      {
        id: 'inquiry-email', area: 'Inquiry', device: 'desktop',
        what: 'A new web inquiry emails info@paramountrecording.com',
        how: 'Open the public inquiry form and submit a test with your own name. Within a minute an email titled "New inquiry — [name]" should arrive at info@. Check spam if not. Then confirm the same lead is in the CRM under Needs Action — BOTH must happen.',
      },
      {
        id: 'inquiry-reply', area: 'Inquiry', device: 'desktop',
        what: 'Replying to that email goes to the customer, not to ourselves',
        how: 'Open the inquiry email and press Reply. The To field should be the address the person typed into the form, not info@paramountrecording.com.',
      },
      {
        id: 'runner-signout', area: 'Runner', device: 'phone',
        what: 'You can sign out of the runner app',
        how: 'Open the Runner app on a phone. On the studio-picker screen, scroll to the bottom — there should be a Sign out button under the four studios. Press it. You should land on the login screen.',
      },
      {
        id: 'light-mode-wo', area: 'Work order', device: 'desktop',
        what: 'In light mode, no field is a white box with a border',
        how: 'Switch to light mode (sun icon, top right) and open a work order. Every field should look pressed INTO the page, the same shape as in dark mode. Report any field that looks like a plain white box with a grey outline.',
      },
    ],
  },
  {
    id: 'carved-redesign-2026-07-30',
    title: 'New look — dashboard, daily ops, login',
    version: 'v1.6.0 (preview branch)',
    date: 'Jul 30, 2026',
    intro:
      'The app has a new look: warm paper instead of dark blue-grey, and everything is either pressed INTO the page (things that hold information) or raised OUT of it (things you press). Nothing about how the app WORKS has changed — so if a button stops doing its job, that is a real bug and worth reporting loudly. Only the dashboard, the daily-ops pop-ups, the top bar and the login screen have been done so far; CRM, the calendar, admin and the runner still look the old way. That is expected, not a fault. Please do every item TWICE — once in light mode and once in dark (sun/moon icon, top right).',
    items: [
      {
        id: 'carved-no-blue-frame', area: 'Dashboard', device: 'desktop',
        what: 'The page background matches the panels, with no leftover blue edge',
        how: 'Open the dashboard. Look at the very edges of the screen and down the right-hand side while you scroll. The background should be one continuous colour. Report any blue or grey strip, especially a thin vertical one.',
      },
      {
        id: 'carved-press', area: 'Dashboard', device: 'desktop',
        what: 'Buttons visibly sink when you hold them down',
        how: 'Press and HOLD the "+ new lead" button without letting go. It should look like it sinks into the page, and pop back out when you release. Try the same on "+ add task".',
      },
      {
        id: 'carved-room-cards', area: 'Dashboard', device: 'desktop',
        what: 'Booked rooms are coloured, empty rooms are not, and each card names the right room',
        how: 'Look at the room grid. Rooms with a session should be filled green (or purple if the session is only tentative); empty rooms should be plain and dim. Check that the room name on each coloured card matches the session you expect in that room.',
      },
      {
        id: 'carved-card-text-whole', area: 'Dashboard', device: 'desktop',
        what: 'No text is cut off on a booked room card',
        how: 'Find the busiest room card — one showing artist, client, times and 1ST/2ND initials. Check the bottom of every line of text is fully visible. Letters that hang below the line (g, y, p) must not look sliced off.',
      },
      {
        id: 'carved-nav-active', area: 'Top bar', device: 'desktop',
        what: 'The page you are on is marked in the top bar',
        how: 'Look at the top bar. The current page should sit inside a filled oval pill. Click through to CRM and back and check the pill moves with you.',
      },
      {
        id: 'carved-ops-session-card', area: 'Daily ops', device: 'desktop',
        what: 'Session blocks in the daily-ops pop-up look like the dashboard room cards',
        how: 'On the dashboard click a studio name at the top (Paramount, Encore, Ameraycan or Track) to open the daily-ops pop-up. A session in there should be a filled green block with the room name, the artist in the big heavy font, and the times underneath — the same style as the dashboard room cards.',
      },
      {
        id: 'carved-ops-signoff', area: 'Daily ops', device: 'desktop',
        what: 'RUNNER / ADMIN sign-off buttons look raised when unsigned and pressed-in when signed',
        how: 'In the same pop-up, look at the RUNNER and ADMIN buttons beside each checklist row. An unsigned one should look raised with an empty circle. A signed one should look pushed into the page and filled in. Find one of each and compare.',
      },
      {
        id: 'carved-ops-opens', area: 'Daily ops', device: 'desktop',
        what: 'Clicking a checklist row still opens it',
        how: 'Click the "Opening Checklist" row in the daily-ops pop-up. The checklist detail should open as before, with its items readable. Close it with the arrow at the top left.',
      },
      {
        id: 'carved-modals-work', area: 'Dashboard', device: 'desktop',
        what: 'Adding a task still works end to end',
        how: 'Click "+ add task", type a short task, assign it to yourself and save. It must appear in the Tasks list. Then open it and delete it. This is checking the pop-ups still FUNCTION, not how they look.',
      },
      {
        id: 'carved-flag-modal', area: 'Dashboard', device: 'desktop',
        what: 'Adding a flag still works end to end',
        how: 'Click "+ add flag", pick a studio and a category, type a short note and save. It should appear in the Flags panel. Open it and delete it afterwards.',
      },
      {
        id: 'carved-login', area: 'Login', device: 'desktop',
        what: 'The login screen matches the new look and still signs you in',
        how: 'Sign out. The login screen should be warm paper with the PRSFLO wordmark in a heavy black font, all one colour (no green or blue). Sign back in with your email and password.',
      },
      {
        id: 'carved-login-error', area: 'Login', device: 'desktop',
        what: 'A wrong password shows a red badge, not plain red writing',
        how: 'Sign out and deliberately enter the wrong password. The message should appear as a small filled red badge. Then sign in properly.',
      },
      {
        id: 'carved-dark-not-glaring', area: 'Whole app', device: 'desktop',
        what: 'Dark mode has no big bright white areas',
        how: 'Switch to dark mode (moon icon, top right) and look over the dashboard and the daily-ops pop-up. Large areas should be dark. Only small things — buttons, the count bubble, the current-page pill — may be bright cream. Report any large pale slab.',
      },
      {
        id: 'carved-mobile', area: 'Whole app', device: 'phone',
        what: 'The dashboard is still usable on a phone',
        how: 'Open the dashboard on your phone. Scroll the whole way down. Nothing should be cut off at the sides, and you should not be able to scroll sideways. Open the menu (≡) and check the links work.',
      },
      {
        id: 'carved-old-pages-ok', area: 'Whole app', device: 'desktop',
        what: 'The not-yet-updated pages still work normally',
        how: 'Visit CRM, Calendar, Admin and WO Hub. They will still look the OLD way — that is expected. You are only checking they still load and work. Report anything broken or unreadable, not the fact that they look different.',
      },
    ],
  },
  {
    id: 'auth-runner-wo-2026-07-30',
    title: 'Email login + runner work order fixes',
    version: 'v1.5.0 – v1.5.1',
    date: 'Jul 30, 2026',
    intro:
      'Two things: PIN login is gone and everyone signs in with email and password now, and the runner could not open work orders on sessions that ran more than one day. The runner items need a PHONE. Before you start, ask for a multi-day session (or one that uses two rooms in a day) to test against — a normal one-day session always worked and will not prove anything.',
    items: [
      {
        id: 'auth-no-pin-pad', area: 'Login', device: 'desktop',
        what: 'The login screen opens on email and password, with no number pad',
        how: 'Sign out. The login screen should show email and password boxes straight away. There should be no number pad and no "use PIN instead" link anywhere on it.',
      },
      {
        id: 'auth-email-login', area: 'Login', device: 'desktop',
        what: 'You can sign in with your own email and password',
        how: 'Enter your email address and your password, and sign in. You should land on the dashboard.',
      },
      {
        id: 'auth-wrong-password', area: 'Login', device: 'desktop',
        what: 'A wrong password is refused clearly',
        how: 'Sign out, then deliberately type the wrong password. It should say "Invalid email or password" and stay on the login screen. Then sign back in properly.',
      },
      {
        id: 'auth-change-password', area: 'Login', device: 'desktop',
        what: 'You can change your own password while signed in',
        how: 'While signed in, type prsflow.paramountrecording.com/reset-password into the address bar. Enter a new password twice and submit. You should land on the dashboard. Sign out and back in with the NEW password to confirm it took.',
      },
      {
        id: 'auth-runner-lands-right', area: 'Login', device: 'phone',
        what: 'A runner account lands on the runner hub, not the dashboard',
        how: 'On a phone, sign in with the runner account. It should go straight to the runner studio-select screen, not the office dashboard.',
      },
      {
        id: 'runner-wo-multiday-opens', area: 'Runner WO', device: 'phone',
        what: 'A multi-day session opens its work order from any day',
        how: 'On the phone, open the runner hub for the studio holding a multi-day session. Tap the session. The work order should open. THIS IS THE MAIN ONE — if it says "Work order not yet created — contact office", mark it Broken and write down the studio and date.',
      },
      {
        id: 'runner-wo-two-rooms', area: 'Runner WO', device: 'phone',
        what: 'A session using two rooms in one day opens from either room',
        how: 'Find a day where one booking uses two different rooms. Tap the card for each room in turn. Both should open a work order. If only one works, note which room failed.',
      },
      {
        id: 'runner-wo-right-order', area: 'Runner WO', device: 'phone',
        what: 'The work order that opens is the correct one',
        how: 'After it opens, check the client name, artist and date at the top match the session you tapped. Opening the wrong work order would be worse than opening none.',
      },
      {
        id: 'wo-mobile-nav-clear', area: 'WO on phone', device: 'phone',
        what: 'The top menu no longer covers the work order',
        how: 'On a phone, open a session from the calendar so the work order fills the screen. The PRSFlo menu bar should sit ABOVE it, not across the middle of it. Scroll down — the menu should never overlap the content.',
      },
      {
        id: 'wo-mobile-buttons-reachable', area: 'WO on phone', device: 'phone',
        what: 'Cancel and Close & Save are both fully visible at the bottom',
        how: 'Same screen. Look at the very bottom — both buttons should be completely on-screen and tappable, not cut off by the edge of the phone.',
      },
      {
        id: 'wo-mobile-no-red-line', area: 'WO on phone', device: 'phone',
        what: 'There is no red line under the work order heading',
        how: 'Open a work order for an AMERAYCAN session on a phone. Under the "Work Order · WO-xxxx" heading there should be a thin grey line, not a red one. Check a Paramount session too — both should look the same.',
      },
      {
        id: 'wo-desktop-unchanged', area: 'WO on desktop', device: 'desktop',
        what: 'The work order on a computer looks and behaves exactly as before',
        how: 'Open any work order on the computer. It should be unchanged — same size, same position, same header. This is a check that the phone fixes did not leak onto desktop.',
      },
    ],
  },
  {
    id: 'dev-tooling-2026-07',
    title: 'DEV tab + Testing tools',
    version: 'v1.4.0 – v1.4.3',
    date: 'Jul 29, 2026',
    intro:
      'The testing tools themselves, plus the DEV tab. Slightly odd to test the checklist with the checklist — that is fine, and if the tool is broken you will find out immediately. All desktop. If the floating panel misbehaves badly, mark the item Broken from the Testing page instead of the panel.',
    items: [
      {
        id: 'dev-nav', area: 'DEV tab', device: 'desktop',
        what: 'The nav item says DEV and opens with a sidebar',
        how: 'Look at the top menu — the old "Feedback" item should read DEV. Open it. There should be a list down the left: Feedback, Testing, and (on Eli\'s account only) Errors.',
      },
      {
        id: 'dev-feedback-unchanged', area: 'DEV tab', device: 'desktop',
        what: 'The feedback board still works exactly as before',
        how: 'DEV → Feedback. Submit a test entry of each type (bug, suggestion, question). It should appear in the list below immediately.',
      },
      {
        id: 'dev-errors-eli-only', area: 'DEV tab', device: 'desktop',
        what: 'Errors is visible only on Eli\'s account',
        how: 'On Eli\'s account, DEV should show an Errors section. Sign in as any other staff member — Errors should not be in the sidebar at all. Also check Admin no longer has an Errors tab.',
      },
      {
        id: 'dev-errors-copy', area: 'DEV tab', device: 'desktop',
        what: 'Errors can be copied out as text',
        how: 'DEV → Errors → click "Copy for Claude" in the header, then paste into any text box. You should get timestamps, messages, page URLs and stack traces as plain text.',
      },
      {
        id: 'test-pin', area: 'Testing', device: 'desktop',
        what: 'The Testing section is PIN-gated',
        how: 'DEV → Testing. It should ask for a PIN. Type a wrong one — it should clear and say incorrect. Type 4321 — it should open.',
      },
      {
        id: 'test-batch-cards', area: 'Testing', device: 'desktop',
        what: 'Batches show as cards with progress',
        how: 'You should see a card per batch, each with a title, a check count, and a status such as "Not started" or "12/38 tested". Not one long list of items.',
      },
      {
        id: 'test-panel-opens', area: 'Testing', device: 'desktop',
        what: 'Starting a batch opens the floating panel',
        how: 'Click "Start testing" on a batch. A small window should appear in the bottom-right showing one item at a time.',
      },
      {
        id: 'test-panel-drag', area: 'Testing', device: 'desktop',
        what: 'The panel can be dragged and stays where you put it',
        how: 'Drag the panel by the ⠿ handle at its top to a different corner. Navigate to CRM. It should still be there, in the position you left it. Try dragging it off the edge of the screen — it should stop at the edge, not disappear.',
      },
      {
        id: 'test-panel-minimise', area: 'Testing', device: 'desktop',
        what: 'The panel minimises out of the way',
        how: 'Click the ▾ on the panel. It should shrink to a small bar. Click ▴ to bring it back.',
      },
      {
        id: 'test-panel-follows', area: 'Testing', device: 'desktop',
        what: 'The panel follows you around the office app',
        how: 'With the panel open, visit Dashboard, CRM, Calendar and Admin. It should stay visible on all of them. It should NOT appear on the runner pages, and not on the login screen if you sign out.',
      },
      {
        id: 'test-next-blocked', area: 'Testing', device: 'desktop',
        what: 'Next is blocked until you pick Works or Broken',
        how: 'On a fresh item, try clicking "Next →" without picking anything. It should be greyed out and do nothing, with a line telling you to pick one. Pick Works — Next should light up.',
      },
      {
        id: 'test-prev-works', area: 'Testing', device: 'desktop',
        what: 'You can go back and change an answer',
        how: 'Click "← Prev" to return to an item you already answered. Change it from Works to Broken. Go forward and back again — the change should have stuck.',
      },
      {
        id: 'test-note-no-default', area: 'Testing', device: 'desktop',
        what: 'Typing a note does not secretly mark the item',
        how: 'On an unanswered item, type something in the notes box but do NOT click Works or Broken. Click Prev then Next to come back. The item should still be unanswered — not marked Broken.',
      },
      {
        id: 'test-counters', area: 'Testing', device: 'desktop',
        what: 'The two counters mean what they say',
        how: 'Look at the panel header: "Item N of 38" should change every time you press Prev/Next. "N done" should only change when you record a verdict.',
      },
      {
        id: 'test-resume', area: 'Testing', device: 'desktop',
        what: 'Reopening a part-finished batch resumes where you left off',
        how: 'Answer the first few items, close the panel with ×, then click "Continue" on that batch card. It should open on the first UNANSWERED item — not back at item 1.',
      },
      {
        id: 'test-review-copy', area: 'Testing', device: 'desktop',
        what: 'Failures can be copied out for a fix',
        how: 'Mark something Broken with a note. Go to the batch card → "Review results". Failures should be listed first, with your note. Click "Copy failures + notes" and paste it somewhere to check it came through.',
      },
      {
        id: 'test-live-update', area: 'Testing', device: 'desktop',
        what: 'Results appear live on another screen',
        how: 'If two people can look at once: have one record a verdict in the panel while the other watches the batch card on another computer. The progress should move without a refresh.',
      },
      {
        id: 'runner-save-offline', area: 'Runner safety', device: 'phone',
        what: 'A failed save on the runner tells you instead of pretending',
        how: 'On the phone, open a runner work order. Turn on Airplane Mode. Change a time and tap Save. You should get a red message saying NOT saved, and you should STAY on the work order — not be returned to the studio screen. Turn Airplane Mode off and save again.',
      },
      {
        id: 'sop-version-history', area: 'SOP', device: 'desktop',
        what: 'Version history shows dev notes on a click',
        how: 'Open the SOP tab → Version History. Open the newest version. At the bottom there should be a small "Dev notes — under the hood" line. Click it — it should expand without the card cutting the text off at the bottom.',
      },
    ],
  },
  {
    id: 'wo-runner-2026-07',
    title: 'Work Order + Runner App',
    version: 'v1.1.0 – v1.3.2',
    date: 'Jul 29, 2026',
    intro:
      'Everything shipped across the CRM, the Work Order and the Runner app over the last two days. Keep this checklist open on a computer. Items marked PHONE are done on your phone — do the step there, then mark it here. Items marked DESKTOP are done on the computer, in this browser. Work top to bottom: the sections build on each other, so an early failure can explain a later one. If something fails, write what you actually saw in the note, not just that it broke.',
    items: [
      // ── Runner access ──
      {
        id: 'runner-pin',
        area: 'Runner access',
        what: 'The shared runner PIN logs in and lands on studio select',
        how: 'Open the app in a private/incognito window so you are not signed in as yourself. Enter PIN 6245. You should land on the runner studio-select screen, NOT the dashboard.',
      },
      {
        id: 'runner-locked-out',
        area: 'Runner access',
        what: 'A runner cannot get into the office side of the app',
        how: 'Still signed in as the runner, type /crm on the end of the web address and press go. You should be sent straight back to the runner screens, and there should be no menu across the top.',
      },
      {
        id: 'own-login-still-works',
        area: 'Runner access',
        what: 'Normal staff login is unaffected',
        how: 'In your normal browser window, sign in with your own PIN. You should land on the dashboard and see the welcome screen as usual.',
      },

      // ── Runner work order ──
      {
        id: 'runner-wo-open',
        area: 'Runner work order',
        what: 'A session opens from the runner hub',
        how: 'Pick a studio, then tap today\'s session card. The Work Order should open. Check the card showed the STUDIO NAME as the big heading, with the artist underneath.',
      },
      {
        id: 'runner-today-toggle',
        area: 'Runner work order',
        what: 'A multi-day work order opens on today only',
        how: 'Open a work order that covers more than one day. The Studio Time table should show only today, with a button top-right reading "Today only". Tap it — it should switch to "All N days" and show every day. Tap again to go back.',
      },
      {
        id: 'runner-frozen-columns',
        area: 'Runner work order',
        what: 'Date and Studio stay visible when scrolling sideways',
        how: 'In the Studio Time table, drag the table to the left to see the far columns. The Date and Studio columns should stay put on the left. Nothing should show through or overlap them.',
      },
      {
        id: 'runner-readable',
        area: 'Runner work order',
        what: 'The table is readable at arm\'s length',
        how: 'Hold the phone normally and read a row without squinting or zooming. Numbers should be bright, not grey. Say in the note if anything is still too small.',
      },
      {
        id: 'runner-notes-sheet',
        area: 'Runner work order',
        what: 'Session notes open in front of the keyboard',
        how: 'Tap the Notes button on any row. The notes screen should fill the phone, with the title and a Save button visible at the top while the keyboard is up. Type something, tap Save, reopen it and confirm the text is there.',
      },
      {
        id: 'runner-staff-change',
        area: 'Runner work order',
        what: 'The engineer or assistant can be changed',
        how: 'Tap the initials on a staff line, then tap Change. You should see a list of staff names as tappable buttons. Tap one, then Save. The initials on the row should update.',
      },
      {
        id: 'runner-staff-typed',
        area: 'Runner work order',
        what: 'A name that isn\'t in the list can be typed',
        how: 'Open Change again and type a name that isn\'t on the list, e.g. Test Person. Save. The row should show its initials. There should be NO grey bubble floating in the middle of the screen while you type.',
      },
      {
        id: 'runner-staff-single-day',
        area: 'Runner work order',
        what: 'Changing staff affects only that day',
        how: 'On a multi-day work order, change the engineer on ONE day. Tap "All days" and check the other days kept their original engineer. There should be no option to change all days from the runner.',
      },
      {
        id: 'runner-no-duplicates',
        area: 'Runner work order',
        what: 'No duplicated rows after changing staff',
        how: 'After changing an engineer, look at each date. Each day should show its session row and at most one line per staff member. Report it if you see the same person listed twice on one date.',
      },
      {
        id: 'runner-asst-no-rate',
        area: 'Runner work order',
        what: 'Assistants show no rate or charge',
        how: 'Find a row where the staff line shows 2ND (orange). The Rate and Total cells on that staff line should be empty — not a dash, not a zero.',
      },
      {
        id: 'runner-save-works',
        area: 'Runner work order',
        what: 'Saving works and returns to the hub',
        how: 'Change a start or end time, tap Save. You should be returned to the studio screen. Reopen the work order and confirm the time stuck.',
      },
      {
        id: 'runner-save-fails-loudly',
        area: 'Runner work order',
        what: 'A failed save tells you instead of pretending',
        how: 'Turn on Airplane Mode. Change a time and tap Save. You should get a red message saying it was NOT saved, and you should STAY on the work order — not be sent back to the studio screen. Turn Airplane Mode off and save again.',
      },

      // ── Admin work order ──
      {
        id: 'admin-batch-open',
        area: 'Admin work order',
        what: 'Batch Edit opens on a multi-day work order',
        how: 'On a computer, open a work order covering several days from the calendar. In the Studio Time section header, click "Batch edit". A panel should open above the table.',
      },
      {
        id: 'admin-batch-room',
        area: 'Admin work order',
        what: 'Batch Edit changes one field across all days',
        how: 'In Batch Edit, tick ONLY Room and pick a different room. The button should read "Apply to N days". Click it. Every day should change room, and the times and rates should be untouched.',
      },
      {
        id: 'admin-batch-blank-safe',
        area: 'Admin work order',
        what: 'An unticked field is never written',
        how: 'Open Batch Edit and tick Start time but leave the time box empty. Apply. Your existing start times should NOT be wiped. Report it immediately if they are.',
      },
      {
        id: 'admin-batch-range',
        area: 'Admin work order',
        what: 'A date range limits the change',
        how: 'In Batch Edit, choose "Date range" and set From/To covering only two of the days. The count should drop to 2. Apply a room change and confirm only those two days changed.',
      },
      {
        id: 'admin-batch-cancel',
        area: 'Admin work order',
        what: 'Cancel undoes a batch change',
        how: 'Apply any batch change, then click Cancel at the bottom of the whole Work Order (not Save). Reopen the work order — the batch change should be gone.',
      },
      {
        id: 'admin-eng-follows-time',
        area: 'Admin work order',
        what: 'The engineer\'s time follows the session time',
        how: 'On a row with a staff line, change the session Start time. The staff line\'s start time should move with it.',
      },
      {
        id: 'admin-eng-independent',
        area: 'Admin work order',
        what: 'A deliberately different engineer time is kept',
        how: 'Set the staff line\'s start an hour EARLIER than the session. Now change the session start again. The staff line should keep your earlier time, not jump to match.',
      },

      // ── CRM ──
      {
        id: 'crm-registrations-tab',
        area: 'CRM',
        what: 'The Registrations tab lists completed registrations',
        how: 'Open CRM. There should be a REGISTRATIONS tab. It should list clients who have registered, newest first. Check an older one you know about appears.',
      },
      {
        id: 'crm-registrations-search',
        area: 'CRM',
        what: 'Search and paging work on registrations',
        how: 'Type part of a name, then an email, then a phone number — the list should filter each time. If there are more than 25, use Next at the bottom and confirm page 2 loads.',
      },
      {
        id: 'crm-copy-address',
        area: 'CRM',
        what: 'Copy Address copies a full mailing block',
        how: 'Open a registration record, click Copy Address, then paste into any text box. You should get the name, street, and "City, ST ZIP" on separate lines with no blank lines.',
      },
      {
        id: 'crm-needs-action-tabs',
        area: 'CRM',
        what: 'Needs Action has three tabs',
        how: 'On the CRM Needs Action view there should be Uncontacted, Hot and Warm only — no Incomplete tab. The count next to "Needs Action" should look lower than you remember; that is correct.',
      },
      {
        id: 'crm-lead-date-range',
        area: 'CRM',
        what: 'A lead can hold a date range',
        how: 'Create a lead and set Session Date plus the optional End Date a few days later. Save. The lead row should read as a range, e.g. "Aug 4–Aug 9".',
      },
      {
        id: 'crm-start-booking',
        area: 'CRM',
        what: 'Start Booking opens a Work Order from the lead',
        how: 'Open that lead and click Start Booking. A Work Order should open with the dates, times, rate and studio already filled in, covering the WHOLE range you set.',
      },
      {
        id: 'crm-booked-on-save',
        area: 'CRM',
        what: 'The lead only becomes Booked once the session is saved',
        how: 'From a lead, click Start Booking then close the Work Order WITHOUT saving. The lead should still be Hot or Warm. Do it again and Save — now it should read Booked.',
      },
      {
        id: 'crm-staffing-picker',
        area: 'CRM',
        what: 'Staffing on a lead carries into the Work Order',
        how: 'On a lead, set Staffing to Eng and pick a person. Click Start Booking. Every row of the Studio Time table should already show that person as 1ST.',
      },
      {
        id: 'crm-staffing-default',
        area: 'CRM',
        what: 'Sessions default to an assistant',
        how: 'Create a booking straight from the calendar (not from a lead). Its staff line should show 2ND, not 1ST.',
      },
      {
        id: 'crm-rename-propagates',
        area: 'CRM',
        what: 'Fixing a client\'s name updates it everywhere',
        how: 'Pick a client who has a booking AND a lead. Change the spelling of their name on their profile and save. You should get a message saying how many records updated. Check the calendar chip and the CRM lead list both show the new spelling.',
      },
      {
        id: 'crm-rename-keeps-artist',
        area: 'CRM',
        what: 'Renaming a client does not change the artist',
        how: 'After the rename above, check that booking\'s ARTIST is unchanged. Only the client name should have moved.',
      },
      {
        id: 'crm-label-company-only',
        area: 'CRM',
        what: 'A label can be created from a company name alone',
        how: 'CRM → Clients → New Client → Label/Billing. Type only a company name — no contact name, no email, no phone. Save should be available and should work.',
      },
      {
        id: 'crm-shared-asst-tasks',
        area: 'CRM',
        what: 'Assistant managers share tasks',
        how: 'Assign a task to "Asst Mgr". Have the OTHER assistant manager sign in on their own account — they should see it, and be able to comment and complete it.',
      },
      {
        id: 'crm-inquiry-flash',
        area: 'CRM',
        what: 'A new web enquiry flashes in the CRM list',
        how: 'Submit a test enquiry through the public enquiry form. It should pulse on the dashboard AND in the CRM lead list. Switch to light mode and confirm the pulse is blue, not green.',
      },

      // ── Dashboard ──
      {
        id: 'dash-studio-hero',
        area: 'Dashboard',
        what: 'Daily ops cards lead with the studio name',
        how: 'On the dashboard, open a studio from the top strip. The session cards should show the studio name as the big heading — and it should read "Studio X", not "Studio Studio X".',
      },
      {
        id: 'dash-reg-banner',
        area: 'Dashboard',
        what: 'The registration banner shows on every CRM tab',
        how: 'With a registration awaiting review, go to CRM. The banner should sit at the top no matter which tab you are on. Click it, confirm a profile, and you should land on that client in the Clients tab.',
      },
    ],
  },
]

export function getBatch(id: string): TestBatch | undefined {
  return TEST_BATCHES.find(b => b.id === id)
}
