# PRSFlow — Project Log

*Living document. Update as decisions are made.*
*This file is read by every Claude session for context — keep it current.*

---

## 1. Decisions Log
*Why we built things the way we did. Reference this before second-guessing past choices.*

### Data model
- **Labels are clients, A&Rs are contacts, artists are a text array.** When a label books, the *client* is the label, the *ordered by* is the A&R (lives in `client_contacts`), the *artist* is who's recording (lives in `clients.artists[]`). For COD/individual clients, all three collapse into one row. *(Decided in Chunk 4 planning, May 2026.)*
- **Label divisions are separate clients.** Sony General ≠ Sony Latin ≠ UMG General ≠ UM Latino. Don't merge them.
- **"Individual" is the database value, "COD" is the display label.** Schema uses `type='individual'`, UI shows "COD" everywhere.
- **23 labels is our effective max.** After 40 years, every label that will book with us is already in our system. Going forward, label *clients* don't get created — only label *contacts* and *artists* get added.

### Migration approach
- **Migrate clients/contacts only — no historical bookings.** The clients table has 615 clients migrated from 1,638 booked leads. We did NOT migrate historical bookings or create a "needs review" backlog. Original leads remain untouched in the leads table as historical reference.
- **Messy migrated data was skipped, not flagged.** 401 booked leads have no `client_id` because their names were too messy to import. They'll be re-created naturally when those clients book again. Don't try to "fix" these in bulk.
- **All label artist arrays were wiped clean after migration.** The migration auto-populated artist names from clean fname+lname matches, which incorrectly included A&Rs. Manually wiped to empty arrays — artists get added one at a time through real bookings.

### Architecture
- **No RLS until Chunk 9 (Auth).** Tables are open like the leads table. Will add RLS + role policies (office vs runner) when auth is built.
- **Frequent commits + branch-per-sub-chunk.** Each sub-chunk gets its own branch (e.g., `chunk-4-5`), commits happen after every meaningful piece of work, merge to main only when sub-chunk is confirmed working.
- **Email sending is deferred to Chunk 5.** Any "send email" button in the meantime uses `mailto:` to open the user's default mail client. No SendGrid/Resend integration yet.
- **No automated testing infrastructure for the foreseeable future.** No Playwright, Jest, Vitest, or any test framework. Manual browser testing only. If Claude suggests writing tests or adding a testing dependency, redirect back to manual verification.
- **Public registration form uses anon INSERT policy on private `client-ids` storage bucket** with 25MB size limit and restricted MIME types (jpeg/png/heic/webp/pdf). Token-gated in app code — the token must exist, be unexpired, and unused before the form renders.
- **Public routes use Next.js route groups to isolate from internal pages.** `app/(main)/` contains nav-bearing pages (CRM, Clients, Dashboard, etc.); `/register` and any future public routes live outside it. Until Chunk 9 adds auth, this is the only mechanism preventing public visitors from accessing internal data.

### CRM — Needs Action & timers
- **Needs Action daily reset runs at 8am PST (cron: `0 15 * * *` UTC).** Hot/Warm leads reappear in Needs Action every day until their keep-hot timer expires (5 days Hot, 3 days Warm) or they are manually moved to Cold/Dead. The reset sets `needs_contact = true` so staff can't dismiss the same lead indefinitely without taking action or changing status.
- **Lead detail card uses 2-column layouts for space efficiency.** Contact section: Email/Phone on the left, Created/Last Contact on the right (gap 48px). Session & Quote section: Location·Studio + Session Date on the left, Quote/Rate + Start–End times on the right (gap 48px). Location and Studio dropdowns cascade — selecting a venue populates the studio options for that venue only.
- **Time inputs use 12-hour format with smart parsing.** Accepts `8p` → `8:00 PM`, `830a` → `8:30 AM`, `1830` → `6:30 PM` (24h converted), bare `8` → `8:00 AM`. Saves on Enter or Tab (blur). Legacy 24h values stored in DB are converted for display transparently.

