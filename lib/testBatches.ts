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
