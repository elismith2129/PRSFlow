# -*- coding: utf-8 -*-
"""The Billing SOP, walkthrough edition — chapters, walks and step copy.

A STEP is (keys, title, body[, state]).
  keys  — space-separated data-k values to light up on the drawn screen;
          '' = show the whole screen, nothing dimmed.
  state — optional data-state for the screen on that step.
COPY RULE (Eli, 2026-10-06): "keep the copy tight as when its long they just
check out." A title is a few words. A body is one or two short sentences.
"""

def W(wid, scr, title, steps, lede=''):
    return dict(kind='walk', id=wid, scr=scr, title=title, steps=steps, lede=lede)

def P(title, html):
    return dict(kind='pane', title=title, html=html)

CHAPTERS = [
# ───────────────────────────────────────────────────────────── 01
dict(id='job', n='01', nav='Your job', group=None,
     h1='You own the money side',
     lede='Operations is the studio manager\'s. <b>Billing is yours</b>: work orders, invoices, payments, money owed. Click <b>Next</b> and each part of the screen lights up. Or click any part of the picture.',
     blocks=[
  W('rail', 'rail', 'Where you\'ll live', [
    ('', 'Everything is in the left rail', 'This is the rail as you see it. These are your stops.'),
    ('r-dashboard', 'Dashboard', 'Your morning read: Flo\'s lines, your duties, the money at a glance.'),
    ('r-billing', 'Billing', 'Click it to open its four pages. The word itself never takes you anywhere.'),
    ('r-hub', 'Billing Hub', 'Every work order and invoice, sorted by what it is waiting for. This is where you work.'),
    ('r-petty r-srs r-ap', 'Petty Cash · SRS · Client AP Protocols', 'Month-end cash, referral payouts, and how each label wants its invoices sent.'),
    ('r-dailyops', 'Daily Ops', 'Last night, studio by studio. Yours: the red <b>WO not submitted</b> badges.'),
    ('r-calendar', 'Calendar', 'Where sessions are booked. Clicking one opens the same work order the hub opens.'),
    ('r-training', 'Training', 'This manual lives here, with the app guide and its version history.'),
  ]),
  P('The one rule', '<p><b>PRSFlo owns the workflow and the documents. QuickBooks owns the money.</b></p>'
    '<p>"Where is this invoice, and what is it waiting for?" is a PRSFlo question. "How much did we make in July?" is a QuickBooks question.</p>'),
]),
# ───────────────────────────────────────────────────────────── 02
dict(id='flow', n='02', nav='A session, start to finish', group='The flow',
     h1='A session, start to finish',
     lede='One work order, followed from booking to paid. This is the Billing client\'s path. COD\'s shorter path is chapter 08.',
     blocks=[
  W('life', 'life', 'One row, ten stops', [
    ('', 'The same row, ten times', 'This is one work order as the hub shows it at each stage. The <b>badge</b> says where it is. The <b>button</b>, when there is one, is your next move.'),
    ('s1', '1 · Booked', 'Every session gets a work order automatically. Until its first day it waits in <b>Not started</b>.'),
    ('s2', '2 · The session runs', 'The runner works the same work order from their phone and presses Submit each night.'),
    ('s3', '3 · Needs review — yours', 'A night is in. Open it, check it against what really happened, <b>Mark reviewed</b> each day, then <b>Complete WO</b>.'),
    ('s4', '4 · Needs invoice — yours', 'Make the invoice in QuickBooks. Drag the PDF onto the row.'),
    ('s5', '5 · Needs approval — the owner\'s', 'Nothing for you to press. An owner reads the package and approves.'),
    ('s6', '6 · Not approved', 'The owner sent it back with a note. Fix the work order, re-issue the invoice, drop the corrected PDF on the row.'),
    ('s7', '7 · Ready to send', 'Approved and the PO is in. <b>Download</b>, email it, then <b>Mark sent</b> the same day.'),
    ('s8', '8 · …or Awaiting PO', 'Approved, but no PO number yet. Chase the label. <b>Add PO</b> when it arrives. No second approval needed.'),
    ('s9', '9 · Sent', 'Age counts the days since Mark sent. At 31 it is overdue. <b>Mark paid</b> the day the money lands.'),
    ('s10', '10 · Paid', 'Done.'),
  ]),
]),
# ───────────────────────────────────────────────────────────── 03
dict(id='wo', n='03', nav='The work order', group='The flow',
     h1='The work order',
     lede='One document per session. The calendar card, the runner\'s phone, the hub row and the client\'s PDF are all this one page.',
     blocks=[
  W('wo', 'wo', 'Part by part', [
    ('', 'Words on the left, numbers on the right', 'Who and what kind on the left. Days, rentals, payments and totals on the right. Below it: one day, opened.'),
    ('buttons', 'Cancel · Complete WO · Save', '<b>Save</b> stores and closes. <b>Cancel</b> closes without saving, no question asked. Most typing is only on your screen until you Save.'),
    ('complete', 'Complete WO', '"I checked this and it is right." It moves the work order to <b>Needs invoice</b>. It will not complete while a day is missing its times, and a TBD day counts as missing.'),
    ('letterhead', 'The WO number', 'Automatic. The invoice number sits under it once it is typed.'),
    ('history', '⟲ HISTORY', 'Who changed what, and when. It does not record payments, rentals, or the hub\'s Mark sent and Mark paid.'),
    ('status', 'Status', 'Confirmed, Tentative, Cancelled and Lockout are sessions. Tour, Tech, Open Hrs and Tenant are calendar blocks with no billing.'),
    ('paytype', 'COD or Label/Billing', 'The big one for you. It decides which side of the hub this work order lives on, and whether the 3% card fee applies.'),
    ('client', 'The client card', 'Who the session is for: label, artist, A&amp;R and their admin. <b>On file</b> means the client has a profile. A typed name alone reads <b>Not on file</b>.'),
    ('refs', 'Invoice # and PO #', 'Type the PO, or switch on <b>Not req\'d</b>. Without one of them the package cannot be sent.'),
    ('days', 'Studio Time: one card per day', 'The only place the schedule and staffing live. Click a card to open that day.'),
    ('submitted', 'Submitted · Not submitted', 'Amber: the runner turned that night in, with name and time. Red: the night passed and nobody did.'),
    ('review', 'Mark reviewed', 'Your check on one day. It locks the day so the runner can no longer change it. If nobody submitted that night, it submits it in your name.'),
    ('daystatus', 'Each day has its own status', 'Confirmed, Tentative or Cancelled. A cancelled day stays on the work order and bills nothing.'),
    ('adddays', 'Adding days', '<b>+ Add studio time</b> asks for the dates and the room. <b>+ Seed</b> adds a long run in one go and saves at once, so press Save first.'),
    ('rentals', 'Rentals', 'Charge fills in as Qty × Rate. You can type over it.'),
    ('payments', 'Payments', 'On a Billing client it says invoiced, nothing to collect at the desk. Taking a COD payment is chapter 08.'),
    ('discount', 'Discount', '% or $, with a reason. It comes off studio time and engineering only. This is how a kill fee is done.'),
    ('totals', 'Totals', 'Every figure is worked out from the rows above, never typed. If a number looks wrong, read the rows.'),
    ('food', 'Food budget', 'The <b>Food budget</b> pill turns it on. The bubble opens the receipts. The client is billed receipts plus a 45% service fee.'),
    ('notes', 'Notes', '<b>Booking Notes</b> and <b>Needs Attention</b> are internal. <b>Session Notes</b> is the one the client sees.'),
    ('daysheet', 'A day, opened', 'Click a day card and this opens.'),
    ('times', 'Start and End', 'The booked times. This is what bills. <b>TBD</b> means "not decided yet", on purpose.'),
    ('s-actual', 'Client actually here', 'Arrived, Left, or <b>No show</b>. A record only. Billed stays as booked.'),
    ('s-rate', 'The rate', '<b>/ HR</b> bills the booked hours. <b>/ DAY</b> covers a set number of hours (blank means 12), then overtime at the OT rate.'),
    ('s-staff', 'Staff: 1ST and 2ND', 'Engineer or assistant, their hours, their rate. No rate means no charge.'),
    ('sheet-buttons', 'The day\'s own Save', 'It only keeps the edit on screen. The <b>Save</b> at the top of the work order is what stores it.'),
    ('removehold', 'Remove hold', 'Only on a Tentative session. Chapter 07 walks through it.', 'tentative'),
  ]),
  P('These save the moment you touch them', '<p>Cancel will not undo: <b>Mark reviewed</b>, the <b>×</b> that clears a staff line, food receipts, the equipment pills, the SRS tick, days added with <b>+ Seed</b>, and <b>Remove hold</b> (which also saves your edits first).</p>'),
]),
# ───────────────────────────────────────────────────────────── 04
dict(id='hub', n='04', nav='The Billing hub', group='The hub',
     h1='The Billing hub',
     lede='Rail → Billing → Billing Hub. Every work order is one row. The app moves rows between tabs for you.',
     blocks=[
  W('hub', 'hub', 'The page', [
    ('', 'Read a row like this', '<b>Badge</b>: where it is. <b>Flag</b>: the one thing worth knowing. <b>Button</b>: your next move.'),
    ('title', 'Billing · COD · Tenants', 'The heading is the switch. This chapter is the Billing side.'),
    ('stats', 'Four figures', 'Outstanding, Received this month, Waiting on approval, Over 31 days. The last three jump to their tab.'),
    ('search', 'Search', 'Searches everything at once, Billing, COD and Closed: client, artist, invoice #, WO #, PO.'),
    ('tabs', 'The tabs', '<b>In progress</b> is where the work is. <b>Not started</b> is future sessions. <b>Awaiting PO</b> and <b>Awaiting payment</b> are your chase lists.'),
    ('divider', 'In progress is a queue', 'Top to bottom: Needs review, Needs invoice, Needs approval, Not approved, Ready to send, then sessions still running.'),
    ('badge', 'The badge', 'Where the row is.'),
    ('flag', 'The flag', 'The one thing worth knowing about it.'),
    ('btn', 'The button', 'Your next move. No button: open the row, drop a PDF, or it is someone else\'s turn.'),
    ('r-review', 'Needs review', 'Click the row. Check each day, Mark reviewed, then Complete WO.'),
    ('drop', 'Drop invoice here', 'Drag the QuickBooks PDF onto the row, or click the chip. The row becomes <b>Needs approval</b>.'),
    ('r-approval', 'Needs approval', 'Waiting on an owner. Nothing for you to press.'),
    ('approvals', 'What the owner sees', 'A strip above the list on every tab: <b>Ready for your approval</b>. Owners only. You will not see it.', 'owner'),
    ('r-rejected', 'Not approved', 'Hover the flag to read the owner\'s note. Drop the corrected PDF on the row and confirm <b>Replace it</b>. That sends it back to them.'),
    ('r-ready', 'Download, then Mark sent', 'Download builds one PDF: the invoice plus the work order. Email it, then press <b>Mark sent</b>. Aging starts from that press.'),
    ('ap', 'AP', 'How this label wants its invoices sent. Chapter 05.'),
    ('notes', '✎ Collection notes', 'A running log for chasing money. Chapter 05.'),
    ('more', '⋯', 'Everything rare: pull it back, remove a wrong invoice, close, delete. Chapter 06.'),
    ('tab-holds', 'Removed holds', 'Holds taken off the calendar. Chapter 07.'),
  ]),
  W('hubflags', 'hub-flags', 'The flags', [
    ('f-submitted', 'Submitted by …', 'The runner turned the night in, and when.'),
    ('f-never', 'Never submitted', 'A past night nobody submitted, and who closed that studio. <b>2 days</b> means two nights are missing. It outranks every other flag.'),
    ('f-office', 'Submitted by Lori', 'The runner missed it and the office completed the work order instead.'),
    ('f-running', 'Needs review / in progress', 'A long session still running, with a night waiting for you. Review each night as it comes in.'),
    ('f-thru', 'Reviewed thru …', 'A long session still running, and you are caught up.'),
    ('f-drift', 'Changed since invoiced', 'The work order\'s total no longer matches its invoice. Re-issue the invoice and drop the corrected PDF. The flag stays until the owner approves again.'),
    ('f-stale', 'Built, not sent', 'Downloaded two or more days ago and never marked sent. Send it, or mark it.'),
  ]),
  W('hubpo', 'hub-po', 'Awaiting PO', [
    ('row', 'Approved, no PO', 'Your chase list for label POs.'),
    ('btn', 'Add PO', 'Opens a strip under the row.'),
    ('po-number', 'The PO number', 'Type it exactly as the label gave it.'),
    ('po-file', 'A re-issued invoice (optional)', 'If QuickBooks re-dated the invoice, choose the new PDF here. It replaces the one on the row.'),
    ('po-save', 'Save &amp; download', 'Stores the PO and downloads the package. The owner\'s approval is not disturbed.'),
  ]),
  W('hubawait', 'hub-await', 'Awaiting payment · Paid · Closed', [
    ('age', 'Age', 'Days since you pressed Mark sent. Never since the session date. Oldest first.'),
    ('overdue', 'Over 31 days', 'The balance turns red. Chase it, and write what you learn in ✎.'),
    ('btn-paid', 'Mark paid', 'One press, no question. Press it the day the money lands. Pressed by mistake: ⋯ → Undo Mark paid.'),
    ('row-closed reason', 'Closed', 'Written off or voided, with the reason on the row. Closed COD rows land here too.'),
    ('btn-reopen', 'Reopen', 'Puts it back where it was. A sent invoice returns to Awaiting payment with its original date. An approval never comes back.'),
  ]),
  P('Guardrails you will notice', '<ul>'
    '<li><b>Change the money after approval and it un-approves.</b> The owner approved a figure, not whatever it becomes.</li>'
    '<li><b>A sent invoice never changes quietly.</b> The only way to restart it is Pull it back, which is the owner\'s.</li>'
    '<li><b>These leave no line in History:</b> Mark sent, Mark paid and their undos, Pull it back, Close and Reopen. If it matters later, put a line in ✎.</li>'
    '</ul>'),
]),
# ───────────────────────────────────────────────────────────── 05
dict(id='send', n='05', nav='Packages, AP &amp; notes', group='The hub',
     h1='Packages, AP &amp; notes',
     lede='What opens when you click a row, how to send it, and where to keep the chase.',
     blocks=[
  W('pkg', 'pkg', 'The package window', [
    ('window', 'Click a row with an invoice on it', 'The package opens. A row with no invoice opens the work order instead.'),
    ('tab-wo', 'Work order', 'The live one. You can edit it right here. Use its own Save or Cancel: the window will not close on unsaved changes.'),
    ('tab-invoice', 'Invoice', 'The PDF you dropped on the row.'),
    ('tab-saved', 'Previously saved', 'The exact file that was last built, page for page.'),
    ('tab-saved', 'As sent', 'After Mark sent, that tab reads <b>As sent</b>: the file the client received.', 'sent'),
    ('owner-bar', 'What the owner sees', '<b>Approve</b>, or <b>Don\'t approve…</b> with a note. You cannot approve. The button is theirs alone.', 'owner'),
    ('owner-note', 'Returned', 'The owner\'s note sits at the top. Fix the work order, then drop the corrected invoice on the row.', 'returned'),
  ]),
  W('ap', 'ap', 'AP: how to send this invoice', [
    ('ap-panel', 'Opens from the AP chip', 'Beside the client\'s name on the row. One card per label.'),
    ('ap-glance', 'At a glance', 'Portal or email, PO required or not, how they pay.'),
    ('ap-steps', 'The steps', 'Click a step to tick it as you go. Ticks belong to this work order and everyone sees them.'),
    ('ap-password', 'Passwords', 'Never kept in the app. The card only says where to find it.'),
  ]),
  W('cnotes', 'cnotes', '✎ Collection notes', [
    ('cn-add', 'Write it down every time you chase', 'Who you spoke to, what they said, what happens next.'),
    ('cn-who', 'Your initials and the time', 'Added for you.'),
    ('cn-edit', 'Edit, never delete', 'A note can be edited. It cannot be removed.'),
    ('cn-internal', 'Internal', 'Never on the work order, the package or the runner app.'),
  ]),
]),
# ───────────────────────────────────────────────────────────── 06
dict(id='undo', n='06', nav='Undo, close, delete', group='The hub',
     h1='Undo, close, delete',
     lede='Everything rare lives behind the ⋯ on a row. What you see there depends on where the row is.',
     blocks=[
  W('more', 'more', 'The ⋯ on a row', [
    ('', 'Every item, in one picture', 'A real row only shows the items that apply to it. This shows them all.'),
    ('m-open', 'Open the attached invoice PDF', 'Just the invoice, in a new tab.'),
    ('m-detach', 'Remove the attached invoice', 'For a PDF that went on the wrong work order. Only before an owner has approved.'),
    ('m-nopo', 'No PO required', 'This one can go out without it. Set per work order.'),
    ('m-download', 'Download the package again', 'Before Mark sent only. Built fresh from the work order as it stands now.'),
    ('m-undo-sent', 'Undo Mark sent', 'Pressed it too soon? The row goes back to Ready to send. The invoice and the approval stay.'),
    ('m-undo-paid', 'Undo Mark paid', 'The row goes back to Awaiting payment with its original sent date.'),
    ('m-pull', 'Pull it back — owners only', 'Removes the invoice, the saved package and the approval, for good. You will not see it. Ask Eli or Adam-Mike when an invoice has to start over.'),
    ('m-close', 'Close this invoice', 'Write it off or void it.'),
    ('close-modal', 'Pick a reason', 'You must choose one. <b>Other</b> needs a note. The row moves to Closed with the reason showing.'),
    ('m-delete', 'Delete this work order', 'Every day on it and every calendar card. Next.'),
  ]),
  W('deleted', 'deleted', 'Deleting, and getting it back', [
    ('del-confirm', 'Type the WO number', 'Delete removes the whole work order, so it makes you type its number first. To remove one day, delete that day inside the work order.', 'typed'),
    ('pagemenu', 'The page\'s own menu', 'It opens from the ⋯ at the top right of the hub.'),
    ('pm-deleted', 'Deleted work orders', 'Everything deleted is kept: what, by whom, when.'),
    ('log-confirm', 'Recover → Put it back', 'Restores it exactly as it was.'),
    ('log-recovered', 'Recovered', 'It stays in the list, greyed.'),
    ('pm-blank', 'Generate WO', 'Downloads a blank form to print. It creates nothing in the app.'),
  ]),
  P('Good to know', '<ul>'
    '<li>Only you, the manager and the owners can delete. The work order itself has no Delete button. A hold has <b>Remove hold</b> instead: next chapter.</li>'
    '<li>Gaps in the WO numbers do not mean something was deleted. Numbers are sometimes skipped.</li>'
    '</ul>'),
]),
# ───────────────────────────────────────────────────────────── 07
dict(id='holds', n='07', nav='Holds', group='The hub',
     h1='Removing a hold',
     lede='A hold is a Tentative session. It comes off the calendar from its own work order, one day or all of it.',
     blocks=[
  W('removehold', 'removehold', 'Remove hold', [
    ('rh-button', 'Remove hold', 'Top left of a Tentative work order, beside Cancel. Confirmed sessions never have this button.'),
    ('rh-list', 'Nothing is ticked', 'The window lists every day of the hold. You choose what goes.'),
    ('rh-day', 'Tick the days to remove', 'Only those days come off. The rest stay on the calendar.', 'some'),
    ('rh-go rh-tally', 'Every day ticked', 'It says so in red first. Then the whole hold goes.', 'all'),
    ('rh-locked', 'A greyed day', 'A confirmed, submitted or reviewed day is not a hold any more. It cannot be ticked.', 'locked'),
    ('rh-kept', 'Nothing is lost', 'Everything removed is kept under <b>Removed holds</b>.'),
  ]),
  W('holdstab', 'holds', 'The Removed holds tab', [
    ('tab-holds', 'The last tab', 'On both Billing and COD.'),
    ('h-row', 'One line per removal', 'Which hold, which days, who removed it, when.', 'idle'),
    ('h-chip', 'Days or whole hold', '<b>2 days</b>: some days came off. <b>Whole hold</b>: all of it.', 'idle'),
    ('h-confirm', 'Recover → Put it back', 'A whole hold comes back exactly as it was. Removed days go back on their hold as one-day bars until that work order is next saved.'),
    ('h-recovered', 'Recovered', 'It stays in the list, greyed, and stops counting.'),
  ]),
  P('It will say no when', '<ul>'
    '<li>The hold has an invoice or a payment on it, or was completed. Delete it from the hub instead.</li>'
    '<li>Someone changed the hold while your window was open. Close it and open Remove hold again.</li>'
    '</ul>'),
]),
# ───────────────────────────────────────────────────────────── 08
dict(id='cod', n='08', nav='COD', group='The hub',
     h1='COD',
     lede='Paid at the desk. The only way COD goes wrong is a balance nobody collected.',
     blocks=[
  W('cod', 'cod', 'The COD side', [
    ('title-cod', 'Click COD', 'At the top of the hub. The number turns red when any balance is owed.'),
    ('tabs', 'These tabs are switches', 'More than one can be on. It opens with <b>Balance due</b> and <b>Needs review</b>: your COD morning.'),
    ('r-balance', 'Balance due', 'The session happened and money is still owed. No button: record the payment on the work order and the row moves by itself.'),
    ('r-review', 'Needs review', 'Paid up. Check the work order, then Complete WO.'),
    ('r-invoice', 'Needs invoice', 'Drop the QuickBooks invoice on the row.'),
    ('tab-paid r-approval', 'Needs approval', 'COD needs an owner\'s sign-off too. It waits under <b>Paid</b>.', 'paid'),
    ('r-paid', 'Paid', 'Paid up and approved. Finished.', 'paid'),
  ]),
  P('No Mark sent, no Mark paid', '<p>On COD, paid is worked out from the payments on the work order. It cannot be marked paid when it is not.</p>'),
  W('collect', 'collect', 'Taking a payment', [
    ('collect', 'COLLECT', 'Two numbers, the same size. Quote the one for how they are paying.'),
    ('types', 'Pick the type', 'Each type shows its amount. Picking one fills the row in for the full balance.', 'picking'),
    ('toward', 'Toward balance', 'The amount <b>before</b> the fee. For a part payment, type it here.', 'card'),
    ('run', 'The red number', 'Fee added. This is what you run on the terminal.', 'card'),
    ('last4', 'last 4', 'Type the card\'s last four digits, then Save.', 'card'),
    ('warn', 'The red warning', 'You typed what the terminal charged, so the 3% went on twice. <b>Use $123.00</b> fixes it in one tap.', 'warn'),
    ('waive', 'waive', 'Takes the fee off that one payment.', 'card'),
    ('t-fees', 'Card Fees (3%)', 'Credit and debit cards on COD only. Cash, Zelle, Venmo, Wire, ACH, Check and Other carry no fee.', 'card'),
  ]),
]),
# ───────────────────────────────────────────────────────────── 09
dict(id='other', n='09', nav='Tenants · SRS · Petty cash', group='Other money',
     h1='Tenants · SRS · Petty cash',
     lede='Three smaller pieces, each with its own screen.',
     blocks=[
  W('tenants', 'tenants', 'Tenants: the rent board', [
    ('tab-tenants', 'Hub → Tenants', 'Tenants pay rent, not work orders. One row per tenant per rent period.'),
    ('sendby b-sent', 'Mark sent', 'You emailed the rent invoice. <b>Send by</b> is six days before the period starts.'),
    ('b-paid', 'Mark paid', 'On rent it asks how much, and the date received.'),
    ('payprompt', 'The amount is the total so far', 'When the rest comes in, type the running total, not just the second payment.', 'partial'),
    ('partial', 'Partial', 'Some in, some still open. Mark paid again when the rest arrives.'),
    ('b-qb', 'In QB', 'You entered the payment in QuickBooks. That is the last step.'),
    ('status', 'Undo', 'Tap the status word to take back the last step.'),
    ('late', 'Late', 'Red once rent is five days past the start of its period.'),
    ('ledger', 'The ledger', 'Tap a tenant\'s name: every period, invoiced, paid, balance.'),
    ('incidentals', 'Incidentals', 'The one tenant with a work order. <b>Month sheet →</b> shows the runner hours to bill. Send it by the 3rd; it reads Late at 31 days unpaid.'),
  ]),
  W('srs', 'srs', 'SRS payouts', [
    ('owed', 'Owed', 'Every session with SRS ticked on its work order, oldest first.'),
    ('fee', 'The fee', 'A percentage of the room charges, before any discount. Engineering is not included.'),
    ('pct', 'The %', 'Grey is the default, 20%. Tap it to change it for that one session.'),
    ('pct-menu', '20 · 15 · 10, or any %', 'Only that session changes.'),
    ('markpaid paydate', 'Mark paid', 'Asks the date it went out and locks the amount.'),
    ('paid-chip', 'Undo', 'Tap the green chip. It asks first.'),
  ]),
  W('petty', 'petty', 'Petty cash', [
    ('pickers', 'One studio, one month', 'Pick them here.'),
    ('ledger', 'You enter nothing here', 'Runners record the cash each night and count the box at close.'),
    ('opening closing', 'Opening balance · Closing per ledger', 'Worked out from the ledger. Nobody types them.'),
    ('mismatch', 'Nights the box didn\'t match', 'By how much, who counted, and their note.'),
    ('export', 'Download CSV · Print', 'For month-end.'),
  ]),
]),
# ───────────────────────────────────────────────────────────── 10
dict(id='dash', n='10', nav='The Dashboard', group='Your day',
     h1='The Dashboard',
     lede='The morning read. Flo first, then the money, then your list.',
     blocks=[
  W('dash', 'dash', 'Top to bottom', [
    ('flo', 'Flo', 'A few lines worked out from real records. Read the red ones first. Chapter 11.'),
    ('money', 'The money', 'COD out, WOs need review, Wait on approval, Ready to go out. Click the box to open the hub.'),
    ('list', 'Your list', 'Your duties and your tasks. Red is late.'),
    ('l-todo', 'A duty', 'Click to tick it. Click again to untick.'),
    ('l-backlog', 'Missed days add up', 'One red line counts the days, today included. One tick clears them all.'),
    ('l-late', 'Monthly duties stay until done', 'Red, counting the days late.'),
    ('l-task', 'A task', 'A one-off somebody assigned to you. Click it to open it on the Flags tab.'),
    ('today', 'Today\'s sessions', 'A card per room. Green is confirmed. Amber is a hold, not billable yet. Today\'s sessions are tomorrow\'s review queue.'),
    ('landed', 'Landed &amp; in the air', 'New confirmed bookings made today, and the holds to check this week.'),
    ('crm', 'CRM — pipeline', 'The sales side. Not yours.'),
  ]),
  W('lastnight', 'lastnight', 'A pop-up you will meet', [
    ('ln-modal', 'Last night: a work order was never submitted', 'Once a day, if a session from last night was not submitted. It will not come back tomorrow.'),
    ('ln-row', 'Open →', 'Click a line to go straight to that work order.'),
  ]),
  P('The rules your list lives by', '<ul>'
    '<li><b>Weekdays only.</b> Daily duties are due Monday to Friday.</li>'
    '<li><b>Never late on the day itself.</b> Late means an earlier day went unfinished.</li>'
    '<li><b>🔒 items were set by an owner.</b> You cannot edit or remove them.</li>'
    '</ul>'),
]),
# ───────────────────────────────────────────────────────────── 11
dict(id='flo', n='11', nav='Flo', group='Your day',
     h1='Flo',
     lede='The lines are a mirror, not an inbox. A line goes away when the thing it describes stops being true.',
     blocks=[
  W('flo', 'flo', 'The lines', [
    ('f-red', 'Red: something is broken', 'A session with no work order: open it and it retries. A booking with no room: open it and set the studio.'),
    ('f-duty', 'Red: a duty slipped', 'Missed yesterday, a backlog of three days or more, or a monthly duty past its date. Do it and tick it. A missed-yesterday line stays until tomorrow.'),
    ('f-money', 'Red: COD is owed', 'Collect the balance and the line goes. You never tick anything.'),
    ('f-amber', 'Amber: work orders need review', 'On a Monday it starts "Weekend catch-up".'),
    ('f-landed', 'We landed …', 'New confirmed bookings made today.'),
    ('f-last', 'The last line', 'It counts duties only. It can say "All clear" under a red money line, so read the red lines first.'),
    ('f-full', 'Full briefing →', 'Flo\'s written read of last night\'s notes, the open flags and the week\'s holds.'),
    ('b-you', 'For you', 'The part written for the Billing seat. Read it like a colleague\'s handover note.'),
    ('b-rebrief', 'Re-brief ↻', 'Asks Flo to write a fresh one now.'),
  ]),
  P('When Flo and the hub disagree', '<p><b>The hub is right.</b> Flo is a summary. Its COD figure looks back 90 days and includes sessions still running tonight.</p>'),
]),
# ───────────────────────────────────────────────────────────── 12
dict(id='ops', n='12', nav='Daily Ops &amp; Flags', group='Your day',
     h1='Daily Ops &amp; Flags',
     lede='Mostly the studio manager\'s page. One thing on it is yours, and it is the first stop of your morning.',
     blocks=[
  W('ops', 'ops', 'Daily Ops', [
    ('date', 'It opens on Yesterday', 'The arrows step a day back or forward.'),
    ('card', 'Four cards, one per studio', 'All the same size.'),
    ('duties', 'The dots', 'Green came in. Amber came in with a problem. Red never came in. These are mostly the manager\'s.'),
    ('badge', 'WO not submitted — yours', 'A session last night that the runner never submitted. Tap the badge to open the work order.'),
    ('badge-who', 'Whose it was', 'The runner who last saved that work order, or whoever filed the closing checklist.'),
    ('badge-unknown', '?', 'Nobody saved it and nobody closed out that studio.'),
    ('badge-tick', 'Talk to the runner, then tick it', 'They can still submit it themselves, even the next day.'),
    ('badge-handled', 'Handled', 'It turns grey and everyone in the office sees the same tick.', 'handled'),
    ('tasks', 'Studio tasks', 'Small jobs for that studio. Whoever ticks one leaves their initials.'),
  ]),
  P('What happens to the badge', '<ul>'
    '<li><b>The runner submits late:</b> the badge goes away.</li>'
    '<li><b>The office fixes it</b> (Mark reviewed or Complete WO): the badge stays on that night as the record. Your tick says it was dealt with.</li>'
    '</ul>'),
  W('flags', 'flags', 'Flags', [
    ('t-flags', 'The second title', 'Same page. A flag is anything that needs doing.'),
    ('add', 'Add a flag…', 'One line saying what needs doing.'),
    ('k-tech', 'Facility · Gear', 'These go to Tech.'),
    ('k-admin', 'Clients &amp; billing · Office', 'These go to Admin, which includes you.'),
    ('f-mine f-assigned', 'Mine · I assigned', 'What is assigned to you by name, and every flag you added.'),
    ('f-done-btn', 'Done', 'On an Admin flag, one tap marks it done.'),
    ('f-age', '72 hours', 'The only alarm. An open flag older than that shows its age in red.'),
  ]),
]),
# ───────────────────────────────────────────────────────────── 13
dict(id='rhythm', n='13', nav='The rhythm', group='Your day',
     h1='The rhythm',
     lede='The whole job, by when it comes around.',
     blocks=[
  dict(kind='rhythm', rows=[
    ('Every morning', ['Dashboard: Flo\'s red lines, then Your list.', 'Daily Ops: every <b>WO not submitted</b> badge chased and ticked.', 'Hub, In progress: clear <b>Needs review</b>.', '<b>Needs invoice</b>: QuickBooks invoice made and dropped on the row.', 'COD: <b>Balance due</b> is empty, or you know why not.']),
    ('Through the day', ['<b>Ready to send</b>: Download, email, Mark sent the same day.', '<b>Not approved</b>: fix, re-drop, Replace it.', '<b>Mark paid</b> the day money lands.', 'A line in ✎ every time you chase someone.']),
    ('Every week', ['<b>Awaiting payment</b>, oldest first. Chase everything over 31 days.', '<b>Awaiting PO</b>: chase each label.']),
    ('The 1st', ['SRS: pay what is in Owed and mark each one paid.']),
    ('Month-end', ['Petty cash: each studio, read "Nights the box didn\'t match", then Print or Download CSV.']),
    ('Rent', ['Tenants: send by the date on the row, Mark sent, Mark paid, In QB.']),
  ]),
]),
# ───────────────────────────────────────────────────────────── 14
dict(id='help', n='14', nav='Help &amp; words', group='Reference',
     h1='Help &amp; words',
     lede='',
     blocks=[
  dict(kind='help', title='When something looks wrong', rows=[
    ('A number that can\'t be right', 'Open the work order and read the rows. Every total is worked out from them.'),
    ('"Paid" is more than the total', 'A card payment where the terminal amount was typed into Toward balance. The red line under the payment offers the fix.'),
    ('A work order has vanished', 'Hub → page ⋯ → Deleted work orders. For a hold: the Removed holds tab. Then tell Eli.'),
    ('Mark sent or Mark paid by mistake', 'Row ⋯ → Undo Mark sent, or Undo Mark paid. Nothing else changes.'),
    ('A PDF on the wrong row', 'That row\'s ⋯ → Remove the attached invoice. Then drop it where it belongs.'),
    ('A red "NOT saved" message', 'The save failed and the app is saying so. Try again. If it keeps happening, tell Eli.'),
    ('The manual doesn\'t match the screen', 'The app changed and the manual didn\'t. Say so.'),
  ]),
  dict(kind='words', title='Words', rows=[
    ('Work order (WO)', 'One session\'s paperwork. Born with the booking.'),
    ('COD · Billing', 'Paid at the desk · invoiced after.'),
    ('Submit', 'The runner turning a night in.'),
    ('Mark reviewed', 'Your check on one day. It locks the day.'),
    ('Complete WO', 'Your check on the whole work order. Sends it to Needs invoice.'),
    ('Approve', 'An owner signing off the package. Owners only.'),
    ('Package', 'The invoice and the work order as one PDF.'),
    ('Pull it back', 'Strip the invoice and approval and start that row again. Owners only.'),
    ('Close', 'Write off or void an invoice, with a reason.'),
    ('Hold', 'A Tentative session.'),
    ('Toward balance', 'A payment\'s amount before the 3% card fee.'),
    ('Hours included', 'The hours a day rate covers before overtime. 12 unless set.'),
    ('No show', 'The artist never came. A record; the bill does not change.'),
    ('AP', 'A label\'s procedure for paying an invoice.'),
    ('SRS', 'A referral fee on a session\'s room charges.'),
    ('Duty · Task', 'A recurring item on Your list · a one-off assigned to you.'),
    ('Flag', 'Anything that needs doing.'),
  ]),
]),
]
