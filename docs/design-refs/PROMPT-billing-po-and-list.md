# Prompt — Billing hub: post-approval PO flow + the invoice list

*Hand this whole file to the session. Written 2026-09-03. It is self-contained:
everything below is either a fact about the repo or a ruling from Eli.*

---

## Who you are and how this repo works

You are working on **PRSFlo**, a single-tenant studio operations app for
Paramount Recording Group (four studios in Los Angeles, ~9 staff). Next.js 16
App Router, React, TypeScript, Supabase (Postgres + Auth + Storage + Realtime),
deployed on Vercel from `main`. Styling is inline `style={{}}` with CSS
variables — no Tailwind.

**Before you write a line of code, read these, in this order:**

1. `CLAUDE.md` (repo ROOT, not `docs/`) — the binding rules.
2. `docs/ONBOARDING.md` — especially §4 (the mental model) and §5 (landmines).
3. `docs/working-conventions.md` — how Eli works. §1 and §3b are not optional.
4. `docs/CHANGELOG.md` — the v1.20.0 entry (Sep 1) and its seven watch-outs.
5. `docs/PROJECT_LOG.md` — the **Aug 11–12** entry (the billing hub's founding
   rulings) and the **Sep 1** entry (approvals queue, WO history).
6. `lib/billing.ts` — the header comment top to bottom, then the whole file.

**The workflow, which is absolute:**

- **You edit files. Eli runs all git.** Never run `git add`, `git commit` or
  `git push` from your shell — a sandbox git write wedges the repo for every
  process on the machine and has silently destroyed a day's work once
  (working-conventions §3 and §3b). Read-only git is fine.
- End every change set with **ONE copy-paste terminal line**, starting with
  `rm -f .git/index.lock .git/HEAD.lock`, staging files **by name**. Never
  `git add -A` — several sessions share this working tree.
- **Migrations are run by hand** by Eli in the Supabase SQL editor, *before*
  the code that needs them ships. Give him the full SQL as a copyable block.
  Write them idempotent. A migration file in the repo is **not** proof it ran.
- **Work mock-first for anything visual.** Build a static options page in
  `docs/design-refs/` (the preview runs **no JavaScript** — static markup
  only), Eli picks, then you build. Two mocks for this work already exist and
  you must read them: `billing-row-options.html` and
  `billing-po-flow-options.html`.
- Run `node scripts/selftest.mjs` before every hand-off line. The three
  warnings are known baseline debt; you answer for the **delta** you add.
- **Do NOT do text-range surgery on `app/(main)/billing/page.tsx`.** Use
  uniquely-anchored explicit edits only. Cutting between two matched strings
  once deleted the package window and the ⋯ menu (PROJECT_LOG, Aug 11–12).
- There is no automated test suite, by decision. Verification is manual on a
  Vercel preview URL. `npm run dev` does not work locally.

---

## The billing model — the part you must not get wrong

**The one rule everything hangs off: PRSFlo owns the workflow and the
documents; QuickBooks owns the money.** Nothing in PRSFlo claims to be the
accounting.

**STORED vs DERIVED.** COD buckets are COMPUTED from payments (nobody files a
COD invoice, and a stored state would create a second number that can disagree
with the screen). Billing buckets are STORED, because nothing in the app can
know that an owner approved something or that a cheque cleared. The one stored
state a COD work order carries is `invoice_state='approved'`.

**Two pipelines, not one.** `billing` (assemble → approve → send → chase →
paid; days to weeks) and `cod` (money is already in → check it → done;
minutes). They share a work order and nothing else.

**The ladder** (`deriveStep`, 0–5): 0 open · 1 reviewed · 2 invoiced ·
3 approved · 4 sent · 5 paid. Three lights on the row read from it.

**`nextAction(row)` is the single source of "what does this row's button
say".** `approvalQueue` membership **IS** `nextAction(r) === 'Approve'` —
never re-implement that predicate anywhere. The Rail badge, the dashboard
banner, the hub's sweep strip and the row all read one derivation; a badge
saying 3 over a strip showing 4 is worse than no badge.

**Approval is owners-only**, enforced by the `enforce_invoice_approver`
Postgres trigger. The UI check exists only to give a decent message.

**Drift.** `invoiceDrift` is true when the work order's total no longer matches
`invoice_total` (the snapshot taken when the invoice was attached). If a row is
approved (step 3) and drifts, `deriveStep` demotes it to 2 — **editing an
approved package voids the approval, derived, never written**. Deliberately NOT
applied once SENT: that invoice is with the client, and silently un-approving
it would rewrite history rather than describe it.

**The PO blocks SENDING, not approving** (Eli's ruling 2026-08-31, reversing
his own Aug 11 one). Approval says "this work order is complete and the invoice
is right" — knowable the day the session ends. A label's PO can take weeks.

**Aging runs from `invoice_sent_at`, never the session date.**

