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