### UI patterns
- **Clients page = unified two-column view.** List on left, full editable profile in right panel. No separate `/clients/[id]` route. URL uses query param `/clients?id=<uuid>` for shareability.
- **"Start Booking" replaces "Book Client" everywhere.** Always visible green button on lead detail cards and client profiles. On leads without a client record it opens ConfirmClientModal (creates client, navigates to `/clients?id=...`); on leads or clients that already have a client record it navigates directly to `/calendar?newBooking=1&clientId=...` with form pre-filled. "View Client" button was removed as redundant.
- **Artists live inside A&R contact cards, not as a standalone section.** On label client profiles, each A&R card has an Artists sub-section in its expanded view — add/remove chips, saves with the rest of the contact on the Save button. The top-level `clients.artists[]` field is no longer surfaced in the UI for label clients.
- **Autofill pickers (contacts, artists) are reusable components.** Built as standalone components in `components/clients/` or `components/shared/`, will be reused in the Calendar's New Session modal.
- **Public-facing forms use scrollable embedded legal text rather than external links or modals.** Keeps clients on the page, mobile-friendly, legally protective. T&Cs content lives in `lib/terms.ts` as a structured array (heading + body), easy to update without touching form logic.
- **All Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) must be configured for ALL THREE Vercel environments (Production, Preview, Development).** Preview deploys fail with "supabaseUrl is required" if missing from the Preview environment.
- **Lead detail card — Activity Log + Contact button (May 2026):** Activity Log section appears above Session Notes in the lead detail card. Fetches all `lead_activity` rows for the lead plus synthesizes synthetic events (Lead Created from `lead.created_at`; Reg Link Sent / Registration Returned from `registration_tokens.created_at/used_at`). Color-coded dots: Call=red, Text=orange, Email=sky-blue, Reg=accent/green, Created=gray. "Mark Touched" button renamed to "Contact" everywhere. When the Contact prompt opens, action link buttons (Call / Text / Email) appear at the top — tapping opens `tel:`, `sms:`, or `mailto:` and auto-selects the matching method in the form. No Answer / DNA button was removed entirely — it added noise without value.
- **Session Notes is purely freeform.** Activity (touches, keep-hot, etc.) is logged only to `lead_activity` — nothing is auto-appended to the notes field. Notes are seeded from the lead's original inquiry and are staff-editable only.
- **COD vs Label/Billing color convention:** COD = `#7BBFFF` (sky blue), Label/Billing = `#96A9FF` (periwinkle). Same brightness, distinct hues. Applied to lead names in CRM list and detail card header, client names in Clients list and profile header, billing pills everywhere, COD/Label-Billing toggle active state in New Lead form, and the Email button color. Lead name color is driven by `billing` field (`=== 'Billing'`), not `artist_name`.
- **iOS Safari requires explicit `height` (not just `max-height`) plus `-webkit-overflow-scrolling: touch` for scrollable containers.** `max-height` alone works on desktop but renders as a full-height block on iOS. Apply this pattern to any future scrollable embeds.

---

## 2. Future Considerations
*Things to think about when we get to a specific chunk. Don't build now, but don't forget.*

