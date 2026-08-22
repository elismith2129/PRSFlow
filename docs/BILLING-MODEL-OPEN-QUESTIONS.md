# Billing model — what the four revenue streams actually are

*Opened 2026-08-20, building the Financials chart. Not a spec — a list of things
the app currently models one way and the business does another. Every one of
these makes a number on the revenue chart wrong or unreadable until it is
settled.*

**Read `docs/WO-SPEC.md` first** for how the work order is structured. This file
is only about what the MONEY on it means.

---

## The short version

The Financials chart draws four streams: **room, engineering, assistant,
rental**. Three of the four have a problem.

| Stream | App models it as | The business says | Status |
|---|---|---|---|
| Room | `charge` + `ot_charge` on each studio-time row | Matches | ✅ Sound |
| Engineering | `eng_rate` × hours, `eng_role='engineer'` | Billed to the client — but is it revenue or pass-through? | ⚠️ Unclear |
| Assistant | `eng_rate` × hours, `eng_role='assistant'` | **Not itemized. Included, never a separate line.** | ❌ Wrong |
| Rental | `rental_rows.charge`, one gross number | Two different things sharing one column | ❌ Wrong |

---

## 1. Assistant is not an itemized cost (Eli, 2026-08-20)

**What he said:** the assistant's number is *implied* — "we do not detail the
assistant cost as it's not an itemized cost per session, just included."

**What the app does:** `studio_time_rows.eng_role` is `'engineer' | 'assistant'`,
each staff line carries its own `eng_rate`, and `engChargeForRow` bills
rate × hours for either. `eng_role` **defaults to `'assistant'`**
(migration `20260728210000`) — so the assistant is not an edge case in the data
model, it is the default one.

**Why this matters beyond the chart.** The app produces an "assistant revenue"
figure that does not correspond to anything invoiced. Nine years of history have
no assistant column at all, so the chart's Assistant metric is empty before
Aug 2026 and then starts producing numbers — which will look like a new revenue
stream appearing, when it is really a modelling artefact.

**The questions, in the order they need answering:**

1. **When an assistant is staffed and given a rate, what is that number?**
   Three possibilities and they are not the same:
   - *Payroll* — what PRS pays the assistant. That is an EXPENSE, not revenue,
     and charting it as revenue inflates the total.
   - *A billed line that happens to be folded into another* — e.g. included in
     the room rate or the engineer rate on the invoice.
   - *Nothing* — staffing information only, with no money attached.

2. **If it is payroll**, it belongs in `direction='expense'` (the column already
   exists on `financial_history` for exactly this) and must come OUT of the
   revenue total. Right now `Total = room + engineering + assistant + rental`,
   so an assistant wage is being added to revenue.

3. **If it is included in the room rate**, then billing it separately on the WO
   is double-counting the client. Worth checking against a real invoice.

4. **What should the chart's Assistant metric do in the meantime?** Options:
   hide it entirely; keep it but label it "staffed, not billed"; or fold it into
   engineering. Hiding is the honest default until (1) is answered — a metric
   nobody can explain is worse than a missing one.

**Do not "fix" this by changing `eng_role` defaults.** CLAUDE.md warns that the
default is threaded through seven places that must stay in step. The question
here is what the MONEY means, not what the role field says.

---

## 2. Rentals are two businesses in one column

**What he said:** "we rent our gear for the full cost, and we contract rental
companies and charge 30% fee. we'll have to work that into the WO."

So there are two kinds of rental and they have opposite economics:

| Kind | Client pays | PRS keeps |
|---|---|---|
| PRS-owned gear | Full rate | **100%** |
| Contracted in from a rental house | Full rate | **30% fee** |

**What the app does:** `rental_rows` has one `charge` column and no flag. Every
rental is treated as if PRS keeps all of it.

**What the archive does:** the spreadsheet's column is **"Rental Profit"** —
already PRS's share. So the nine years of history are *net* and the live data is
*gross*, and the chart is quietly mixing them.

**Scale of the error:** rentals are only $541k of $51.7M historically — about
1%. So this is not urgent for the chart's overall shape. It becomes urgent the
moment anyone reads the Rentals metric on its own, because the line will step up
at the changeover for a reason that is not growth.

**What the WO needs:**

- A per-rental **kind** (`owned` | `contracted`), or equivalently a vendor field
  that is null for owned gear.
- The **fee percentage** stored per row, not hardcoded — 30% is today's number,
  and a rate that lives in code becomes a lie the first time it is negotiated.
- Both the **gross** (what the client is invoiced) and the **PRS share**
  (what the studio earned) available, because the invoice needs one and the
  revenue chart needs the other. Storing one and deriving the other is fine;
  storing only one and forgetting which is what created this problem.

**Then decide what the chart plots.** Gross rentals and net rentals are both
legitimate figures and they answer different questions. Pick one, label it, and
make history match — the archive is already net, so plotting gross would require
grossing the history up by an assumed margin, which is an invention.

---

## 3. Engineering — revenue or pass-through?

Less broken than the two above, but unresolved. `eng_rate` × hours is billed to
the client. Whether the engineer is paid out of that, and at what margin,
is not modelled anywhere.

For the chart this only matters if Eli ever wants to see **margin** rather than
**billings**. Today the chart is explicit that it shows what was billed, by
session date, not what was collected or kept. That is a defensible line to hold —
but it means "Engineering: $7.2M over nine years" is gross billings, not profit,
and should never be read as the latter.

**Question:** is there an intent to track engineer payouts in PRSFlo at all, or
does that stay in QuickBooks/Ramp? The answer determines whether
`financial_history.direction='expense'` ever gets used, or whether it should be
dropped as a column that promised something the app never did.

---

## 4. The framing question underneath all three

**Is the Financials chart about REVENUE or about MARGIN?**

Right now it is honestly labelled as billings — "billed by session date, not
payments received". But:

- rentals are already margin (history) mixed with gross (live),
- assistant may be an expense sitting inside a revenue total,
- engineering is gross with an unmodelled payout.

So it is *mostly* billings with two leaks. Each leak is fixable, but the
decision that makes them all coherent is the framing one, and it should be made
before more streams are added rather than after.

**Recommended order of work:**

1. Answer §1 Q1 — what an assistant's number is. Cheapest question, biggest
   correctness win, and it is currently adding to a revenue total.
2. Add rental kind + fee to the WO (§2). Needs a migration and WO UI.
3. Decide revenue-vs-margin framing (§4) once 1 and 2 are known.
4. Engineering payouts (§3) only if margin is wanted.

---

## What was deliberately NOT done in the meantime

The chart ships with all four streams visible and the rental caveat printed
under it. The alternative — hiding Assistant and Rentals until this is settled —
was considered and rejected: a chart that silently omits streams is harder to
correct later than one that shows them with a stated caveat, because nobody
remembers what was hidden. The caveat is in the UI, not just in this file.
