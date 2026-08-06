# PRSFlo Build Spec — My Day & HR Layer

**Version:** Draft 2.0 · August 2026
**Supersedes:** "PRSFlo Build Spec — Payroll & HR Operations Layer" (Draft 1.0)
**Source protocols:** PRG-P01/R01 · P02/R02 · P03/R03 · P04/R04

---

## ⚠️ Queue position

**Do not start this before the Work Order regressions are fixed.** WO stability is the standing top priority, and `docs/WO-SPEC.md` plus the booking↔WO merge are both ahead of this.

Nothing here is urgent except one date: **all staff harassment training must be complete by January 1, 2027**, and that can be met with a spreadsheet if PRSFlo isn't ready.

---

## 1. Two design decisions that shape everything

### 1.1 ADP stays the system of record for pay

There is no ADP integration. WFN's API is Marketplace-gated and not worth negotiating for a 15-person company. Fernando continues to enter every correction in ADP by hand.

PRSFlo becomes the **collection and audit layer**: it captures what staff report, timestamps it, and produces the written employee confirmation California requires. It makes the ADP entry take thirty seconds instead of twenty minutes of detective work.

If PRSFlo and ADP ever disagree, ADP is right about pay and PRSFlo is right about what was requested and confirmed.

### 1.2 Time records are NOT linked to work orders

**This is a hard separation. Do not join these.**

Staff shifts and work orders do not line up. A person may cover three rooms in a night, or none. A work order may span two people or zero. Any attempt to derive a shift from a WO — or to auto-attach WO context to a punch correction — will produce wrong data most of the time.

| Domain | About | Tables |
|---|---|---|
| Work orders | Rooms, sessions, clients, billing | `work_orders`, `studio_time_rows`, bookings |
| Time records | People, shifts, punches, pay | `punch_correction_requests`, my day |

They share `user_profiles` and nothing else. No foreign keys between the two domains. If Fernando needs to cross-reference a session while resolving a punch, he does it by eye in ADP — not through a join.

*(This reverses guidance in Draft 1.0, which proposed auto-attaching work order context to punch requests. That was wrong.)*

---

## 2. My Day — a new surface, separate from Tasks

### 2.1 Why separate

The existing task list merged two different things:

- **Todos** — one-off, variable, created and closed forever.
- **Duties** — the same every day, never permanently done. Their value is the streak, not the item.

Putting duties in a todo list makes them pile up as noise, everything reads as perpetually overdue, and staff disengage from the whole list. That is the observed failure. My Day is a separate surface with different rules.

### 2.2 Core rules

1. **The list is fixed by role.** Staff cannot add items to their own card. Adding items is an admin action.
2. **The card resets each morning.** Same length every day. A card that is always five items long is a card people keep opening.
3. **A duty is never duplicated.** If Fernando misses Tuesday, Wednesday does not show two "review timecards" rows. It shows one row with a backlog counter.
4. **Missing a day is recorded permanently.** Red square in the history, regardless of whether the work is later caught up.

### 2.3 Cumulative vs. point-in-time duties

Every duty is typed. This is the mechanic that makes rule 3 work.

**Cumulative** — the work accrues. Missing a day means tomorrow's instance covers more ground.

- Row displays scope: `Review timecards — covering 2 days (Mon 8/3, Tue 8/4)`
- `backlog_days` counter on the row
- **Flag the card when `backlog_days >= 3` on any item.** This is the "where are we really" signal. Surface it on Eli's grid too.
- Completing it clears the whole backlog, and the data-entry field should reflect total scope (e.g. exceptions cleared across both days)

**Point-in-time** — cannot be done late. Example: "confirm today's staffing vs. schedule." Yesterday's is meaningless.

- No backlog counter. Missed = red square, then gone.

### 2.4 Data capture on selected items

A plain checkbox is one click and possibly a lie. Two or three items per role must capture a number:

- Fernando: exceptions cleared, punch requests processed
- Aaron: invoices sent, COD accounts outstanding, AR queue items cleared, AP invoices processed

These numbers feed the monthly reporting in §6 with no extra reporting work.