**Realtime:** `work_orders` and `payment_rows` go through
`hooks/useWoInvoicesVersion` (one shared channel). Never open another channel
on those tables from a surface that can share a page with its consumers.

**Money math only through `lib/woTotals.ts` (`computeWoTotals`).** Never
restate `10`, `0.10`, `0.03` or `1.03` inline.

**`lib/woPdf.ts` and the WO screen are two descriptions of one layout** — a new
SECTION on either must be added to both. Actual times
(`actual_from_time`/`actual_to_time`) are internal-only: no money math, never
on the client PDF.

---

# TASK 1 — Adding a PO after approval

## Eli's words, distilled into law

> "The only time we need to touch an invoice after approved is scenario one:
> something was incorrect and just needs to be corrected. For this, the rules
> apply — if we're changing a work order, it needs to go back through the
> review process again. Any error made, it needs to be reviewed, new invoice,
> and re-approved by owner, period.
>
> The second scenario is approved sessions with no errors, but only the PO
> needs to be added at a later date. This does not need to go back through
> owner approval, period. However, updating the PO means changing the work
> order, also updating the PO on the invoice, potentially changing a date for
> the PO on the invoice, reattaching the invoice, and then sending it out.
> So we really just need to think about a scenario for adding POs after the
> fact, remembering that POs also mean new PDF. I want a very streamlined way
> to do this. We can rethink the whole view of the billing section for adding
> POs and resending if needed."

**Scenario 1 — a correction.** Full loop: review → new invoice → owner
re-approves. No exceptions. This already happens by itself via the drift rule
above; do not weaken it.

**Scenario 2 — the PO arrived late, nothing was wrong.** Never returns to the
owner. But it is **four acts with one intention**: record the PO → the label's
re-cut invoice arrives (usually with a new invoice date) → attach the new PDF →
send. Today those are four separate screens: open the WO, type the PO, save,
return to the hub, drop the PDF, Download, Mark sent. Nothing is broken; the
path is just long enough that "the PO came in" becomes a deferred chore, which
is how a finished package sits unsent.

## What already works (verify before changing)

- Typing a PO changes no money → no drift → **the approval stands** and the
  AWAITING PO chip clears itself. `awaitingPo` is derived, never stored.
- `uploadInvoiceDoc` only *advances* a work order whose state is
  `needs_invoice`, so dropping a replacement PDF on an approved row **keeps the
  approval**.
- The package is rebuilt live from the current record on every preview and
  download (`previewPackageUrl` / `/api/wo-package`), so "auto-updates" is
  existing behaviour, not something to add.

## Two real holes found on 2026-09-03 — fix these as part of the task

1. **A replacement invoice silently re-baselines an approved total.**
   `uploadInvoiceDoc` writes `invoice_total: row.total` on *every* attach. So:
   edit a rate after approval (drift → demoted to Needs approval), then drop a
   new PDF → the snapshot updates, drift disappears, and the row reads Approved
   again **with no owner involved**. That is a hole straight through scenario 1.
   Intended fix: on a *replacement* attach (row already past `needs_invoice`),
   leave `invoice_total` alone. A pure PDF swap then keeps approval (money
   unchanged → no drift), while a swap after a money change correctly still
   needs the owner. Confirm the reasoning holds before implementing.

2. **Re-downloading a sent package overwrites the as-sent artifact.**
   `app/api/wo-package/route.ts` stores the bytes it serves at
   `work_orders.invoice_package_path` on every non-`wo=1` call. Pull the file
   again a month later and it rebuilds from *today's* work order and replaces
   the record of what the client actually received. The standing rule is that a
   rebuild must never touch an as-sent artifact. Intended fix: once
   `invoice_sent_at` is set, re-download serves the STORED bytes and does not
   re-upload. Note the deliberate exception: a genuine re-send (see below) is
   allowed to produce a new artifact.

## The proposed design (mock exists — read it)

`docs/design-refs/billing-po-flow-options.html` has three options and a
recommendation. Summary:

- **A (recommended).** An approved row that cannot go out for want of a PO
  currently shows a greyed Download plus an explaining chip. Instead its
  `nextAction` becomes **Add PO**, opening one panel that runs all four steps:
  PO number (written to the same `work_orders.po_number` field) → drop the
  re-issued invoice (replaces the attached one) → package rebuilds itself →
  Save & download. The row's button is then **Mark sent**, exactly as if the PO
  had been there all along. The approval is untouched throughout.
- **B.** A + an **Awaiting PO** tab so the waiting-on-labels pile is visible
  (a PO can run for weeks; those rows currently hide inside In progress looking
  like unfinished work). A chip counts days since approval. Costs one more tab,
  which the nine-tab lesson says to weigh carefully — hence a separate option.
- **C.** Inline PO typing on the row. Recorded as weak: it hides that a PO
  means a NEW INVOICE, and the likely outcome is a PO typed against the old
  PDF — a package that contradicts itself.

