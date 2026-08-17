# PRSFlo — Billing Coordinator Operating Manual

**DRAFT v0.1 (2026-08-17) — for Eli's review, then review with the current
coordinator before it ships into the app.** Nothing here is live in `/sop` yet.
Sections are numbered so review notes can say "§4.2 is wrong" and the fix is
surgical.

---

## 1. Your job, in one page

You own the money side of Paramount. PRSFlo is split into two worlds:
**Operations** (the studio manager's world — the building, the runners, the
nightly checklists) and **Billing** (yours — work orders, invoices, payments,
and money owed). You'll rarely need anything in the Operations world, and
nothing in your world lives anywhere else. One item, one home.

The one rule that shapes everything you do: **PRSFlo owns the workflow and the
documents; QuickBooks owns the money.** PRSFlo tells you what needs invoicing,
holds the work order and the invoice PDF together, and tracks where every
invoice sits. QuickBooks is still the accounting — you create the actual
invoice there, and the books live there. The two systems track different
things, so they never fight.

Your day runs on three screens, all in the left rail:

- **Dashboard** — your morning read. Flo's briefing tells you what needs you.
- **My Day** — your recurring duties, as a checklist that tracks itself.
- **Billing** — the hub. Every work order and invoice, sorted by what it's
  waiting for. This is where the actual work happens.

## 2. Getting in

Go to **prsflow.paramountrecording.com** and sign in with your email and
password. If you forget the password, "Forgot password?" on the login page
emails you a reset link. The app works on your phone too, but billing work is
desk work — plan on the desktop.

After signing in you land on the Dashboard. The rail down the left side is how
you move around; the three entries you care about are Dashboard, My Day, and
Billing.

## 3. What a work order is (read this before anything else)

Every recording session on the calendar has **one work order** — the paperwork
for that session. It's created automatically the moment a session is booked;
nobody makes work orders by hand, and there is never a session without one or
two work orders for one session.

The work order holds everything billable: the studio time (dates, hours,
rates, per day), engineer time and rates, equipment rentals, overtime, and any
payments taken. The **runner at the studio fills in the real times** during
the session from their phone — start, end, who engineered, equipment condition
— and **submits** their day when it's done.

Two things about runner submissions that will save you confusion:

- **Submitted is a signal, not a seal.** A runner can keep correcting their
  day after submitting (sessions change near the end; we want it right, not
  frozen). The screen always shows the current version — it's live.
- **Approval is the only lock.** When the office approves a day, its rows lock
  and the runner can't touch them. Approving is your accuracy sign-off. It's
  reversible (the office can unlock), but treat it as "I checked this."

**Overtime is a designation, not a judgment call.** OT means time beyond what
was agreed — past the booked end time on hourly days, past 12 hours on
lockouts. On the runner's side it's computed from the clock automatically, so
it can't be typed wrong or double-billed. It shows as its own line so anyone
can see agreed time vs overage.

### COD vs Billing — the two kinds of client

Every work order is one of two kinds, and they live in two separate pipelines
in the hub:

- **COD** — the client pays at the desk, during or right after the session.
  The money is already in by the time you see it; your job is to check the
  work order is accurate and attach the invoice. Minutes per session. If OT
  happened, COD collects it at the desk in the moment.
- **Billing** — label clients and anyone invoiced after the fact. The full
  cycle: review → invoice in QB → owner approval → send → chase → paid. Days
  to weeks per invoice. OT gets billed after.

## 4. Your morning, in order

This is the shape of the day. Each piece is explained in depth in the sections
after.

1. **Open the Dashboard.** Read Flo's briefing — it's a few lines telling you
   if anything slipped, what pressure is building, and what's due tomorrow.
2. **Open Billing → the COD pipeline.** If **Balance due** shows anything,
   that's first — it means money that should have been collected at the desk
   wasn't. Rare, and the most important thing on the page when it happens.
3. **Work the "Needs review" / "In progress" lists.** Last night's sessions
   are here waiting to be checked. Double-click a row to open the work order,
   check it against reality (times, rates, rentals, payments), fix anything
   wrong, approve the days, and Complete it.
4. **Invoice.** For each reviewed work order, create the invoice in QuickBooks
   (the Daily Invoice Procedure), then attach the PDF to the row in the hub.
   Billing-side invoices then wait on an owner's approval; COD is done at this
   point.
5. **Send and chase.** Approved billing invoices: Download the package, email
   it to the client, press Mark sent. Anything in **Awaiting payment** over 31
   days is your chase list.
