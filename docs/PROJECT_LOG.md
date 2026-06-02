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
- **Bookings track A&R and Admin as foreign keys.** `bookings.anr_contact_id` refs the A&R from `client_contacts` who ordered the session; `bookings.anr_admin_contact_id` refs the admin contact handling logistics. Both are nullable — COD bookings typically have neither. Added in chunk-anr-admin-d1 (May 2026).

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
- **`clients.artists[]` is the authoritative label roster.** It is the source of truth for artist autocomplete on the lead form (Label mode), booking form, and the "Artists" section on label client profiles. `client_contacts[*].artists[]` is the per-A&R subset ("which artists does this rep handle") — adding an artist via any surface writes to `clients.artists[]`; adding via an A&R card also writes to that contact's own array. The profile shows both: the flat roster under "Artists", and per-A&R lists under each A&R card in "Contacts (A&Rs)". `lib/roster.ts` owns `addArtistToLabel` / `removeArtistFromLabel`.
- **Autofill pickers (contacts, artists) are reusable components.** Built as standalone components in `components/clients/` or `components/shared/`, will be reused in the Calendar's New Session modal.
- **Public-facing forms use scrollable embedded legal text rather than external links or modals.** Keeps clients on the page, mobile-friendly, legally protective. T&Cs content lives in `lib/terms.ts` as a structured array (heading + body), easy to update without touching form logic.
- **All Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) must be configured for ALL THREE Vercel environments (Production, Preview, Development).** Preview deploys fail with "supabaseUrl is required" if missing from the Preview environment.
- **Lead detail card — Activity Log + Contact button (May 2026):** Activity Log section appears above Session Notes in the lead detail card. Fetches all `lead_activity` rows for the lead plus synthesizes synthetic events (Lead Created from `lead.created_at`; Reg Link Sent / Registration Returned from `registration_tokens.created_at/used_at`). Color-coded dots: Call=red, Text=orange, Email=sky-blue, Reg=accent/green, Created=gray. "Mark Touched" button renamed to "Contact" everywhere. When the Contact prompt opens, action link buttons (Call / Text / Email) appear at the top — tapping opens `tel:`, `sms:`, or `mailto:` and auto-selects the matching method in the form. No Answer / DNA button was removed entirely — it added noise without value.
- **Session Notes is purely freeform.** Activity (touches, keep-hot, etc.) is logged only to `lead_activity` — nothing is auto-appended to the notes field. Notes are seeded from the lead's original inquiry and are staff-editable only.
- **COD vs Label/Billing color convention:** COD = `#7BBFFF` (sky blue), Label/Billing = `#96A9FF` (periwinkle). Same brightness, distinct hues. Applied to lead names in CRM list and detail card header, client names in Clients list and profile header, billing pills everywhere, COD/Label-Billing toggle active state in New Lead form, and the Email button color. Lead name color is driven by `billing` field (`=== 'Billing'`), not `artist_name`.
- **iOS Safari requires explicit `height` (not just `max-height`) plus `-webkit-overflow-scrolling: touch` for scrollable containers.** `max-height` alone works on desktop but renders as a full-height block on iOS. Apply this pattern to any future scrollable embeds.
- **`StudioSelect` is the canonical studio picker across all forms.** Single flat dropdown showing "Venue · Studio" (e.g. "Paramount · Studio A"). Lives in `components/shared/StudioSelect.tsx`; room data in `lib/studios.ts` (`STUDIO_LOCATIONS`). Replaced two-cascade (venue then studio) dropdowns everywhere — CRM new lead form, lead detail card, booking form. `lib/studios.ts` also exports `parseLocation()` / `combineLocation()` for splitting/joining the "Venue · Studio" string stored in `leads.location`.
- **`lib/roster.ts` is the only write path for label artist arrays.** `addArtistToLabel` / `removeArtistFromLabel` / `getArtistsForLabel` are the sole entry points for modifying `clients.artists[]`. Never write `clients.artists` directly. Artist adds from A&R card saves also write to that contact's own `artists[]` subset.
- **A&R and Admin are saved as FK IDs on each booking, with contact popovers in the booking card.** `bookings.anr_contact_id` + `bookings.anr_admin_contact_id` are written on every booking save. In label booking cards, the A&R and Admin names are clickable popover triggers — an underline indicator shows when the contact has info stored. The popover shows email/phone with Call/Text/Email action links. Inline view (no Edit button) always shows email/phone with action links directly in the card.
- **Label booking card field order: Artist → A&R → Admin.** This matches the booking chain: who's recording, who ordered it, who manages logistics.
- **Registration button only shows for COD leads.** Labels never receive registration links — they have a staffed booking relationship. Guard is `lead.billing !== 'Billing'` wrapping the entire reg button slot.
- **Registration status uses a three-step lookup on lead open.** (1) Query `registration_tokens` by `lead_id` — covers the primary flow where a token was sent from this lead. (2) If not found and `lead.client_id` is set, query tokens by `client_id` — covers returning clients and tokens created after the fix where `client_id` is stored on the token. (3) Fall back to `clients.registered_at` — covers the "Use & Link this Profile" path where `used_at` is set but `clients.registered_at` may not be updated. `generateRegLink()` now also writes `client_id` on the token so step 2 finds it on future loads.
- **`NEXT_PUBLIC_BASE_URL` must be set in Vercel for production registration links.** Falls back to `window.location.origin` if unset (produces `localhost` URLs in local dev — fine for testing, wrong for links sent to clients). Set to `https://prs-flow.vercel.app` in Vercel Production + Preview environments. Also add to `.env.local` for local dev to produce production-correct links.
- **Call/Text/Email action buttons use `<a>` tags with `tel:`, `sms:`, `mailto:` hrefs.** Style defined as `aBtnStyle(color)` — DM Mono 9px, transparent background, `var(--border)` border, no decoration. Colors: Email = `#7BBFFF`, Call = `var(--booked)`, Text = `var(--warm)`. Buttons only render when the field has a value. Applied to: lead detail card contact section, client profile COD contact section, A&R card headers, Admin card headers. `e.stopPropagation()` on card-header links prevents accidental expand/collapse.
- **SOP/Training tab serves a static HTML file.** `/sop.html` lives in `public/` and is served directly by Next.js static file hosting. The `/sop` route renders a full-viewport `<iframe src="/sop.html">`. No nav-gating — visible to all roles. To update the guide, replace `public/sop.html`; no code change needed.
- **RegViewModal is a shared component.** Lives at `components/shared/RegViewModal.tsx`. Used by both the CRM lead card (✓ Registered button) and the Clients page profile (REGISTERED header badge + Verification section). Fetches the full client record and generates a 1-hour signed URL for the ID photo on open.
- **Registration print route at `/register/view/[clientId]`.** Server component (uses anon key). Fetches client data + generates signed ID photo URL server-side. `PrintTrigger` client component fires `window.print()` after 800ms so images load before the dialog opens. Layout: Paramount header, client name in Syne display type, all fields, ID photo, confidential footer.

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
- **Vertical zoom:** Keyboard +/-/0 and Cmd+trackpad scroll. `ZOOM_FIXED = [60, 80, 88, 110, 132]`, level 0 = fit-all (floor; no level below fit). Fit-all computed via `useLayoutEffect` on grid container (synchronous, before scroll effect fires).
- **Individual room collapse** persisted to `localStorage` key `cal_collapsed_rooms`. Location-level collapse persisted to `cal_collapsed_locs`. Both initialized as empty Sets on server render, restored from localStorage in `useEffect([])` to avoid hydration mismatch.
- **Endless horizontal scroll:** Grid renders `BUFFER_WEEKS=2` (14 days) of buffer on each side for ALL views (week, 2wks, month). Column width is dynamic per view: `usableW/7` (week), `usableW/14` (2wks), `usableW/totalDays` (month). When scroll approaches edge, `startDate` shifts ±7 days and `scrollCorrectionRef` corrects scroll position seamlessly. Studio labels are `position: sticky, left: 0`. No post-scroll snapping.
- **View switching always snaps to Sunday of the current real-world week.** `getSunday(new Date())` is always the anchor regardless of what was scrolled. Switching between views sets `shiftingRef.current = true` before the rAF to block transitional scroll events (DOM reflow from column-width change) from falsely triggering infinite scroll — resets to `false` after `scrollLeft` is applied.
- **Initial grid measurement via `useLayoutEffect`** (synchronous, fires before `useEffect`) so `gridW` is correct when the `[startDate, view]` scroll effect runs on mount. Prevents scroll position being computed from the default 1200px fallback width.
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

