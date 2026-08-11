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