### 2.5 Cadence sections

One surface, three sections: **Today** · **This week** · **This month**.

Weekly and monthly items appear when due and stay until done. The quarterly training audit (PRG-P04) appears October 1 and sits in "This month" until closed.

### 2.5a Navigation — moving to a side nav

**Decision (Aug 2026): the dashboard is being redesigned around a left side nav, replacing the current top nav.** The existing top-nav dashboard is a WIP and should not be treated as the target layout.

Reasoning: the top nav is already carrying Dashboard · CRM · Calendar · Admin · WO Hub · Nadine's · SOP · DEV, and this layer adds punch corrections, hiring/offboarding, and training records. A horizontal bar runs out of room and starts hiding things behind overflow. A side nav scales, supports grouping and section labels, and gives room for count badges — which this layer needs (pending punch corrections, overdue training, open onboarding items).

Implications for this spec:

- Build the HR destinations assuming a **grouped side nav**, not top-nav entries. Group them under a single **HR** section rather than three peers.
- Consider **HR Hub** as a single destination with tabs (punches · hiring · training), mirroring the existing WO Hub pattern, rather than three separate nav items.
- Count badges on nav items are part of the design, not decoration — the pending punch count is how Fernando knows to open the queue.
- The dashboard cards in §2.6 are unaffected by the nav change; they sit in the main column either way.

**Naming collision:** PRSFlo already uses "Daily Ops" for the daily session and room view. The duties surface in this spec must **not** reuse that name. Use **"My Day."**

### 2.6 Where the cards live

**The My Day card is the top of each person's dashboard** — the first thing on the page when they log in, above everything else. Not a nav item they have to go find. If it requires navigation, it will not become a habit.

Once every item is checked, the card **collapses to a single confirmation row** (`My day complete — 5 of 5`) so it isn't eating screen space for the rest of the day. It can be expanded again to review or correct an entry.

Anyone carrying a 3+ day backlog keeps the card expanded regardless, with the backlog row highlighted.

Eli's dashboard shows the 14-day grid (§2.7) in the equivalent slot.

### 2.7 Eli's view — a grid, not a list

Rows = people. Columns = last 14 days. Green (all duties done) / red (one or more missed) / neutral (non-working day).

Readable in three seconds. Plus a badge on any person currently carrying a 3+ day backlog on a cumulative duty.

### 2.8 Morning briefing

A short natural-language summary of yesterday, delivered to Eli each morning. This is the primary way he finds out something slipped — the grid is for looking deeper.

**It has a home already.** The dashboard greeting currently reads *"Good evening Eli — here's your briefing"* with no briefing beneath it. Render the summary directly under that line. No new real estate, and it lands as the first thing on the page.

Generated with `askClaude` (Haiku) over yesterday's My Day rows plus the AR and punch queue counts. Two or three sentences, plain language. For example:

> *Yesterday: Fernando cleared all five duties — 4 timecard exceptions, 2 punch requests. Aaron missed the AR follow-up queue for the second day running; it's now covering 3 days. COD outstanding is at 2 accounts. Nothing over 31 days past due.*

Delivery is a scheduled task. Should lead with anything red or any 3+ day backlog, and stay short when everything is green.

---

## 3. The two role cards

### 3.1 Fernando — Studio & Administration Manager

**Today**

| Duty | Type | Captures |
|---|---|---|
| Review yesterday's timecards in ADP | cumulative | exceptions cleared |
| Clear the punch correction queue | cumulative | requests processed |
| Confirm today's staffing vs. schedule | point-in-time | — |
| Log missed punches | cumulative | count |
| Onboarding / offboarding items due | cumulative | — |

**This week** — Friday mid-period timecard audit · pay period clean close (on period-end weeks)

**This month** — training tracker audit (quarterly: Jan 1 · Apr 1 · Jul 1 · Oct 1)

### 3.2 Aaron — Billing & Accounting Coordinator

Derived from the 2025 Billing Coordinator job description. Reception, phones, and work order creation are excluded — WO creation is absorbed into PRSFlo, and reception is continuous work rather than a checklist item.