*Last updated: May 28, 2026 — Calendar view polish session. See session notes below.*

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

### May 28, 2026 — Calendar View Polish

**What was fixed:**

- **"All" location pill** now returns to `2wks` view (was incorrectly returning to `day`).
- **StudioView booking blocks** restyled to match main calendar: black `#0d0f14` background + 3px status-color top bar (was showing full-block color). Border treatment matches (accent left border for non-recording sessions, dim border otherwise).
- **StudioView cells never truncate.** Grid rows changed from fixed `1fr` (equal height, overflow hidden) to `minmax(80px, auto)` with `alignContent: 'start'`. All session info always fully visible regardless of how many bookings are in a cell.
- **StudioView booking blocks show full info:** client name (color-coded COD/Billing), time range, COD method (CC/ZELLE/CASH), engineer initials (1ST-XX), assistant initials (2ND-XX). Engineer/assistant color-coded by status (confirmed=green, hold=orange, unconfirmed=dim).
- **ResizeObserver vertical shrink glitch fixed.** Observer was firing mid-paint with a stale tiny height, causing rows to collapse. Added `requestAnimationFrame` debounce so height/width are only set from stable measurements.
- **Week/2wks/month views all showed same ~10-day range** because `COL_W` was a fixed constant. Changed to dynamic `colW` computed per view: `usableW/7`, `usableW/14`, `usableW/totalDays`. Each view now shows the correct date range.
- **Removed all post-scroll snapping.** The 80ms debounce snap-to-today was removed entirely from `handleGridScroll`.
- **View switching snaps to Sunday of current real-world week.** Clicking any view button always calls `setStartDate(getSunday(new Date()))` regardless of what was scrolled. Works correctly for all views.
- **Fixed 2wks/month not snapping after switching from week view.** Root cause: when switching from week (wide columns) to 2wks/month (narrow columns), the DOM reflow causes the grid's `scrollWidth` to shrink. This fires a `scroll` event before the `requestAnimationFrame` could set the correct position, and `handleGridScroll` saw `scrollLeft` at the old (large) position — past the right-edge threshold — and advanced `startDate` by 7 days. Fix: set `shiftingRef.current = true` before scheduling the rAF (blocking the scroll handler during the transition window), reset inside the rAF after `scrollLeft` is applied.
- **Initial grid measurement via `useLayoutEffect`** ensures `gridW` is correct on first render. Previously the `[startDate, view]` scroll effect fired with `gridW = 1200` (default state) before the ResizeObserver updated the real width, causing `colW` to be wrong and scroll position slightly off on initial load.
- **Zoom: removed redundant 44px level.** `ZOOM_FIXED` changed from `[44, 60, 80, 88, 110, 132]` to `[60, 80, 88, 110, 132]`. Fit-all is level 0 (the floor); `+` goes up from there. 44px was visually identical to Fit on most screens.