6. **Tick your My Day card** as you go — Ramp approvals, QB invoice updates,
   COD follow-up counts. This is what feeds tomorrow's briefing.

## 5. The Dashboard

The dashboard is the morning read, not a work surface. What's yours on it:

- **The Flo box** — the briefing. See §7; it deserves its own section.
- **Your My Day card** — today's duties with checkboxes, and a progress pill
  ("3 of 5"). Same card as the full My Day page, in short form. Check things
  off here or there; they're the same checkmarks.
- **My Tasks** — one-off tasks assigned to you by name (distinct from My Day,
  which is your recurring duties). Anyone in the office can assign you a task;
  comment threads live on each one.
- **Today's sessions** — the room-by-room grid of what's happening in the
  buildings today. Useful for knowing what today will send you tomorrow.

Everything else on the dashboard (needs-action leads, flags) belongs to other
roles. You can see it; none of it is waiting on you.

## 6. My Day — your duties, tracked honestly

My Day is the recurring part of your job as a checklist that knows its own
schedule. Open it from the rail (or use the short card on the dashboard).

### 6.1 The duties on your card

**Daily:**

- Approve Ramp transactions + chase missing receipts (records a count:
  transactions cleared)
- Collect and accuracy-check yesterday's work orders
- Update yesterday's invoices in QuickBooks per the Daily Invoice Procedure
  (records: invoices updated)
- Create work orders for today's confirmed sessions — in practice this is
  "check the needs-work-order list is empty," since work orders create
  themselves at booking
- COD invoicing + outstanding follow-up (records three numbers: COD accounts
  outstanding, chased today, and 31+ days past due)

**Weekly (Mondays):** the Ramp weekly report, and the open/sent-invoice
follow-up pass — the rule of thumb: anything **sent more than 14 days ago
that nobody has touched in 7** gets a follow-up.

**Monthly:** tenant rent — create the invoices on the **25th**, follow up on
the **5th**.

(The exact list lives in the app and may grow; the card is always current.)

### 6.2 How the card behaves

- **Day-scoped duties only show on their day.** Monday's list is Monday's
  work; the rent duty appears on the 25th, not all month. The day-before
  heads-up comes from Flo instead (§7).
- **Checking a duty off** stamps who did it and when. If you're out, anyone
  with access can work your card — the record shows who actually did it.
- **Unchecking is allowed** if you ticked something by mistake. History is
  kept either way.
- **Some duties ask for a number** when you complete them (transactions
  cleared, invoices updated, COD outstanding). Type the real number — these
  aren't busywork; they're what Flo and Eli's oversight numbers are built
  from, until the QuickBooks connection can compute them automatically.
- **Missed days accrue on "cumulative" duties.** Miss the Ramp approvals for
  two days and the duty doesn't duplicate — it shows one line, "covering
  3 days," and checking it off clears the whole backlog (you did catch up on
  all of it, after all). This is honest tracking, not punishment: the point is
  that the card always tells the truth about where things stand.
- **Monthly duties escalate instead of accruing.** Miss the rent on the 25th
  and it stays on the card, red, saying how late it is — because the next
  natural occurrence is four weeks away and rent can't wait for it.
- **A duty is never "late" on the day itself.** At 9am, today's unfinished
  duties are just today's work. Late means a *previous* day went unfinished.

### 6.3 The rest of the My Day page

Below the duty card the full page has live queues — sessions missing work
orders, outstanding balances, tentative holds, recently confirmed bookings —
plus a scratchpad for shift notes. The queues are computed from real data,
never typed, so they can't go stale: when the last balance is collected, the
list is simply empty.

## 7. The Flo briefing — why it says what it says

The Flo box on the dashboard reads like a short note from an assistant. It is
not AI and it is not guessing — every line is computed from real records, by
fixed rules. Once you know the rules, you can trust it completely, and you'll
know exactly what to do about every line.

### 7.1 The four tiers, in order

Flo always speaks in the same order: what slipped, what's building, what went
well, what's tomorrow.

**RED — something slipped.** A red line appears for exactly three reasons:

1. A cumulative duty has a backlog of **3 or more missed days** ("…missed the
   Ramp approvals — covering 4 days").
2. A **monthly duty blew its date** and still isn't done ("Tenant rent was due
   Mon 8/25 — 3 days late, needs doing ASAP"). This is the loudest thing on
   the board, because the next natural chance is a month away.
3. A duty that was **due yesterday wasn't checked off** — red, but quieter
   than a backlog.

**AMBER — pressure building.** Not failures; work stacking up:

- "N sessions missing work orders" — sessions on the calendar that should
  have a work order and somehow don't.
- "N balances outstanding · $X" — work orders where money owed exceeds money
  taken, with the total.
- "COD outstanding: N accounts · M over 31 days" — from the numbers you typed
  on your COD duty. If you don't type them, this line can't appear; the
  briefing is only as good as the counts you record.

**GREEN — what went well.** "You cleared all 5 duties yesterday." Earned, not
decorative — it only appears when every due duty was actually done.

**TOMORROW — the lookahead.** One neutral line: "Tomorrow: Ramp weekly
report." This exists because day-scoped duties only appear on their own day
(§6.2) — this line is the day-before warning that arrangement gives up. Only
weekly and monthly duties appear here (a nightly "tomorrow: Ramp approvals"
would be noise), and a duty already flagged red isn't repeated here.

The one-line synopsis at the bottom follows from the tiers: nothing red and
nothing amber reads "All clear."; amber only reads "Nothing slipped — a few
things are building"; reds get "one thing needs you" or "N things need you."

### 7.2 What clearing something means

Each color clears differently, and this is the part worth memorizing:

- **Red duty lines clear by checking off the duty on your My Day card.** One
  checkmark covers the whole backlog it names. There is no way to dismiss a
  red line without the work being marked done — Flo has no snooze button, on
  purpose.
- **Amber lines clear themselves when the underlying pile is gone.** Create
  the missing work orders and that line vanishes; collect the balances and
  that one goes. You never tick anything — Flo recounts every morning.
- **Green and Tomorrow aren't clearable** — one is a report, the other a
  heads-up.

So the briefing is a mirror, not an inbox: nothing in it needs "processing,"
and everything in it disappears exactly when reality improves.

### 7.3 What Flo will never do

It never accuses you of history before your time — the day the system (or a
new duty) started, the counters start from zero. It never marks today's
unfinished work late. And it never says the same thing twice in one briefing.

## 8. The Billing hub — where the work happens

Open **Billing** in the rail. Everything here is a work order, shown as one
row, sorted into tabs by **what it's waiting for**. This page replaced the old
Dropbox folder system — the folders are now tabs, and the app moves things
between them for you.

At the top: the **COD / Billing toggle** (the two pipelines, §3), four summary
figures, and a search box. The figures are clickable — each one jumps to the
tab it counts. On the Billing side you get Outstanding, Received this month,
Waiting on approval, and Over 31 days; on COD, Balance due, Collected this
month, Needs review, and Balances open.

### 8.1 The assembly line and the lights

Every billing-side invoice is one package moving down an assembly line:

> open → **Reviewed** → **Invoiced** → **Approved** → **Sent** → **Paid**

The first three stages show as three small **lights on the row** (Reviewed ·
Invoiced · Approved) rather than separate tabs, because they're one package
being assembled — usually in one sitting. The tabs group by who's waiting:

- **In progress** — being assembled (any of the first three lights). This is
  your working list, the one you scan top to bottom every morning.
- **Awaiting payment** — sent, aging, waiting on the client's money.
- **Paid** — done.
- **Closed** — written off or voided. The archive, for both pipelines.

There's also **Upcoming** — sessions that haven't happened yet and nobody has
touched. Not work; just visible so nothing sneaks up on you.

### 8.2 One row, one button

Every row shows **at most one button — always the next action.** You never
choose from a menu; the app knows where the package is and asks for the one
thing that moves it:

| Where it is | The button says | What you do |
|---|---|---|
| Session done, not yet checked | *(no button)* | Double-click the row → review the work order → Complete it |
| Reviewed | **Attach invoice** | Make the invoice in QuickBooks, attach the PDF |
| Invoiced | **Approve** | Waits on an owner — Eli or Adam-Mike. Not you. |
| Approved | **Download** | Build the invoice+work-order package PDF |
| Downloaded | **Mark sent** | Email the package to the client, then confirm it left |
| Awaiting payment | **Mark paid** | When the cheque/ACH arrives |
| Closed | **Reopen** | If a write-off or void was a mistake |

**Double-clicking any row opens the document** — the work order, or once an
invoice is attached, the combined invoice+work-order package. Opening to read
is navigation, not an action, so it doesn't get a button.

### 8.3 Reviewing a work order (the craft of the job)

Double-click the row. You're checking the runner's story against reality:

- Times per day (and that OT lines look right — OT is computed, but a wrong
  end time makes a wrong OT).
- Rates — studio, engineer, rentals. Rates are the office's; runners can't
  edit them, so a wrong rate is ours to fix.
- Rentals and payments — everything charged, everything collected recorded.
- Missing times **block completion** — the app won't let you Complete a work
  order with unfinished days, so you'll be told exactly what's missing.

Approve each day's rows as you verify them (that's the lock, §3), fix
anything wrong — your edits appear live on every screen, including a runner's
phone — and **Complete** the work order. That lights **Reviewed**.

