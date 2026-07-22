# WO-SPEC — The Unified Work Order (Booking = WO)

_Spec + build plan. Read before writing any component code. Authored 2026-07-21._
_Ground rule: this replaces the two-form (BookingForm + WorkOrderPopup) model with ONE form._

---

## 1. The decision, in one paragraph

There is no more "booking form." A lead in the CRM converts directly into a **single Work Order** that lives on the calendar. That WO is the only thing a user opens, from any entry point. The top of the WO holds **session-level info that does not vary by day** (status, client, session type, billing). Everything that varies by day — studios, dates, times, hours, rates, OT, engineers — lives **only in the Studio Time table**, which is the single source of truth for the schedule. Under the hood a lightweight `bookings` row still exists so the calendar and runner app can render fast, but the user never edits it directly: it is a **projection** recomputed from the WO on every save.

This kills the two-sources-of-truth problem at its root. The old pain (≈2 weeks of clunk) came from **two forms both writing the same fields**, which required bidirectional sync that is genuinely hard to get right. With one form, sync becomes one-directional and deterministic: **WO → booking projection**, always, on save.

---

## 2. Why this is the right model (and low-risk)

- We are deleting a **UI** (`BookingForm.tsx`), not a **table**. `work_orders`, `studio_time_rows`, `equipment_condition_rows`, `rental_rows`, `payment_rows`, and every runner-hub / daily-ops / LocationStrip query that resolves a WO by `booking_id` **keep working untouched**.
- The `bookings` row becomes a **denormalized read model** (calendar/runner projection). It is written by the WO save, never edited by a user form.
- Two mechanisms we need already exist in the code:
  - `lib/createWorkOrder.ts → createWorkOrderForBooking()` already generates one `studio_time_rows` row per day across the date range. **This is the Seed, already built** — we're exposing and re-firing it, not inventing it.
  - `app/(main)/calendar/page.tsx → handleSave()` already computes `woOwnsSchedule` (true once the WO has ≥1 dated `studio_time_row`) and, when true, **stops writing `start_date/end_date/from_time/to_time` from the form**. That is the projection-ownership rule, already partly wired.

---

## 3. Field map — where every field lives after the rebuild

### 3a. WO TOP — session-level, does NOT vary by day