---

### May 29, 2026 — CRM Polish + Label Roster + A&R Admin

**CRM new lead form polish (chunk-crm-polish-1):**
- Source field changed from free text to dropdown
- Studio/Location replaced with `StudioSelect` component
- Notes field: placeholder text added
- Company + Label fields hidden automatically in COD mode

**StudioSelect + rate_daily + lead pre-fill (chunk-crm-polish-2):**
- `lib/studios.ts`: `STUDIO_LOCATIONS` constant + `parseLocation()` / `combineLocation()` helpers
- `components/shared/StudioSelect.tsx`: single flat dropdown in "Venue · Studio" format, shared across CRM and calendar
- `leads.rate_daily` (text) added to Lead type for hourly/daily rate toggle on both forms
- Calendar booking form wired to `StudioSelect` and to lead pre-fill from CRM "Start Booking" flow

**Label roster (chunk-crm-polish-3):**
- `lib/roster.ts`: `getArtistsForLabel()`, `addArtistToLabel()`, `removeArtistFromLabel()` — shared write gateway for `clients.artists[]`
- Lead form (Label mode): roster-backed A&R dropdown + artist dropdown
- Booking form: A&R autocomplete backed by `client_contacts` + roster-backed artist dropdown
- Client profile: Artists roster section reads `clients.artists[]`; syncs on every A&R card artist save
- `clients.artists[]` is the authoritative label roster (see Decisions Log)