### 8.4 The PO rule

Some label clients require a purchase-order number on the invoice. In PRSFlo,
**the PO is a precondition of approval, not of sending**: an owner can't
approve a package until either a PO number is on the work order or it's
marked "No PO needed." So the habit to build: while reviewing, note the PO or
tick No-PO. The Approve button shows but stays disabled until it's sorted —
a disabled button with a reason beats discovering the gap after sign-off.

### 8.5 Guardrails you'll notice (they're features)

- **Editing an approved package un-approves it — by itself.** An owner
  approved $1,680, not "whatever this becomes." Change the numbers and it
  quietly returns to Invoiced for re-approval.
- **Drift flag.** If a work order is edited after its invoice was attached,
  the row flags that what PRSFlo says is owed no longer matches what the
  client was billed. Better to hear it from the app than from the client. A
  *sent* invoice never silently un-approves — history isn't rewritten; use
  **Pull it back** to deliberately restart the cycle.
- **Stale download reminder.** Downloaded but not marked sent within 2 days
  goes hot — the reminder that keeps the two-step send (Download, then Mark
  sent) from stranding a finished package in your Downloads folder.
- **Cancelled sessions with a live invoice don't vanish.** The client still
  owes the money; void it properly through Closed, with a reason on record.

### 8.6 The COD side

Flip the toggle. Three tabs:

- **Balance due** — leads the side, always. A COD session where collection
  was missed. Rare, and the single most important thing in your world when it
  exists. The balance is collected and recorded on the work order itself
  (double-click), so the money and the record stay together.
- **Needs review** — money's in; check the work order and attach the invoice.
  For COD that's the whole line: Reviewed, Invoiced, done.
- **Paid** — settled sessions.

COD money really is recorded in PRSFlo (payments taken at the desk go on the
work order), which is why "Collected this month" on this side is real. On the
Billing side, remember: cheques and ACH never touch PRSFlo — **Mark paid** is
the record that money arrived, so press it the day it does, not eventually.

## 9. Aging and AR

**Aging runs from the day an invoice was SENT — never from the session
date.** A session invoiced three weeks late is not three weeks overdue; the
clock starts when it actually left. **31+ days past sent** is the past-due
threshold — it's the alert figure at the top of the hub, and those rows are
the chase list. The weekly Monday follow-up pass (§6.1) is where chasing gets
systematic: sent >14 days with no touch in 7 gets a call or an email.

"Received this month" counts what was *marked paid* this month (plus recorded
COD money). It's a floor, not the books — anything that went straight into
QuickBooks without a mark here won't show. Which is one more reason Mark paid
matters: it's the only record on our side that the money came in.

## 10. When something looks wrong

- **A number that can't be right** (a balance on a paid session, an OT charge
  on a short day): open the work order and read the rows — every total is
  computed from them, so the answer is always in the rows.
- **The app said "NOT saved"** (red toast): the write failed and it's telling
  you honestly. Try again; if it persists, tell Eli — errors are logged and
  he can see them.
- **Something in the manual doesn't match the screen:** the app changed and
  the manual didn't. Say so — this document is meant to be corrected, and the
  release notes under SOP → Versions say what changed in each release.

## 11. Words this manual uses

- **Work order (WO)** — one session's billable paperwork; created with the
  booking; becomes the invoice's backing document.
- **COD** — paid at the desk. **Billing** — invoiced after.
- **Complete / Reviewed** — you checked the WO; it's accurate.
- **Approve (a day)** — locking a runner's day sheet after verifying it.
- **Approve (an invoice)** — an owner signing off the package. Owners only.
- **Package** — the merged invoice + work-order PDF that goes to the client.
- **Drift** — the WO changed after invoicing; billed ≠ owed.
- **Duty** — a recurring My Day item. **Backlog** — its missed prior days.
- **Queue** — a computed list (needs-WO, balances, holds); empties itself.
- **Flo** — the dashboard briefing; computed, rule-based, no AI.