### Chunk 6 — Calendar (in progress)
- **Calendar is live at `/calendar`.** Week/2-week view with all 11 studio rooms visible by default. Lane assignment for overlapping same-day bookings. Block always reserves click zone at the bottom to add new bookings.
- **Booking form** supports: client search, session type, status, payment type (COD/Billing), engineer + assistant (search or free-text), rate hourly/daily toggle, notes.
- **COD sessions get hero treatment** at top of booking panel: large DM Serif Display name in `#7BBFFF`. Label sessions in `#96A9FF`.
- **Filming and Event/Playback blocks** have a full border all the way around; Recording has top bar only.
- **Rate is either/or.** `rate` for hourly, `rate_daily` for daily. DB column `rate_daily text` added manually.
- **Start Booking cross-page flow** uses `?newBooking=1&clientId=xxx`. Calendar detects on mount, clears URL, fetches client, auto-opens pre-filled form.
- **Vertical zoom:** Keyboard +/-/0 and Cmd+trackpad scroll. `ZOOM_FIXED = [44, 60, 80, 88, 110, 132]`, level 0 = fit-all. Fit-all computed via ResizeObserver on grid container.
- **Individual room collapse** persisted to `localStorage` key `cal_collapsed_rooms`. Location-level collapse persisted to `cal_collapsed_locs`. Both initialized as empty Sets on server render, restored from localStorage in `useEffect([])` to avoid hydration mismatch.
- **Endless horizontal scroll:** Grid renders `BUFFER_WEEKS=2` weeks of buffer on each side (5 weeks total for week view, 7 for 2wks). When scroll approaches edge, `startDate` shifts ±7 days and `scrollCorrectionRef` corrects scroll position seamlessly. Studio labels are `position: sticky, left: 0`.
- **Today centering:** On mount and after `startDate` change, `useEffect` + `requestAnimationFrame` scrolls to center today in the viewport. Post-scroll snap (80ms debounce) snaps back to today only when viewport is within 7 days of today — no snap elsewhere. Today button smooth-scrolls to today centered; if already on today's week, skips `setStartDate` and re-centers directly.
- **Visual week/month breaks:** Monday columns get `boxShadow: 'inset 2px 0 0 rgba(255,255,255,0.35)'`. Month-start columns get `boxShadow: 'inset 2px 0 0 var(--accent)'` plus a small month label (e.g. "MAY") in the top-left of that header cell. Same dividers appear in room cell backgrounds via inset box-shadow.
- **Nav always accessible over modals:** Nav `zIndex` raised to `9999`. All modal backdrops changed from `inset: 0` to `top: 52, left: 0, right: 0, bottom: 0` so they sit below the nav.
- **Draft/state persistence across tab navigation:** Booking form draft saved to `sessionStorage` key `cal_form_draft`, restored on mount. CRM: selected lead, view, tab, filter, search all persisted to sessionStorage. Clients: new-client modal draft persisted to `clients_new_draft`.
- **Bookings can exist before registration completes.** Future: "PENDING REGISTRATION" visual treatment on holds without client profiles.
- **Bookings link to either lead OR client.** Future: schema should allow both nullable but enforce one present.
- **Reuse contact and artist pickers from 4.5.** Don't rebuild them inside the calendar modal.

### Chunk 4.7 — Polish
- **"Registration returned" notification area on Clients page.** Small panel/box showing recent registrations that need QC. Query `registration_tokens` where `used_at` is recent and the resulting client hasn't been reviewed yet.
- **File upload edge cases.** ID files can be large; consider a 10MB cap. Accepted formats: PDF, JPEG, PNG, HEIC (iPhone photos). Show preview before upload completes.

### Phone & duplicate cleanup
- **Phone normalization migration:** One-time script to normalize existing phone data in `clients` and `client_contacts` tables to a consistent format (e.g., `(310) 555-1234`). Currently a mix of formats from manual entry and Jotform import.
- **Manual duplicate merge flow (4.9b):** UI to merge two existing client profiles when duplicates are discovered post-import. Needs a merge strategy (which record wins per field), re-points any linked leads/tokens to the surviving record, and deletes the duplicate. Slot as a small standalone sub-chunk.

### Chunk 5 — Webhooks (deprioritized)
- Originally planned right after Chunk 4. Now lower priority — Calendar (Chunk 6) is the higher-value next step.
- When we do build this, Squarespace inquiries auto-create leads, Jotform is retired in favor of our in-app registration form (Chunk 4.6).

### Chunk 9 — Auth
- **Office role gets everything. Runner role doesn't access Clients page at all.** Runners only see scoped info — today's sessions, basic client name. No billing, no full profiles.
- Single migration enables RLS across all tables at once: leads, clients, client_contacts, registration_tokens, lead_activity, bookings (once built).
- Storage buckets currently have blanket anon INSERT policy with size/MIME limits (25MB max, image + PDF only). When RLS is enabled in Chunk 9, replace with proper auth-based policy.
- Once auth is enabled, route group separation can be revisited — internal pages will be login-gated regardless of layout structure. Still good UX to keep public pages chrome-free (no nav on registration, future public-facing pages, etc.).