**Already-sent rows:** if a PO turns up after sending, the same panel opens
from ⋯ → **Add PO & re-send**. It re-stamps the sent date (a second document
really did go out) but the **aging clock keeps its original date** — the client
has owed this since the first send.

**A ruling this reverses, and Eli must confirm it:** 2026-08-11, *"adding a PO
is done on the WO. One place, easily understood."* That was right when a PO was
just a number on paperwork. Post-approval it now drags a new PDF and a send
with it — both billing-hub acts — so keeping the field only on the WO means the
other three steps happen elsewhere, which is the two-doors problem the ruling
was written to prevent, pointing the other way. The WO's PO field stays for the
normal case (PO known at booking).

---

# TASK 2 — The invoice list: badges, ordering, day splits

Eli, same session: *"can we have the colored status pills on the billing one
like we have it for the COD? and can we also have the columns header click and
filter? and also like the CRM can it have a little day header in the list?"*

His answers to the follow-up questions:

- **Header click → SORT ONLY.** No filter menus. (Reasoning worth keeping: the
  buckets already *are* the filters; a second filter layer would fight them.)
- **Day headers group by SESSION DATE.**
- **The pill's meaning → no preference; the designer's call.**

The existing mock is `docs/design-refs/billing-row-options.html`. Its
recommendation, which you may argue with if you have a better one:

- **The pill names where the row is STUCK**, not which bucket it is in: Needs
  review · Needs invoice · Needs approval · Ready to send · Returned ·
  Sent·aging. Rationale: inside one tab every row already shares the bucket, so
  a bucket badge prints the same word down the whole list; what the eye is
  hunting is which of those rows is waiting on *you*. Colour follows the house
  law — amber waits on a person, teal is clear to go, hot is wrong. The three
  lights stay; the pill names the one outstanding thing.
- The **bucket badge** (COD's existing `c-bbin`) stays for **search results**,
  which legitimately span every bucket.
- **Sorting:** WO · Client · Status · Balance · Age. "Next" is not sortable —
  it derives from the step, so sorting by it is sorting by Status under a
  confusing name. Click to sort, click again to reverse, arrow marks the active
  column.
- **Day dividers appear only while the list is sorted by date** (the default).
  Sort by Balance or Age and they switch off — a "Tue, Sep 2" heading over
  money-ordered rows lies about what follows it — and they return when you sort
  by date again.

All three are display-side: the pill and the dividers read data the rows
already carry, and sorting is a client-side comparator over the list the tab
already produced. **No new state, no migration.**

---

## Constraints on both tasks

- **Never re-implement `nextAction` or `approvalQueue`'s predicate.** If "Add
  PO" becomes a row action, it must come out of `nextAction` so the badge,
  banner, sweep strip and row cannot disagree.
- Rows open on **single click** (Sep 1, reversing Aug 11); action / ⋯ / approve
  cells swallow their own clicks.
- The package window's **Package tab is the LIVE B&W build**
  (`previewPackageUrl`) and exists **pre-send only**. Saving the digital WO in
  that window invalidates the cached build.
- Blocks (Tour/Tech/Open Hours) and tentative sessions are filtered **only
  before the pipeline**. Once a work order has an `invoice_state` it stays
  visible whatever happens to the booking, so it can be voided properly through
  Closed with a reason on the record.
- Every important Supabase write goes through `dbResult(label, error)` from
  `lib/db.ts`. Silent writes are the app's #1 audited defect class.
- `noImplicitAny` is on and must stay passing.

## What to produce

1. Read everything listed at the top, plus the two existing mocks.
2. **Push back if you disagree** with any recommendation here — Eli's rulings
   are binding, but the design proposals are mine and are not. Say so plainly
   and explain the trade-off; a session that improves on this is doing its job.
3. If your design differs materially from the existing mocks, write a new
   static options page in `docs/design-refs/` and let Eli pick before building.
4. Then build, in this order: `lib/billing.ts` model changes (including the two
   holes) → `app/(main)/billing/page.tsx` UI → any route change in
   `app/api/wo-package/route.ts`.
5. Run `node scripts/selftest.mjs`, then hand Eli ONE git line staging files by
   name. No wrap-up (PROJECT_LOG / CHANGELOG / Tech-Stack / SOP VERSIONS / test
   batch) until he says so — but expect to do all five together when he does.

## Open questions for Eli — ask, don't assume

1. Option **A** alone, or **A + B** (the Awaiting PO tab)?
2. Does the Aug 11 "PO is edited on the WO only" ruling get formally reversed
   for the post-approval case?
3. When a PO arrives on an invoice that was already **sent**, does a re-issued
   invoice actually go back to the label? (If no, the re-send path is dead
   weight and should not be built.)
4. Should the **Awaiting PO** chip's day counter start at approval, or at the
   moment the package was first downloadable?