**Today**

| Duty | Type | Captures |
|---|---|---|
| Finalize and send invoices for confirmed sessions (with GM) | cumulative | invoices sent |
| COD invoicing, 9–5 | cumulative | — |
| COD accounts still outstanding — **target zero** | cumulative | count |
| Accounts chased today | cumulative | count |
| Accounts past 31 days | cumulative | count |
| Check AP@ inbox | cumulative | vendor invoices processed |
| Upload vendor invoices to Ramp, queue for GM approval | cumulative | — |

The three AR counts are typed by Aaron in Phase 1 and computed automatically in Phase 2 — see §4.

**This week** — Monday: finalize and send weekend session invoices (Studio Manager initiates) · 31+ days past due review with GM · vendor account reconciliation

**This month** — tenant rent invoicing and collection · customer account reconciliation · AP document filing

---

## 4. Accounts receivable — two phases

### 4.0 PRSFlo does not have the data. Build in two phases.

**AR lives in QuickBooks, not PRSFlo.** PRSFlo has no invoice records and no payment status. Everything in §4.1–§4.4 below assumes it does, and none of it can be built until that changes.

Rather than block the whole feature on a QuickBooks integration, split it:

**Phase 1 — the sign-in sheet (build now, ~1 day).**

Aaron continues working AR in QuickBooks exactly as he does today. Nothing about his actual job changes. At the end of it he types three numbers into his My Day card:

| Field | Meaning |
|---|---|
| COD accounts still outstanding | Target zero |
| Accounts chased today | Volume of follow-up work done |
| Accounts past 31 days | The escalation bucket |

Roughly twenty seconds. These three numbers produce the trend line, the morning briefing, and the red square if he skips a day — which is the entire behavior change this project is after.

**Phase 2 — the real queue (build when QuickBooks integration happens).**

A nightly read-only QBO sync of invoices, terms, and payment status. The **same three rows** on the card stop being inputs and become computed values, and the account-level queue in §4.3 appears beneath them.

**This is deliberately not throwaway work.** Same card, same three metrics, same briefing copy, same monthly report rows. Only the source of the numbers changes — manual entry becomes a computed value on the identical field. Build Phase 1 so that swapping the source is a one-file change.

**Honest tradeoff:** a typed number can be wrong or optimistic. Mitigation is that Aaron reads it directly off QuickBooks and the source of truth is always available to check against. Accept this for Phase 1.

---

### 4.1 Why a queue and not an aging report — *(Phase 2)*

Roughly half of clients are on Net 30, so a large outstanding AR balance is the normal, healthy state. An aging report shows everything, most of which needs no action, so it gets opened and closed without work happening.

The queue shows only what is actionable today. Bounded work gets finished; unbounded review gets skipped.

### 4.2 Trigger on days past due, not invoice age — *(Phase 2)*

A Net 30 invoice at day 25 is healthy. A COD invoice at day 3 is a problem. Same age, opposite meaning. Terms drive the math.

```
days_past_due = today - (invoice_date + terms_days)
```

**Terms already exist in PRSFlo as the COD vs. Billing flag on the client.** Map it: `COD → terms_days = 0`, `Billing → terms_days = 30`. Add a nullable `terms_days` integer so a per-client override or a third tier is possible later without a migration, defaulting from the existing flag.

**Handle missing terms in the UI, not with a backfill.** Most active clients have the flag set, but there are stragglers. A client with no terms flag must **never silently drop out of the queue** — an empty queue that should not be empty is the worst failure mode here, because it looks like success.

Instead, surface unflagged clients with an open invoice in the AR queue as a distinct row type:

> `Terms not set — Acme Records · invoice #1204 · $2,400` → [ COD ] [ Billing ]

Two clicks, sets the flag on the client record, and the invoice immediately re-buckets into the normal ladder. The stragglers clean themselves up as they surface, with no migration and no backfill project.

**Still confirm:** that "Billing" means Net 30 in practice.

### 4.3 The ladder — *(Phase 2)*