### Chunk 4.8 — Needs Action rebuild (priority: HIGH)
- **Staff is hitting the Needs Action display bug repeatedly during testing. Slot as sub-chunk 4.8 immediately after 4.7 ships, before Chunk 6.** Priority bumped based on testing feedback.
- Current Needs Action only shows leads whose `keep_hot_until` timer has expired — which means a freshly-touched lead disappears and won't reappear for 5–8 days. Staff loses visibility on actively-engaged leads.
- Needs design pass on what "needs action" should actually mean vs. "is overdue."

### CRM — Auto-match leads to clients at creation
- **When a new lead is created (manually or via Squarespace webhook), check against existing clients by email/phone/name. If matched, link lead → client immediately**, pre-fill the CRM card with client data (editable), and hide all "create client account" UI. "Start Booking" becomes the single CTA regardless of new vs. returning. Eliminates the Book Client modal (new/returning/label flow).
- Needs design pass: match criteria, fuzzy matching threshold, ambiguous-match UX (what if two clients match?).
- **Slot as standalone sub-chunk between Chunk 4 and Chunk 6.**
- Once auto-matching is in place, reconsider whether "Confirm Client Account & Start Booking" is still the right CTA. Likely collapses to just "Start Booking" for matched leads and "Create Client Profile → Start Booking" for unmatched.

### Book Client UX
- **"Book Client" button currently only appears on `status = 'booked'` leads.** During 4.5 testing, the preference emerged to be able to convert directly from Hot/Warm leads without manually promoting status first. Options discussed: a separate "Book it!" button that promotes status AND opens the modal in one action, OR show Book Client everywhere and auto-promote. Both are small changes. Deferred — revisit as a small standalone sub-chunk between 4.7 and Chunk 6.

### Vercel Settings
- **Vercel preview protection should be DISABLED for the prs-flow project.** Public-facing flows (registration, future client-facing pages) need to be testable on preview URLs without authentication. Real security comes from token gating + Supabase RLS (Chunk 9), not preview URL obscurity. Toggle in Vercel Settings → Deployment Protection.

---

## 3. Glossary / Domain Rules
*Business-specific knowledge that isn't obvious from the code.*

- **PRS** = Paramount Recording Studios.
- **A&R** = Artist & Repertoire — the person at a label who books studio time on behalf of an artist. Often different from the artist actually recording.
- **"Ordered by"** = our internal term for the A&R or rep who placed the booking. Used in the UI for clarity vs the artist field.
- **COD** = Cash on Delivery — individual clients who pay per session, vs label clients who get invoiced. Internally stored as `type='individual'`.
- **Booking types:** Recording Session, Filming, Event/Playback. (Stored in `leads.booking` for migrated data; will move to a proper `bookings.type` column in Chunk 6.)
- **Studio rooms:** *(TBD — add when defined for Chunk 6 Calendar.)*
- **Status values for leads:** uncontacted, hot, warm, cold, dead, booked, incomplete, unconnected. ("unconnected" appears in the data — confirm meaning when relevant.)
- **Hot/Warm/Cold timers:** Hot expires after 5 days, Warm after 8, Cold review at 11. Auto-demotion via Vercel cron.
- **Park feature:** Leads can be parked-until a future date, removing them from Needs Action.

---

*Last updated: May 22, 2026 — Runner Hub + Daily Ops session. See session notes below.*

---

## 4. Session Notes

### May 22, 2026 — Calendar Polish
Added: vertical zoom (fit-all + 6 fixed levels), individual room collapse, endless horizontal scroll with buffer weeks, today-centering with post-scroll snap, visual week/month breaks, nav always accessible over modals, draft/state persistence across tab navigation (calendar, CRM, clients), hydration error fixed (localStorage out of useState initializer).