**StudioSelect flat + field order (chunk-crm-polish-4):**
- `StudioSelect` redesigned as a true flat dropdown (previous version still had two-step cascade internally)
- Lead form field order corrected
- "Move to Booking" button on lead detail card navigates to `/calendar`

**Fixes (May 29):**
- Artist name not persisting to lead record from lead form
- A&R contact info not pre-filling in booking form when launched from a lead
- Hydration error on CRM All Leads filter buttons (localStorage read during SSR)
- Label client search now also matches A&R contact names (not only client name)

**A&R Admin D1 (chunk-anr-admin-d1):**
- Admins section added to label client profiles — separate list of admin/logistics contacts, distinct from A&Rs
- `bookings.anr_contact_id` + `bookings.anr_admin_contact_id` columns documented in `lib/supabase.ts` `Booking` interface

**A&R Admin D2 (chunk-anr-admin-d2):**
- Booking form: admin selection dropdown added for label bookings; `anr_contact_id` + `anr_admin_contact_id` written on every save
- `FormData` and `bookingToForm()` in the booking form updated to include both FK fields
- Contact popovers: A&R + Admin names in booking card are clickable → popover shows email/phone with Call/Text/Email links

**A&R Admin D2b (chunk-anr-admin-d2b):**
- Label booking card field order: Artist → A&R → Admin
- A&R and Admin names act as the popover trigger (underline indicator when info is present); no separate button
- Artist names in A&R card headers shown as small tiles instead of a comma-separated text row

---

### June 1, 2026 — A&R/Admin inline fields, WO signature pad, import script

**Label card inline (chunk-label-card-inline):**
- A&R and Admin fields in label booking card now show email/phone inline with Email/Call/Text action buttons — always visible, no popover required for basic contact info
- `hasInfo` guard: underline indicator on name only when the contact has stored email or phone
- Edit/× buttons removed from client card header — always-visible inline layout

**WO form + print view:**
- WO review form: static signature/print-name fields replaced with interactive legal name input + canvas-based signature pad
- WO print view: signature/print-name section removed (not needed for print-only flow)

**Other June 1 changes:**
- Lead detail card: Last Contact and Time fields removed (Activity Log already captures this)
- Nav: CRM and Calendar order swapped — Calendar now appears before CRM
- WO hub button: orange for draft/in-progress, green for submitted/approved
- Fix: lead `session_notes` now pre-fills into booking form when launched from a lead
- Fix: WO itemized row math corrected
- Fix: client delete now clears all FK references (`work_orders`, `leads`, `registration_tokens`) before deleting the client row — prevents FK constraint errors
- `scripts/importCalendar.mjs`: one-time historical bookings import from `paramount_import_2024.xml` (Supabase Storage). Parses XML, decodes rate codes via WALKTHEDOG cipher (`W=1 A=2 L=3 K=4 T=5 H=6 E=7 D=8 O=9 G=0`), maps studio names to DB IDs, upserts to `bookings` in batches of 100. Header comment: "Run once only. Delete after import is confirmed."
- Calendar booking form: A&R/Admin email+phone state now set inline at contact assignment (two `useEffect` watchers removed — eliminates extra render cycle)

