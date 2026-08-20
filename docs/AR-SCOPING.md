# Accounts Receivable in PRSFlo — scoping note

### Raised by Eli 2026-08-10, mid My-Day build. NOT scheduled. This captures the real
### workflow, three rulings, and the questions still open, so none of it dies in a chat log.

---

## 1. How AR actually works today

Accounting lives in **QuickBooks**. Around it Eli runs a **Dropbox folder system** that
is, in practice, a hand-maintained status field:

```
COD/
  COD with balance
  COD paid
Billing/
  Needs approval (from Eli)
  Approved — waiting on PO
  Sent & open
  Sent & paid
```

Per invoice, the loop is: raise it in QuickBooks → **export the invoice PDF** → **scan
the work order** → **combine the two** → **upload to the right folder** → drag it
between folders as its status changes.

**The two observations this note turns on:**

1. **The folders are a state machine.** Six folders, six states; filing is a status
   change. That is a field, not a filing system.
2. **The scanning step is a fossil.** It exists because the WO used to be paper.
   PRSFlo already renders the work order as a PDF (`window.print()` inside
   `WorkOrderPopup`, `@media print` CSS). Nothing needs scanning or combining by hand.

## 2. The interim architecture (before QuickBooks is connected)

> **PRSFlo owns the workflow and the documents. QuickBooks keeps owning the money.**

This is the answer to the source-of-truth problem. The earlier draft of this note
worried about two sets of books — that risk disappears once PRSFlo is not claiming to
know the accounting. It knows **where each invoice has got to in Eli's process**,
which is precisely what the Dropbox folders know today, and nothing more. QuickBooks
remains authoritative for balances, aging and zeroing out.

### What can be automatic vs. what stays a button

- **COD: mostly automatic.** PRSFlo already holds COD charges and COD payments
  (`payment_rows`), and `lib/woTotals.ts` computes the balance. *With balance* vs
  *Paid* is therefore **derivable** — a bucket PRSFlo can place the invoice in, not
  one Eli files into.
- **Billing: manual, and honestly so.** Nothing in PRSFlo can know a cheque cleared
  three weeks later. *Needs approval → Approved → Sent → Paid* stay explicit actions
  until QBO lands. Pretending otherwise would produce a confidently wrong AR screen.

## 3. Rulings (Eli, 2026-08-10)

1. **PRSFlo staples the documents.** Eli uploads only the QuickBooks invoice PDF;
   PRSFlo combines it with the work order it already has. The scan-and-combine step
   is deleted, not digitised.
2. **The PO wait is a chase state for PO-requiring clients.** In Eli's words: *"this
   is when the client, that require a PO, is dragging on getting us a PO, but I have
   approved the invoice and WO already."* So: approval has already happened, the
   invoice cannot go out yet, and the blocker is the client. Implies a **per-client
   "requires PO" flag** — `clients` has no such column today (`bookings.po` and
   `work_orders.po_number` hold the number, not the requirement). Only those clients
   route through this bucket.
3. **Dropbox is replaced entirely.** PRSFlo becomes the only home for invoice
   documents and their status. See the backup watch-out in §6 — this ruling has a
   hard prerequisite.

## 4. The state machine to build

```
COD          →  With balance  →  Paid
Billing      →  Needs approval  →  Approved  →  [Waiting on PO]  →  Sent & open  →  Sent & paid
```

- `[Waiting on PO]` is entered only when the client requires a PO and none has been
  received. Entering a PO number moves it on.
- COD transitions are computed from payments; billing transitions are actions.
- Terminal states needed that the folders don't have: **written off** and
  **cancelled/voided**. A folder system can express these by deletion; a status field
  cannot, and pretending an unpaid invoice is still "open" forever will pollute aging.

## 5. Rough shape, smallest useful first

Per the standing working method this is an undesigned surface: **2–4 HTML mockups in
`docs/design-refs/` → Eli picks → ruling into the spec → build.** Not straight to code.

1. **AR status on the work order** + the per-client requires-PO flag. Migration.
2. **Invoice document attach** (private bucket + signed URLs — the pattern already
   exists for `client-ids` / `checklist-photos`) and **combined WO+invoice export**.
3. **The AR screen** — the six buckets with counts, which is the Dropbox window
   replaced. Reuses `fetchBalancesQueue()` from `lib/myday.ts` for the money.
4. **Client account roll-up** — what a given label owes across all invoices.
5. **Aging buckets** (0–30 / 31–60 / 61–90 / 90+) once there's a sent-date to age from.
6. **QBO integration** — retires the manual half; the buckets survive unchanged.

## 6. Watch-outs

- **⚠ THE BACKUP DOES NOT COVER UPLOADED FILES.** `scripts/backup.mjs` backs up 17
  database **tables** to Google Drive. It does not touch Supabase **storage buckets**
  at all. Replacing Dropbox (ruling 3) would make PRSFlo the only copy of the
  invoice+WO documents, with **no backup whatsoever**. Extending the backup to storage
  is a hard prerequisite of that ruling, not a nice-to-have — Dropbox is currently
  doing backup duty as well as filing duty, and only one of those jobs is being
  replaced knowingly.
- **Do not join AR to time records.** HR-SPEC §1.2 is a hard separation, and this is
  exactly the feature that tempts someone to link an invoice to a shift.
- A WO with no line items reads as $0 owed, not "unbilled" — `fetchBalancesQueue`
  skips those deliberately. An AR view must distinguish *nothing owed* from *nothing
  entered yet*, or every freshly created WO will look settled.
- Money is stored as text app-wide; `payment_rows.amount` is numeric in the type and
  string in the form. Keep everything going through `lib/woTotals.ts` — never
  `parseFloat` at a call site.
- Documents here are financial records. Whatever retention and access rules apply,
  RLS on the bucket should be at least as tight as `client-ids`.

## 7. Still open

- **Written-off / voided** states — needed, not in the current folder system.
- **Who may approve?** Today approval is Eli personally. Owner-only, or owner+billing?
- **What starts the aging clock** — invoice sent date, presumably, which means capturing
  it at the Send action.
- **Deposits / partial payments on billing invoices** — COD handles partials through
  `payment_rows`; unclear whether billing needs the same before QBO.
- **History.** Does the existing Dropbox archive get imported, or does PRSFlo start
  from a clean slate on a go-live date? Clean slate is far cheaper and usually right.