### May 22, 2026 — Runner Hub + Daily Ops Checklists (this session)

**What was built:**

Runner Hub routes (phone-first, no nav):
- `/runner` — studio select landing with today's session count per studio
- `/runner/[studio]` — per-studio daily ops hub: today's sessions + WO status + quick-action tiles (Opening Checklist, Closing Checklist, Petty Cash, Stock, Mics)
- `/runner/[studio]/wo/[id]` — WO review form: equipment condition, notes, expenses + receipt OCR via Anthropic claude-haiku-4-5, submit → sets status=submitted
- `/runner/[studio]/checklist/[opening|closing]` — tap-to-check lists, real-time saves on every tap (no gate), loads existing data on mount, Submit marks shift complete but form stays editable
- `/runner/[studio]/petty-cash`, `/runner/[studio]/stock`, `/runner/[studio]/mics`
- `/wo/[id]/print` — print-ready WO PDF view
- `/api/ocr-receipt` — server-side OCR endpoint (ANTHROPIC_API_KEY required)

Dashboard integration (LocationStrip + DailyOpsModal):
- LocationStrip studio cards always clickable → centered dialog (zIndex 10001)
- Dialog shows Yesterday section (only when unapproved items exist, orange header) + Today section
- Session cards with Runner/Admin two-checkbox approval pattern
- Daily ops rows: Opening Checklist, Closing Checklist, Petty Cash, Stock List, Mic Inventory — all clickable → DailyOpsModal (zIndex 10002)
- Checklist rows show live "14/32 checked" progress counter (fetched from `checklists` table)
- Orange ⚠ badge on rows where `needs_attention=true` (even before submission)
- DailyOpsModal: checklists always show live progress (no "awaiting runner" gate), status badge shows Not Started / In Progress / Submitted / Approved
- Admin approve button at bottom after runner submission

Real-time checklist behavior:
- Each tap saves immediately to `checklists` table (creates row on first tap via clIdRef + creatingRef pattern)
- Notes debounce 800ms (only after user edits, guarded by notesUserEdited ref)
- Needs Attention toggle: immediately upserts `daily_ops_submissions` without `submitted_at` → dashboard badge shows without waiting for Submit
- Submit marks shift complete (sets `submitted_at`), footer changes to "✓ Shift complete · X/Y" + Back button
- Form stays fully editable after Submit

Per-studio checklist items in `lib/checklist-items.ts`:
- Paramount (opening: Building, Control Rooms, Kitchen, Runs, Other, Before you leave; closing: Control Rooms, Building, Bathrooms, Kitchen, Paperwork, Before you leave)
- Ameraycan, Encore, Track with their own item sets
- Shared between runner page and DailyOpsModal admin view

New DB tables required (run in Supabase SQL editor):
```sql
CREATE TABLE IF NOT EXISTS daily_ops_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text NOT NULL, date text NOT NULL, category text NOT NULL,
  staff_name text, submitted_at timestamptz, admin_approved_at timestamptz, admin_approved_by text,
  needs_attention boolean DEFAULT false, attention_notes text, photo_urls jsonb,
  UNIQUE(studio, date, category)
);
CREATE TABLE IF NOT EXISTS checklists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text NOT NULL, type text NOT NULL, date text NOT NULL,
  staff_name text, items jsonb, completed_at timestamptz,
  notes text, photo_urls jsonb, needs_attention boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS petty_cash_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text, date text, description text, amount numeric, type text, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS petty_cash_balances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text, date text, amount numeric, UNIQUE(studio, date)
);
CREATE TABLE IF NOT EXISTS stock_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text, item text, qty int, notes text, low boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS mic_inventory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text, name text, serial text, location text, condition text, notes text
);
CREATE TABLE IF NOT EXISTS expense_rows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id uuid, vendor text, item text, amount numeric,
  receipt_url text, submitted_by text, created_at timestamptz DEFAULT now()
);
```

Also requires `checklist-photos` Supabase Storage bucket (public) for photo uploads from checklist forms.