---

### June 2, 2026 — WO modal improvements

**Export PDF + Print (Item 1):**
- Both buttons live in the WO sticky header alongside the existing action buttons.
- **Export PDF** (existing): opens `/wo/{id}/print` in a new tab — clean white-background layout, user manually saves as PDF via browser.
- **Print** (new): opens `/wo/{id}/print?autoprint=1` — same print route, but `PrintTrigger` client component auto-fires `window.print()` 800ms after mount. No new library installed; uses the existing print route's `@media print` CSS (already hides buttons and chrome).
- `app/wo/[id]/print/PrintTrigger.tsx` — new client component (same pattern as `register/view/.../PrintTrigger.tsx`).
- `app/wo/[id]/print/page.tsx` — accepts `searchParams.autoprint`; renders `<PrintTrigger />` when `=== '1'`.

**Close & Save + Cancel buttons (Item 2):**
- Removed the X close button from the sticky header.
- Added **Cancel** (calls `onClose()`, no save) and **Close & Save** (calls `handleClose()`, saves then closes) to both the sticky header and the bottom footer.
- Cancel: ghost style (`rgba(255,255,255,0.12)` border, `#8a8fa0` text). Close & Save header: outlined accent (`rgba(200,240,78,0.12)` bg). Close & Save footer: full accent (`#c8f04e` bg) — unchanged.

**Engineer box colors (Item 3):**
- Engineer row in WO meta grid now shows a subtle background tint based on `booking.engineer_status`:
  - `confirmed` → `rgba(78,240,162,0.08)` (green tint)
  - `hold` → `rgba(240,162,78,0.08)` (orange tint)
  - Otherwise → no change (default transparent)
- Reads `booking.engineer_status` directly from the `booking` prop (already typed as `EngineerStatus` on `Booking`). No new props added.

**Sync on save only (Item 4):**
- Removed `applyLiveForm()` function and `liveForm?: WOFormSync` prop from `WorkOrderPopup`.
- WO now reads only from DB on open — no unsaved booking form state bleeds in.
- WO → booking form sync on Close & Save via `onFormSync` is unchanged.
- Removed `liveForm={...}` from the calendar page's `<WorkOrderPopup>` render.
- `WOFormSync` type and `onFormSync` prop are kept (still used for WO→booking sync on save).

---

### June 2, 2026 — CRM + Clients merge

**What changed:**

- **LEADS / CLIENTS toggle** added to `/crm` above the existing Needs Action / All Leads / Analytics sub-nav. Underline style using `var(--accent)` for active tab. Defaults to LEADS on every page load (no persistence).
- **Clients page embedded** under the CLIENTS tab. `ClientsPageInner` exported from `app/(main)/clients/page.tsx` and rendered with `<Suspense>` inside the CRM page when CLIENTS is active. All existing client list + profile logic is unchanged.
- **Cross-page nav preserved.** CRM page reads `?clientId=` or `?id=` from URL on mount and auto-switches to the CLIENTS tab with the matching client pre-selected. This preserves the "Start Booking → Confirm Client → /clients?id=..." flow — URLs now land on `/crm?clientId=...` instead.
- **Clients nav item removed** from `components/layout/Nav.tsx`. Unreviewed registration badge moved from `/clients` to `/crm`.
- **`/clients` stub redirect** — the default export of `app/(main)/clients/page.tsx` now redirects to `/crm` via `router.replace`. File kept so saved bookmarks don't 404.
- `app/(main)/clients/page.tsx` changes: export `ClientsPageInner`; add `initialClientId` + `embedded` optional props; `embedded` switches outer div from fixed viewport-height to `flex: 1 / minHeight: 0` for correct layout when hosted inside CRM; `router.replace('/clients?id=...')` changed to `router.replace('/crm?clientId=...')`.