| Bucket | Appears in queue | Action |
|---|---|---|
| Within terms | No | Nothing. Not Aaron's problem yet. |
| Due in 5 days | Optional | Soft reminder — configurable, off by default |
| COD, any balance outstanding | **Yes, immediately** | Same-day contact. Target is zero outstanding. |
| 1–15 days past due | Yes | Follow-up email |
| 16–30 days past due | Yes | Second contact, phone |
| **31+ days past due** | Yes | **Escalates to Eli and the GM** |

COD escalates to Eli immediately; Net 30 escalates at 31+ days past due (≈ day 61 from invoice).

The weekly aging review with the GM covers the 31+ bucket only, and should be short.

### 4.4 Queue behavior — *(Phase 2)*

- Each account appears once with its current bucket and suggested action
- Aaron logs the contact — this creates the trail that justifies escalation later
- An account contacted today drops off until its next follow-up interval
- Queue depth is the daily capture value

---

## 5. Punch correction requests

The single highest-value piece. Ship it alone if nothing else gets built.

### 5.1 Flow

1. Staff tap **"Missed a punch"** on the PRSFlo dashboard. Date, punch type, correct time, optional note. Submit.
2. PRSFlo timestamps the submission and classifies it per PRG-P03: `self_same_day`, `self_late`, or `manager_found`.
3. Request lands in Fernando's queue. He approves, adjusts, or rejects with a reason.
4. Fernando enters it in ADP, then marks it entered with the ADP comment text.
5. The record is now the **written employee confirmation** PRG-R01 §3 requires — timestamped, in the employee's own words, permanently stored.

**No work order context is attached.** See §1.2.

### 5.2 Why this matters

California requires written employee confirmation before any punch is edited. Today that means chasing texts and hoping they're findable a year later. This makes it a database row.

It also makes the PRG-P03 coaching ladder count itself — the app knows who reported and when, so Fernando never keeps score manually.

### 5.3 Schema

```sql
create table if not exists punch_correction_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references user_profiles(id) on delete restrict,
  shift_date date not null,
  punch_type text not null check (punch_type in ('clock_in','clock_out','meal_out','meal_in','other')),
  claimed_time time not null,
  employee_note text,
  studio text check (studio in ('PRS','ARS','ERS','TRK')),
  submitted_at timestamptz not null default now(),
  report_class text not null check (report_class in ('self_same_day','self_late','manager_found')),
  status text not null default 'pending'
    check (status in ('pending','approved','adjusted','rejected','entered_in_adp')),
  reviewed_by uuid references user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  approved_time time,
  reviewer_note text,
  adp_comment text,
  entered_at timestamptz,
  counts_toward_ladder boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_pcr_status on punch_correction_requests(status);
create index if not exists idx_pcr_staff_date on punch_correction_requests(staff_id, shift_date);
```

- `report_class` set by a Postgres trigger comparing `submitted_at::date` to `shift_date` — same pattern as the existing `is_private` trigger on tasks. Not client-side.
- `counts_toward_ladder` is true only when `report_class = 'manager_found'`. Two `self_late` rows equal one counted miss — compute in a view, not a column.
- **No `work_order_id` column. Do not add one.**

### 5.4 UI

- **Staff dashboard:** one prominent "Missed a punch" button. Mobile-first — used on a phone, at night, tired. Two taps to open, four fields, submit.
- **Staff, secondary:** their own request history, current clean-shift streak, **and their own counted-miss total for the trailing 90 days.** Staff see their own ladder position; they do not see anyone else's.
- **Fernando's queue:** pending requests, approve/adjust/reject inline, count badge in nav, real-time subscription.
- **Fernando's "enter in ADP" list:** approved-but-not-entered, with a copy button.

### 5.5 Auto-composed ADP comment

PRSFlo has everything needed to generate the comment string PRG-P01 requires. On approval, compose and display it with a one-click copy:

```
Corrected {punch_type} {approved_time} per employee request {submitted_date}. — {reviewer_initials}
```

Editable before copying. This is the single biggest time-saver in Fernando's daily loop after the queue itself.

