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
- **"Book Client" button on lead detail card** appears only when `status = 'booked'`. Three-path modal: New client (send registration link), Returning client (search existing), Label booking (label → A&R → artist).
- **Autofill pickers (contacts, artists) are reusable components.** Built as standalone components in `components/clients/` or `components/shared/`, will be reused in the Calendar's New Session modal.
- **Public-facing forms use scrollable embedded legal text rather than external links or modals.** Keeps clients on the page, mobile-friendly, legally protective. T&Cs content lives in `lib/terms.ts` as a structured array (heading + body), easy to update without touching form logic.
- **All Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) must be configured for ALL THREE Vercel environments (Production, Preview, Development).** Preview deploys fail with "supabaseUrl is required" if missing from the Preview environment.
- **COD vs Label/Billing color convention:** COD = `#7BBFFF` (sky blue), Label/Billing = `#96A9FF` (periwinkle). Same brightness, distinct hues. Applied to lead names in CRM list and detail card header, client names in Clients list and profile header, billing pills everywhere, COD/Label-Billing toggle active state in New Lead form, and the Email button color. Lead name color is driven by `billing` field (`=== 'Billing'`), not `artist_name`.
- **iOS Safari requires explicit `height` (not just `max-height`) plus `-webkit-overflow-scrolling: touch` for scrollable containers.** `max-height` alone works on desktop but renders as a full-height block on iOS. Apply this pattern to any future scrollable embeds.

---

## 2. Future Considerations
*Things to think about when we get to a specific chunk. Don't build now, but don't forget.*

### Chunk 6 — Calendar
- **"View Client Profile →" post-booking link is underwhelming.** After completing Book Client (paths B or C), the button changes to a muted text link. It works, but the UX will likely change once Calendar lands — post-booking flow will probably navigate to a new session form rather than to the client profile. Revisit then.
- **Bookings can exist before registration completes.** Calendar holds get placed before COD clients finish their registration form. Bookings table needs a status like `hold | confirmed | completed | cancelled`. Held bookings without complete client profiles should show "PENDING REGISTRATION" visual treatment.
- **Bookings link to either lead OR client.** Early-stage holds may only have a lead reference; bookings get a `client_id` set later when registration returns. Schema should allow both nullable, but enforce one of them present.
- **Two entry points for "New Session":** double-click open slot on calendar (date pre-filled) OR "Schedule" button from a Booked lead in CRM (client pre-filled). Same modal, different pre-fills.
- **Reuse contact and artist pickers from 4.5.** Don't rebuild them inside the calendar modal.
- **For labels: always available.** All 23 labels are already in the system, so the "is this a returning client?" question doesn't apply. Just pick the label.
- **For CODs: handle pre-registration.** Calendar should support creating a hold for a COD before their profile is complete. The hold links to the lead; client_id gets backfilled when registration returns.

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

*Last updated: May 20, 2026 — Chunk 4 complete. CRM is production-ready. Next: Chunk 6 (Calendar/Booking).*