| Zone | Fields | Notes |
|---|---|---|
| WO number | `WO-####` — permanent, unique, assigned at WO creation | Always present (unlike invoice #, which is set later at billing). Shown in the WO header and on every calendar card so the correct WO is unambiguous. New `work_orders.wo_number` column, backed by a Postgres sequence. Needs a migration (Eli reviews). |
| Status bar | Confirmed / Tentative / Cancelled / Tour / Tech / Open Hours | Writes `bookings.status`. Tech/Tour/Open-Hours/Cancelled → no WO body (locked PRSFlo rule via `bookingShouldHaveWorkOrder`). |
| Client panel | SRS toggle · COD/Label-Billing toggle · client search + autofill · client card (artist, A&R contact w/ email·call·text, admin contact, view full profile) | Lifted wholesale from `BookingForm`'s right column. This is the piece to extract into a shared component. |
| Session type | Recording / Filming / Event Playback | Session-level attribute; gates WO existence. |
| Billing | Invoice # · PO # · Payment (COD/Billing) · Food budget (+ amount) | Session-level, non-schedule. |

### 3b. STUDIO TIME TABLE — the schedule, source of truth (varies by day)

Per-row (each row = one day): **studio · date · session info · from · to · hrs · type (Day/Hr) · rate · OT hrs · OT rate · OT chg · total**, plus the **engineer sub-row** (eng from/to, eng hrs, eng rate, eng charge). All already implemented — **untouched** except that it becomes the *only* home for these fields.

### 3c. REMOVED from the WO top (was the screenshot block; now table-only)

Studio selector · Rate /HR·/DAY toggle + amount · Start Date · Multi-day checkbox · From–To times · Engineer + status · Assistant · Eng Rate. **All deleted from the top.** They live in the table.

### 3d. Below the table — UNTOUCHED

Equipment Condition · Rentals · Session Notes · Payments · Needs-Attention/Runner Notes · Signature · totals.

---

## 4. The projection: one WO → one-or-more calendar cards (per-room-segment)

**The relationship inverts.** Today: `work_orders.booking_id → bookings.id`, `UNIQUE(booking_id)`, one booking per WO. New model: the **WO is the spine**, and `bookings` rows become **calendar cards derived from it** — `bookings.work_order_id → work_orders.id`, one WO to **many** bookings rows. Each bookings row = one calendar card. The user never edits a bookings row; the projection writes them.

**Segmentation rule (how many cards a WO produces).** Take the WO's dated studio rows (exclude eng sub-rows), sort by date, then walk them into **segments**: a new segment starts whenever the **room changes** or the **date is non-consecutive**. Each segment → one bookings row (one card).

- Single day → 1 segment → 1 card.
- 3 days all in Studio X → 1 segment → 1 spanning card (today's behavior, preserved).
- Week where Mon/Wed = X, Tue = A → 3 segments → 3 cards (X-Mon, A-Tue, X-Wed), all opening the **same WO**.

**Per bookings/card row, derived from its segment + WO:**

| bookings column | derived from |
|---|---|
| `work_order_id` | the WO (stable link; how the card opens the WO) |
| `location` / `studio` | the segment's room |
| `start_date` / `end_date` | the segment's first / last day |
| `from_time` / `to_time` | segment's first-day times (card summary; per-day times read from rows) |
| `status` | WO status bar |
| `client_name` / `artist` / `label` / `ordered_by` / `phone` / `email` | client panel |
| `engineer_name` | that segment's engineer(s) |
| `session_type`, `payment_type`, `is_srs`, `invoice_num`, `po`, food_* | top-section fields |

**Write mechanics (avoid id churn):** on WO save, **upsert** projection rows keyed on `(work_order_id, studio, start_date)`, and delete only the WO's projection rows that no longer correspond to a segment. This keeps card ids stable across saves so mid-session runner links don't break.

**Runner link stability:** runner navigation keys on the **WO id** (stable), with `booking_id` as a secondary hint — so regenerating cards never orphans an in-progress runner.

Projection consumers (read `bookings`, resolve/open WO — mostly **unchanged**, but must tolerate many-cards-per-WO): calendar grid, runner hub (`/runner/[studio]`), LocationStrip drawer, dashboard room grid, DailyOpsLogSection.

---

## 5. Multi-day + per-day room (Eli: room changes MUST reflect on the calendar)

- **Edit in one place:** change any row's studio/date/time/rate/engineer in the WO table → save → the calendar updates. Single-day: change the day, the card moves. Multi-day: change a day's room, **that day's card moves to the new room** (via the §4 segmentation).
- **Every room-run is its own card**, all pointing at the same WO. Contiguous same-room days collapse into one spanning card; a room change or date gap starts a new card.
- **Per-day independent times:** each row already owns `from_time`/`to_time`. Removing the single top From–To makes per-day times fall out for free. Display work: runner hub + calendar card show *that day's* times.

---

## 6. The Seed panel (bulk row generation — always available)

Problem: a 30-day session must not mean hand-building 30 rows; and a client extending another 2 weeks must be one action, not 14.

Solution: a **collapsible "Seed" panel directly above the Studio Time table**, available **at all times** (not just first fill). Inputs: studio · date range (start–end) · from/to · rate + Day/Hr · engineer + eng rate. Action: **Add rows** → creates one `studio_time_rows` row per day in range (reusing the `createWorkOrderForBooking` seeding logic, extracted into a shared `seedStudioTimeRows()` helper).

Hard rules: **the Seed is a row generator, not a data store** — it writes rows into the table and gets out of the way; never a second source of truth. It **only ever appends** — for any date that already has a row, it skips (never overwrites). So "add another 2 weeks" = open Seed, set the new range, Add. Grow = Seed or add-row; shrink = delete row; re-rate/re-time/re-engineer = edit the row.

---

## 7. Calendar card (keep the connected multi-day card, show per-day info)

Each same-room run is one spanning card (§4). Enrich it so a multi-day card surfaces per-day detail (that day's time/engineer) on hover/expand, and show the **WO number** on the card. A room change produces a separate card in the new room (§4/§5), so "each day follows the WO onto the correct room" is a structural guarantee, not just a visual.

---

## 8. Three entry points → one WO view

1. **Lead → Start Booking** (99%): create the WO (assigned a `WO-####`), seeded from the lead (client, rate, dates, engineer) → project cards → open WO. Client panel pre-filled.
2. **Empty calendar day** (double-click, existing `openNew`): create a blank WO → open it. Client attached via the in-WO search; rows added via Seed/table.
3. **Existing card click:** open that card's WO (via `work_order_id`) to view/edit. Any of a WO's cards opens the same WO.

All three land in the same Work Order view (the component currently named `WorkOrderPopup`). `BookingForm` is deleted.

---

## 9. Runner side — what changes: NOTHING structural

- **Runner hub is per LOCATION, not per room.** 4 buttons (Paramount / Ameraycan / Encore / Track). Click one → the WOs for that location's sessions today. Runners aren't tied to sessions — one runner can cover several sessions and even several locations in a day. The only requirement: the WOs shown at a location are **accurate, matching the calendar**. This is automatic — the runner hub and calendar both read the same projected cards (§4), filtered by `location` + date. Room changes within a location are invisible to the runner (correctly). A session spanning two locations shows under each location on the right day.
- `/runner/[studio]/wo/[id]` keeps its **read-only** SESSION INFO card at top (plain display: Client, Artist, Engineer, Date, Time, Studio). Runner **cannot edit the top section** — confirmed. Runner edits the Studio Time table + equipment + payments + notes + signature, exactly as today.
- Admin approval / completion lock (`work_orders.status`, completed → runner read-only) unchanged.
- Only possible enrichment: show *per-day* time on the runner card for multi-day (cosmetic).

---

## 10. Build order (each step = its own branch, verified on a preview URL)

Sequenced low-risk → high-risk. Steps 1–4 change nothing the user sees until step 6 flips the entry points, so we build the pieces safely behind the existing form first.

1. **DB migration — `wo_number` + `bookings.work_order_id`.** Add `work_orders.wo_number` (text, unique, from a Postgres sequence, assigned on insert) and `bookings.work_order_id uuid → work_orders(id)`. Keep the old `work_orders.booking_id` for now (drop later). Idempotent SQL, Eli reviews before running.
2. **Extract `ClientPanel`** — pull the client search + autofill + card (BookingForm right column, ~500 lines) into `components/shared/ClientPanel.tsx`. Wire it back into `BookingForm` unchanged first, to prove parity. (Pure refactor, zero behavior change.)
3. **Extract the Seed helper** — factor row-generation out of `createWorkOrderForBooking` into a shared `seedStudioTimeRows()` (append-only, skips existing dates) both paths call.
4. **Rebuild the WO top** — replace the flat META block in `WorkOrderPopup` with: WO number + status bar + `ClientPanel` + session type + billing bits. Delete studio/rate/date/time/engineer from the top. Add the collapsible **Seed panel** above the Studio Time table.
5. **Projection on save (the high-risk step, isolated)** — on WO Close & Save, run the §4 per-room-segment projection: upsert one `bookings` card row per segment keyed on `(work_order_id, studio, start_date)`, delete stale segments. Point the calendar/runner reads at `work_order_id`. Verify a single-room multi-day session still yields exactly one card (parity) before testing room-change splits.
6. **Calendar opens the WO directly** — repoint `openNew` / `openEdit` / card-click at the Work Order view; drop the `BookingForm` intermediary. WO number shows on the card.
7. **Enrich the calendar card** (§7) + per-day runner time (§5) — cosmetic.
8. **Delete `BookingForm.tsx`** and its imports once 1–7 are proven on preview.
9. **Cleanup migration** — once nothing reads `work_orders.booking_id`, drop it + the old `UNIQUE(booking_id)`. Eli reviews.
10. **Verify** every projection consumer (calendar, runner hub, LocationStrip, daily ops, dashboard grid) renders with one-WO-many-cards. Manual browser test on preview.

---

## 11. Resolved decisions (Eli, 2026-07-21)

- **Multi-day room change → calendar:** room changes MUST reflect per-day on the calendar. Implemented via one-WO-many-cards, per-room-segment projection (§4/§5). A moved day gets its own card in the correct room; any card opens the same WO. _(Replaces the earlier "primary room" assumption.)_
- **WO numbers:** every WO gets a permanent unique `WO-####` at creation, distinct from invoice #. Shown in header + on cards.
- **Seed:** kept, always available, append-only (client extending +2 weeks = one Add). Never overwrites existing dates.
- **Session type:** session-level, one per WO. Does not live on the schedule (studio_time) table.

## 12. Confirmed — nothing outstanding

- **`wo_number` format:** `WO-1001`, sequential from a Postgres sequence. ✅
- **Runner hub scope:** per LOCATION (not room). Shows a location's session WOs for today; accuracy comes free from reading the same projected cards as the calendar (see §9). ✅

Spec is locked. Proceed to Step 1 (the `wo_number` + `bookings.work_order_id` migration).