### 5.6 Coverage

My Day cards and the punch queue are **visible to all managers**, with a default owner. When Fernando or Aaron is out, another manager can work the queue. Record a `covered_by` reference on the day so the history shows who actually did it.

---

## 6. Training tracker

Covers **two separate mandates on two different clocks** (PRG-R04):

- Harassment prevention — Gov. Code 12950.1 — **every 2 years** — statewide deadline Jan 1, 2027
- Workplace violence — Labor Code 6401.9 — **every year**, plus at hire

```sql
create table if not exists hr_training_records (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references user_profiles(id) on delete cascade,
  training_type text not null
    check (training_type in ('harassment_supervisory','harassment_non_supervisory',
                             'workplace_violence','bystander_intervention','other')),
  completed_on date not null,
  hours numeric(3,1),
  provider text,
  certificate_url text,
  next_due_on date not null,
  notes text,
  recorded_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table user_profiles
  add column if not exists is_supervisory boolean not null default false,
  add column if not exists became_supervisory_on date,
  add column if not exists hire_date date;
```

**Interval rules:**

- Harassment: `completed_on + 2 years`, or the next statewide deadline if earlier
- Workplace violence: `completed_on + 1 year` — separate logic, do not share
- New non-supervisory hire, no record: `hire_date + 6 months`
- New or promoted supervisor: `became_supervisory_on + 6 months`
- Hire expected under 6 months: `hire_date + 30 days` (the 100-hours-worked alternative can't be computed without ADP — flag for manual check)

**UI:** one row per employee, status pill — `Current` / `Due in 90 days` / **`Overdue`**. Reuse the lead-temperature pill component. Filter by status. The quarterly audit becomes: open the page, look at the reds.

**Certificates:** private bucket, signed URLs, same pattern as `checklist-photos`. Personnel records — never public.

### 6.1 WPV training — distribute, acknowledge, auto-log

**Workplace violence training is self-contained in a way harassment training is not.** Harassment uses an external CRD course and produces a certificate we file. WPV training material is our own plan document — so the whole cycle can live in PRSFlo.

Flow:

1. **Assign** — Fernando assigns the current WVPP to a staff member, or to everyone at once. Triggered at hire, annually, on plan revision, or when a new hazard is identified.
2. **Read** — the plan renders in-app. Track scroll-to-end; do not treat opening it as reading it.
3. **Acknowledge** — five checkboxes, matching Appendix A of the plan:
   - received and read in full
   - understands how to report, and that there is no retaliation
   - understands the hazards specific to their job
   - knows they can request a free copy and examine records
   - **was given the opportunity to ask questions, and any questions asked were answered**
4. **Questions field** — free text, plus who answered (Fernando / Eli / none asked). This is not decorative; see below.
5. **Sign** — typed name plus PIN re-entry as the signature. Timestamped.
6. **Auto-log** — writes an `hr_training_records` row with `training_type = 'workplace_violence'`, `completed_on = now`, `next_due_on = now + 1 year`. **The tracker updates itself.** No certificate to chase, no filing step.

**The question-and-answer step is a legal requirement, not a nicety.** LC 6401.9(e) requires training to include an opportunity for interactive questions and answers with a person knowledgeable about the plan. A read-and-sign flow alone does not satisfy it. The acknowledgment must record that the opportunity was given, and the free-text field is what evidences it.

**Reuse the existing SOP gate** — first-login SOP acceptance already does most of this. WPV assignment should feel like the same mechanic rather than a separate system.

Also capture, per LC 6401.9(f), on the training record: date, contents or summary, name and qualifications of the person delivering it, and the attendee's name and job title. Most of that can be derived — the plan version number is the content summary.

**Plan versioning matters.** Store which revision of the plan each person acknowledged. When the plan is revised, everyone who acknowledged an earlier version is flagged for retraining on what changed.

### 6.2 Violent incident log

A table that should stay empty but must exist. One row per incident, retained **5 years**.

**Omit personal identifying information** of anyone who experienced or witnessed an incident — no names, addresses, phone numbers, or SSNs of affected employees. This is a statutory requirement and the schema should make it hard to violate: do not put a `staff_id` foreign key on the log.

Fields per LC 6401.9(d): date, time, location · violence type (1–4, multi-select) · detailed description · classification of who committed it · circumstances at the time · where it occurred · type of incident · consequences including law enforcement response and protective actions taken · who completed the entry, their job title, and the date.

### 6.3 Hazard inspection records

Annual, per location, per Appendix B of the plan — timed to precede the annual plan review. Retained **5 years**. Records the inspection happened even when nothing was found — an inspection with no findings is evidence; a missing inspection is a gap.

Also needs a hazard correction record: hazard, severity, action taken, who, date closed, and whether the reporting employee was told the outcome.

### 6.4 Workplace violence extras

WPV requires more than training records. Two additional surfaces:

- **Violent incident log** — date, time, location, type of violence, consequences, circumstances. Must exist even if empty. Retain **5 years**.
- **Annual WPV plan review** — a recurring item on Fernando's monthly card, requiring employee involvement.

---

## 7. Onboarding / offboarding checklists

Template-instantiated checklists driven by PRG-P02.

```sql
create table if not exists hr_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('onboarding','offboarding')),
  name text not null,
  is_active boolean not null default true
);

create table if not exists hr_checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references hr_checklist_templates(id) on delete cascade,
  sort_order int not null,
  label text not null,
  section text,
  owner_role text,
  due_offset_days int,
  is_legal_deadline boolean not null default false,
  help_text text
);

create table if not exists hr_checklist_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references hr_checklist_templates(id) on delete restrict,
  staff_id uuid references user_profiles(id) on delete set null,
  subject_name text not null,
  anchor_date date not null,
  separation_type text check (separation_type in ('involuntary','quit_72_notice','quit_short_notice')),
  status text not null default 'open' check (status in ('open','complete','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists hr_checklist_items (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references hr_checklist_instances(id) on delete cascade,
  label text not null,
  section text,
  due_on date,
  is_legal_deadline boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references user_profiles(id) on delete set null,
  note text
);
```

**Onboarding template** seeded from PRG-P02 Part A. Hard legal deadlines flagged `is_legal_deadline = true`:

- I-9 Section 2 within **3 business days** of first day
- CalSavers enrollment within **30 days** of hire
- Harassment training within **6 months**; WPV training **at hire** — these should create `hr_training_records` due dates rather than being bare checkboxes

**Offboarding template** seeded from PRG-P02 Part B. The instance asks `separation_type` first and sets the final pay deadline accordingly:

| separation_type | Final pay due |
|---|---|
| `involuntary` | **Immediately, at time of termination** (LC 201) |
| `quit_72_notice` | Last day worked (LC 202) |
| `quit_short_notice` | Within 72 hours of quit (LC 202) |

For `involuntary`, surface a blocking banner: *"Final check must be ready before the termination conversation. Eli approval and 48 hours' notice to Lynair required."* Highest-dollar compliance item in the whole layer — waiting time penalties run up to 30 days of wages.

Offboarding auto-generates PRSFlo cleanup: deactivate staff record, void PIN, reassign open tasks and work orders.

---

## 8. Protocols on the SOP page

The four **P** documents live in an HR section on the existing SOP page, behind the first-login gate. The four **R** documents sit behind a "why" link on each — read once when someone is new, or when something unusual comes up.

Consider running the written harassment / discrimination / retaliation prevention policy acknowledgment (required by 2 CCR 11023(b)) through the same SOP gate — it needs distribution plus a recorded acknowledgment, which the gate already does.

---

## 9. Monthly report

One page, generated monthly. What Eli reads.

| Metric | Source | Target |
|---|---|---|
| Days reviewed on time | My Day completions | ≥ 95% |
| Open exceptions at period close | Close readiness | 0 |
| Edits without written confirmation | `punch_correction_requests` | 0 |
| Total misses per period | `punch_correction_requests` | declining |
| **% of misses self-reported same day** | `report_class` | **≥ 80%** |
| Employees at 2+ counted misses / 90 days | ladder view | 0–1 |
| My Day completion by person | My Day history | ≥ 95% |
| Any duty with 3+ day backlog | My Day | 0 |
| COD accounts outstanding | AR queue | 0 |
| Accounts 31+ days past due | AR queue | declining |
| Training records overdue | `hr_training_records` | 0 |
| Open onboarding items past due | `hr_checklist_items` | 0 |

The self-report percentage is the headline. It's the one metric that says whether the culture change took.

---

## 10. Standing conventions

Carry into every CC prompt for this work:

- **Real-time subscriptions on every surface.** Queues and My Day cards must never need a manual refresh.
- **Never `.maybeSingle()`.** Use `.order('created_at').limit(1)`.
- **New tables require explicit GRANT statements** (post-May 30, 2026 rule).
- **RLS on every new table.** HR data is the most sensitive in the app — training certificates, discipline history, separation reasons. Staff see their own rows only; managers see their scope; Eli sees everything.
- **Migrations run manually** in the Supabase SQL editor. `supabase/migrations/YYYYMMDDHHMMSS_name.sql`, `...120000` noon convention, idempotent (`if not exists`).
- **CSS variables only** — no hardcoded hex. Reuse existing pill and card components.
- **Mobile-first** on the staff punch request form.
- **Schema before UI**, one change at a time, feature branch per sub-chunk, verify on the Vercel preview URL.
- **Split large file builds** into ~500-line chunked sessions written directly to disk.
- **No `work_order_id` anywhere in this layer.** See §1.2.

---

## 11. Build order

1. `punch_correction_requests` — table, migration, RLS, grants
2. Staff "Missed a punch" form (mobile)
3. Fernando's review queue + real-time
4. My Day tables and the role-card engine (cumulative vs. point-in-time, backlog counter)
5. Fernando's card, then Aaron's card — top of dashboard, collapses when complete
6. Eli's 14-day grid, then the morning briefing scheduled task
7. `hr_training_records` + `user_profiles` columns + tracker page
8. Checklist engine + onboarding template
9. Offboarding template + final pay logic + blocking banner
10. Violent incident log
11. Monthly report page

Items 1–6 deliver most of the value.

**AR Phase 1** is part of item 5 (Aaron's card) — three number fields, nothing more.
**AR Phase 2** (§4.1–4.4) is a separate project, scheduled alongside the QuickBooks integration. Do not attempt it before that integration exists.

---

## 12. Decisions made (Aug 2026)

Previously open, now settled:

1. **Notification** — morning briefing to Eli, AI-generated, daily. See §2.8. The grid is for looking deeper, not for catching things.
2. **ADP comment** — auto-composed with one-click copy. See §5.5.
3. **Ladder visibility** — staff see their own counted-miss total. Not anyone else's. See §5.4.
4. **Coverage** — all managers can see and work each other's cards and queues. See §5.6.
5. **Payment terms** — reuse the existing COD vs. Billing client flag. See §4.2.
6. **AR escalation** — 31+ days past due. Confirmed.
7. **AR approach** — two phases. Aaron types three numbers now; QuickBooks computes them later. See §4.0.
8. **Punch entry point** — the modal in §5.1 as specced. No chat-message parsing; the form is the record.
9. **Navigation** — dashboard redesigning around a left side nav, replacing the current top nav. Build HR destinations for that. See §2.5a.
10. **Naming** — the duties surface is **"My Day."** "Daily Ops" is taken by the existing session/room view.
11. **My Day placement** — right column, directly above the Tasks card, reusing the existing role-tab pattern. Duties above todos makes the distinction self-evident.

## 13. Still open

- Confirm the COD/Billing flag is populated on all active clients, and that "Billing" means Net 30 in practice (§4.2). *Only blocks Phase 2.*
- Confirm the exact ADP WFN menu paths for company code 4DA and write them into PRG-P01.
- Confirm whether the Time Card Exceptions / Attendance dashboard is enabled in our WFN instance.
- Whether the harassment prevention policy acknowledgment should run through the SOP gate (§8).