### June 1, 2026 (continued) — Registration Status, Contact Actions, SOP Tab

**Fixes applied earlier in the day:**
- CRM hydration mismatch: `view` and `selectedId` state were reading sessionStorage inside `useState` lazy initializers, which run on the client before hydration and differ from the server's catch-branch defaults. Fixed to stable defaults (`'needs-action'`, `null`) with a single `useEffect` restore — same pattern already used in `AllLeadsSection`.
- Registration links were using `localhost:3000` because `window.location.origin` was hardcoded. Fixed with `NEXT_PUBLIC_BASE_URL || window.location.origin`. Add `NEXT_PUBLIC_BASE_URL=https://prs-flow.vercel.app` to `.env.local` for local dev and to Vercel for production.

**chunk-crm-reg-view — Registration status 3-state button:**

Three states replace the old `lead.client_id + existingTokenStr` binary logic:
- **Send Reg** — no token exists; generates token, auto-opens link panel with Copy / Email / Resend
- **Reg Sent** (orange, clickable) — token exists but `used_at` is null; clicking re-queries the DB first (catches completion without page refresh), then toggles an expand panel with Copy Link / Email / Resend
- **✓ Registered** (green, clickable) — token `used_at` is set OR `clients.registered_at` is set; opens registration view modal

Token lookup uses a three-step query on every lead open (see Decisions Log). `generateRegLink()` now stores `client_id` on the token when the lead has one, making step-2 lookups work for future tokens.

Registration button is hidden entirely for Label/Billing leads (`lead.billing !== 'Billing'` guard).

**Registration view modal (`components/shared/RegViewModal.tsx`):**
- Displays full registration submission: name, contact, address, Instagram, how heard, terms accepted badge, ID photo (signed URL, 1hr expiry)
- **Export PDF** button opens `/register/view/[clientId]` in a new tab
- Shared between CRM lead card and Clients page profile — both surfaces open the same modal
- z-index 10003 (above all existing modals)

**`/register/view/[clientId]` print route:**
- Server component: fetches client data + generates 1-hr signed ID photo URL
- Clean letter-sized print layout: Paramount header, client name in Syne display type, all fields, ID photo, confidential footer
- `PrintTrigger` client component fires `window.print()` 800ms after mount

**Registration bug fixes (applied across multiple commits):**
- Reg Sent button staying grey after client completes registration: `refreshRegStatus()` re-queries DB on click; if `used_at` is now set, transitions to ✓ Registered without page refresh
- Leads with `client_id` showing Send Reg after page load: three-step lookup replaces single `lead_id` query
- Use & Link path: token `used_at` is set but `clients.registered_at` may not be updated by that path — handled by step 3 fallback

**Call / Text / Email action buttons:**

Added to every contact surface in the app:
- **Lead detail card** (crm/page.tsx): Email (`mailto:`) inline next to email input; Call (`tel:`) + Text (`sms:`) inline next to phone input
- **Client profile COD contact section**: Email / Call+Text below the InlineField components when values are present
- **A&R contact card headers**: Email inline with email text; Call + Text below when phone present
- **Admin contact card headers**: same pattern as A&R

Style: `aBtnStyle(color)` — DM Mono 9px, transparent bg, `var(--border)` border, no underline. Email=`#7BBFFF`, Call=`var(--booked)`, Text=`var(--warm)`. `e.stopPropagation()` on card-header links.

**Select dropdown styling:**
- `styles/globals.css`: global `select` rule expanded with `-webkit-appearance: none; appearance: none; outline: none` — strips native OS chrome from all select elements so inline styles fully control appearance across all views and browsers.

**SOP / Training tab:**
- Nav item `{ href: '/sop', label: 'SOP' }` added as the last entry in `navItems`
- `app/(main)/sop/page.tsx`: full-viewport iframe (`height: calc(100vh - 52px)`) pointing to `/sop.html`
- `public/sop.html`: static training guide served directly by Next.js; update the guide by replacing this file with no code changes needed
