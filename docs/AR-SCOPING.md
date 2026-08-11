# Accounts Receivable in PRSFlo — scoping note

### Raised by Eli 2026-08-10, mid My-Day build. NOT a spec and NOT scheduled — this
### exists so the idea and its open questions survive the conversation they came from.

## 1. The gap, in Eli's words

> "We hadn't really ever finished a good path to get from complete work order to any
> usable information regarding client accounts and closed work orders, period. The
> reason being that we are mainly in QuickBooks — that's where we do accounts
> receivable aging and monitor unpaid invoices. This is also where we zero out every
> invoice, and that's currently how we're ending or completing a session or invoice or
> work order. But I like the idea of having a very easy to use and thorough space where
> we can continue to work in QuickBooks until we connect that, and then just mark work
> orders as complete, zero them out with payment information, and then be able to use
> PRSFlo as accounting and accounts receivable tracking."

Restated: **completing a work order is currently a dead end.** The WO closes and the
money conversation moves to QuickBooks, so PRSFlo can't answer "what does this client
owe", "what's still unpaid", or "how old is that debt" — even though it holds the
charges and the payments that would answer all three.

## 2. What already exists (more than you'd think)

Nothing here needs building — it is already in the app:

- **Charges.** `studio_time_rows` (room + OT + engineer), `rental_rows`.
- **Payments.** `payment_rows` — type, amount, memo, last four, recorded_at.
- **The arithmetic.** `lib/woTotals.ts` (extracted 2026-08-10) returns studio /
  engineer / rentals / grand / paid / **balance** for any WO, and is the same
  function the WO screen displays, so a number here can never disagree with one there.
- **A working balances query.** `fetchBalancesQueue()` in `lib/myday.ts` already
  lists every WO where grand > paid, sorted by size, skipping unbilled WOs. That is
  the seed of AR aging — it just has no age dimension and nowhere to live.
- **Client identity.** `clients`, `client_contacts`, and the label/A&R model.
- **COD vs billing** is already a first-class distinction (calendar §10b, WO).

So the missing pieces are the **lifecycle**, the **aging**, and the **client-account
view** — not the underlying money.

## 3. What's missing

1. **An invoice lifecycle.** `work_orders.status` is `open | completed` only. There
   is no *sent*, no *paid*, no *written off*. "Zeroed out" — Eli's actual end state —
   cannot be represented at all.
2. **Dates that aging can key off.** No invoice-sent date, no due date, no terms.
   Aging buckets (0–30 / 31–60 / 61–90 / 90+) need a clock start, and
   `session_date` is the wrong one.
3. **A client account view.** Balances exist per WO; nobody can see them rolled up
   per client, which is the question actually asked ("what does this label owe us").
4. **Somewhere to stand.** No surface. `/wo-hub` lists WOs; it is not an AR screen.

## 4. The decision that shapes everything else — SOURCE OF TRUTH

**This must be answered before any of it is built, and it is Eli's call, not a
technical one.**

Today QuickBooks is authoritative: invoices are raised, chased and zeroed there.
If PRSFlo starts recording payments and marking things paid *as well*, there are two
books, and the day they disagree nobody knows which is right. That is the classic
double-entry failure and it is much easier to avoid than to unwind.

Three coherent answers:

- **(a) PRSFlo mirrors, QB rules.** PRSFlo shows balances and aging computed from its
  own charges/payments, clearly labelled "as far as PRSFlo knows". Nothing here is
  claimed to be the books. Cheapest, safest, and useful immediately — but Aaron ends
  up entering payments twice, which is the thing most likely to make it rot.
- **(b) PRSFlo rules for studio work, QB for the rest.** PRSFlo becomes authoritative
  for session invoices end to end; QB receives them. Requires the lifecycle in §3 and
  a real hand-off, and only works once someone stops zeroing invoices in QB by hand.
- **(c) Wait for the QuickBooks integration.** Build nothing until QBO is connected,
  then pull invoice + payment status in and let PRSFlo present it. Most correct,
  furthest away; HR-SPEC §4 already assumes this as its "Phase 2".

HR-SPEC §4 has already split AR into Phase 1 (Aaron types three numbers into his My
Day card — **built, live in the `bil_cod_followup` duty**) and Phase 2 (computed from
QBO). This scoping note is about what, if anything, sits between them.

## 5. If it goes ahead — sequencing

Per the standing working method, this is an undesigned surface: **2–4 HTML mockups in
`docs/design-refs/` → Eli picks → ruling into the spec → build.** Do not go
straight to code.

Rough shape, smallest useful first:

1. **Read-only AR view.** Balances per WO rolled up per client, with aging buckets off
   whatever date we choose. Zero new writes, zero double-entry risk, answers "who owes
   us what" on day one. Reuses `fetchBalancesQueue` almost as-is.
2. **Invoice lifecycle on the WO** — sent / paid / zeroed, with dates. Only once §4
   is answered.
3. **Client account page** — history, open items, contact, payment record.
4. **QBO integration** — replaces the manual half of all of the above.

## 6. Watch-outs

- **Do not join AR to time records.** HR-SPEC §1.2 is a hard separation and this is
  exactly the kind of feature that tempts someone to link a WO to a shift.
- `payment_rows.amount` is text in places and numeric in others; `lib/woTotals`
  coerces both. Anything new should write one shape.
- A WO with no line items reads as $0 owed, not "unbilled" — `fetchBalancesQueue`
  skips those deliberately. An AR view needs to distinguish *nothing owed* from
  *nothing entered yet*, or freshly created WOs will look settled.
- Money is stored as text app-wide. Aging and totals must keep going through the
  shared helpers, never `parseFloat` at a call site.
