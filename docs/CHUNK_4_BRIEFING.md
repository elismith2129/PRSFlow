# PRSFlow — Chunk 4 Briefing
*Clients Page implementation guide for Claude Code*

**Last updated:** May 19, 2026
**Purpose:** Self-contained context document. Read this first before any work on Chunk 4.

---

## 1. Project context

**PRSFlow** is a custom studio management web app for Paramount Recording Studios. It replaces a messy patchwork of Google Sheets, Jotform, and QuickBooks.

**Tech stack:**
- Next.js 14 (App Router)
- Supabase (Postgres + Storage + Auth eventually)
- Vercel (hosting)
- Plain CSS (no Tailwind), CSS variables for theming
- TypeScript

**Repo:** `~/Desktop/PRS/PRSFlow/prsflow`
**Live URL:** Vercel deployment (check `vercel.com` for current URL)
**Database:** Supabase project — env vars in `.env.local`

**What's already built (prior chunks):**
- ✅ Chunk 1: CRM core — Needs Action / All Leads / Analytics tabs, Hot/Warm/Cold timers (5/8/11 days), touch logging, detail panel with inline editing
- ✅ Chunk 2: Park feature — "Park until [date]" on leads
- ✅ Chunk 3: Auto-cool — 7-day review prompt, auto-demotion via Vercel cron

**Where Chunk 4 picks up:** The clients data layer is fully built. This brief covers the UI build (4.3 onwards).

---

## 2. What's already done in Chunk 4 (DO NOT REDO)

The database work is **complete and committed**. Do not write migrations for these.

**Tables that exist:**
- `clients` (615 rows already populated from migration)
- `client_contacts` (131 rows)
- `registration_tokens` (empty, ready for use)
- `leads.client_id` column added (1,237 booked leads already linked)

**Migration outcome:**
- 23 label clients created (Interscope, Atlantic, Empire, RCA, Def Jam, Warner, Epic, Capitol, Columbia, SMP, Roc Nation, 88rising, Republic, UMG General, UM Latino, Sony General, 300 Ent, Motown, Island, 10K, and 3 others)
- 592 individual clients
- 131 A&R/rep contacts spread across labels
- 401 booked leads NOT linked (intentionally — they had messy data, will be re-created naturally when those clients book again)

**UI sub-chunks complete:**
- ✅ 4.3 — Clients list page (`/clients`): two-column layout, filter chips (All/Labels/COD), search (including contact names), sort (A-Z/recent/bookings), pagination
- ✅ 4.4 — Client detail panel (right column of `/clients`): full editable profile for both label and COD clients. Label view: contacts (A&Rs) with add/edit/delete, artist chips with add/remove, booking history, notes. COD view: contact fields, billing address, verification status, booking history, notes. Auto-selects first client on load. Mutations save to Supabase and refresh the list in real time. No separate `/clients/[id]` route — detail lives in the right panel.
- ✅ 4.5 — "Book Client" button + modal on CRM lead detail card. Three-path flow: (A) New client — generates a `registration_tokens` row and shows a copyable/emailable link; (B) Existing client — debounced search, select, link; (C) Label booking — search labels, then `ContactPicker` + `ArtistPicker` (both required). After linking, button changes to "View Client Profile →" which navigates to `/clients?id=<uuid>`. `ContactPicker` and `ArtistPicker` live in `components/shared/` as reusable components for Chunk 6.
- ✅ 4.6 — Public registration form at `/register/[token]` — replaces Jotform. Token validation (invalid/expired/used states), all required fields with inline validation, phone auto-formatting, ID file upload to private `client-ids` Supabase Storage bucket (25MB limit, image+PDF only, anon INSERT policy). On submit: creates `clients` row, marks token used, backfills `leads.client_id`. Success state replaces form in-place. Route group `(main)` isolates internal pages from public routes — Nav only renders inside `app/(main)/`.
- ✅ 4.6b — Registration form improvements: iOS camera capture on ID upload (`capture="environment"`) and scrollable embedded T&Cs (fixed iOS Safari overflow rendering with explicit `height` + `-webkit-overflow-scrolling`). T&Cs content lives in `lib/terms.ts` as structured array (heading + body), easy to update without touching form logic. `terms_accepted` boolean and submit logic unchanged.

**If you think the schema needs changing, STOP and ask the user before writing ALTER TABLE statements.**

---

## 3. Design system

PRSFlow uses a dark theme with specific tokens. Match these exactly — do not invent new colors or fonts.

**CSS variables** (defined in `styles/globals.css`):
```css
--bg: #0d0f14
--surface: (slightly lighter than bg, check existing globals.css)
--surface2: (used for active nav items, panels)
--border: (subtle border color)
--text: (primary text)
--text2: (secondary text)
--text3: (tertiary/muted text)
--accent: #c8f04e   (yellow-green — primary accent)
--hot: #f04e7a      (pink-red — used for Hot status, warnings)
```

**Fonts** (loaded via `next/font/google` in `app/layout.tsx`):
- **Syne** — headings, section titles (uppercase, letter-spaced)
- **DM Serif Display** — large display text (page titles), use `<em>` for italic accent emphasis
- **DM Mono** — body text, labels, data, navigation items

**Layout patterns to match:**
- Two-column layouts: left = list, right = detail panel
- Nav bar at top (already built — see `components/layout/Nav.tsx`)
- Section titles in Syne uppercase: `font-family: 'Syne'; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text3)`
- Page titles in DM Serif Display: large, with `<em>` accent color on key word

**Reference for styling decisions:** Look at how `app/crm/page.tsx` is structured. The Clients page should feel like a sibling.

---

## 4. Data model reference

### `clients` table

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `type` | text | `'label'` or `'individual'` |
| `name` | text | Display name. For labels: "Def Jam". For individuals: full name. |
| `fname` | text | Individuals only |
| `lname` | text | Individuals only |
| `email` | text | |
| `phone` | text | |
| `instagram` | text | |
| `address_street`, `address_street2`, `address_city`, `address_state`, `address_zip` | text | Billing address (split per Jotform) |
| `artists` | text[] | Array of artist names. Used for label autofill picker. |
| `id_file_url` | text | Supabase Storage path for ID upload |
| `signature_url` | text | Supabase Storage path for signature |
| `terms_accepted` | boolean | |
| `terms_accepted_at` | timestamptz | |
| `how_heard` | text | "How did you hear about us?" |
| `registered_at` | timestamptz | When registration form was completed (null = manually entered or migrated) |
| `source_lead_id` | bigint | FK to leads.id (which lead originally became this client) |
| `notes` | text | |

### `client_contacts` table

A&Rs, reps, and contacts under a label client. **Only meaningful for `type='label'` clients.** For individuals, the client row IS the contact.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | |
| `client_id` | uuid | FK to clients.id (CASCADE on delete) |
| `fname`, `lname` | text | |
| `email` | text | |
| `phone` | text | |
| `instagram` | text | |
| `role` | text | "A&R", "Manager", etc. (free text) |
| `notes` | text | |

### `registration_tokens` table

For the public registration form. Single-use tokens, expire after 7 days.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | |
| `token` | text | Unique, used in URL: `/register/[token]` |
| `lead_id` | bigint | FK to leads.id (which lead this is for) |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | Default: 7 days after created_at |
| `used_at` | timestamptz | Null until form submitted |
| `prefill_email` | text | Pre-fill the form with this |
| `prefill_name` | text | Pre-fill the form with this |

### `leads` table — new column

`leads.client_id` (uuid, nullable) — FK to clients.id. Set when a lead is converted to/linked to a client.

---

## 5. Critical data model decisions (the WHY)

These are the rules we agreed on. Don't deviate without asking.

**1. Label = client. A&R = contact. Artist = text array.**
- When Def Jam books, the **client is Def Jam**, the **"ordered by"** is the A&R (e.g., Nick Sligh), the **artist** is who's actually recording (e.g., Lil Baby).
- A&Rs are reusable across multiple bookings → they get their own rows in `client_contacts`.
- Artists are fluid and one-off → just a text array on the client.
- For COD/individual clients, the client = ordered by = artist, all collapsed into one row.

**2. Label divisions are separate clients.**
- Sony General ≠ Sony Latin ≠ UMG General ≠ UM Latino. These are distinct labels in the data and should be treated as distinct clients. Don't try to merge them.

**3. Analytics priority: client first.**
- "Def Jam: 47 bookings this year, top contact Nick Sligh (18), top artist Lil Baby (9)"
- NOT "Nick Sligh: 18 bookings" as the primary axis.

**4. Migrated clients have minimal data.**
- The 615 migrated clients only have `name`, maybe `email`/`phone`, and `notes`. No address, no ID, no signature. They were never registered.
- Going forward, new clients should go through the registration flow OR be manually completed from the Clients page.

**5. The 401 unlinked booked leads are intentional.**
- These are messy historical entries we chose to skip. Their lead records still exist in `leads`. They just don't have a `client_id`. Don't try to "fix" them in bulk — they'll be cleaned up naturally as those clients book again through the proper flow.

**6. No RLS yet.**
- Tables are open like the `leads` table. RLS + auth comes in Chunk 9. Keep consistent with existing tables — don't enable RLS on the new tables piecemeal.

---

## 6. Build order (sub-chunks)

Build one sub-chunk at a time. Commit + push at the end of each. Get user approval before moving to the next.

### 4.3 — Clients list page

**Route:** `/clients`
**File:** `app/clients/page.tsx`

**Requirements:**
- Two-column layout (match dashboard/CRM pattern)
- Filter chips at top: `All` / `Labels` / `Individuals` (default: All)
- Search box: filters by client name, email, and contact names (so searching "Sligh" finds Def Jam because Nick Sligh is a contact there)
- Sort options: A-Z (default), Recently added, Most bookings (count of leads where client_id matches)
- Each row in the list shows:
  - Client name (large)
  - Type badge: `LABEL` (accent color) or `INDIVIDUAL` (muted)
  - For labels: contact count + artist count ("3 contacts · 12 artists")
  - For individuals: email or phone
  - Booking count ("47 bookings")
- Right panel: when a client is selected, shows a preview (full detail page = 4.4)
- Pagination: 50 per page

**Definition of done:**
- Page renders at `/clients` with all 615 clients
- Search filters correctly
- Filter chips work
- Sort works
- Selecting a client shows preview in right panel
- Nav bar shows "Clients" as active when on this page
- Matches dark theme exactly — no white backgrounds, no Tailwind classes

---

### 4.4 — Client detail page

**Route:** `/clients/[id]`
**File:** `app/clients/[id]/page.tsx`

**Two render modes based on `client.type`:**

**LABEL VIEW:**
- Header: large label name, "LABEL" badge, edit button
- Section: Contact info (label's main office contact, if any) — inline editable
- Section: **Contacts (A&Rs)** — list of `client_contacts` for this client
  - Each row: name, email, phone, role, instagram
  - "Add contact" button at bottom
  - Click contact → expands inline edit
- Section: **Artists** — chips showing each artist in the `artists` text array
  - "Add artist" button (just a text input that pushes to the array)
  - Click artist chip → remove option
- Section: **Booking history** — leads where `client_id = this.id`, status = 'booked'
  - For now: just a list showing date, fname/lname (who was on the original lead), session_date, booking type
  - Sort by created_at desc
- Section: **Notes** — free text, inline editable
- Footer: "Migrated from booked leads" if source_lead_id is set and registered_at is null

**INDIVIDUAL VIEW:**
- Header: full name, "INDIVIDUAL" badge, edit button
- Section: Contact info (email, phone, instagram) — inline editable
- Section: Billing address (5 fields) — inline editable, shown collapsed if empty
- Section: **Booking history** — same as label view
- Section: **Verification** — shows if registered (ID uploaded, terms accepted) or "Not yet registered" with a "Send registration link" button
- Section: Notes
- Footer: "Migrated" if applicable

**Definition of done:**
- Both render modes work
- Inline editing saves to Supabase
- Adding/removing contacts works (for labels)
- Adding/removing artists works (for labels)
- Booking history shows correctly

---

### 4.5 — "Book Client" button + modal flow

**Where:** Lead detail card in CRM (`components/crm/LeadDetail.tsx` or similar)

**When the button appears:**
- Only when lead's `status = 'booked'`
- Label changes based on state:
  - If `client_id` is null → button reads "Book Client"
  - If `client_id` is set → button reads "View Client Profile →" (links to `/clients/[id]`)

**The "Book Client" modal — three-path flow:**

**Step 1:** Modal opens with question: "Who is this booking for?"
- Radio options:
  - ◯ New client — send registration form
  - ◯ Existing client — search
  - ◯ Label booking — pick label + contact + artist

**Step 2 (path A — New client):**
- Show: "We'll generate a registration link to send to [pre-filled email from lead]"
- Two buttons: "Copy link" and "Email link to client" (email button just opens default mail client with mailto:)
- On generate: creates `registration_tokens` row with lead_id set, expires_at = now() + 7 days, prefill_email and prefill_name from lead
- Show the link in the modal so user can verify
- When client submits the form (handled by 4.6), a client is auto-created and the lead's client_id gets set

**Step 2 (path B — Existing client):**
- Search box: filters all clients by name, email
- Pick one → "Confirm contact info still accurate" — shows existing email/phone, with optional edit
- Submit → sets lead's `client_id` to the selected client

**Step 2 (path C — Label booking):**
- Search box: filters clients where `type = 'label'`
- Pick label → reveals two more fields:
  - **Ordered by** (autofill from `client_contacts` for this label) — typing "Nick" autocompletes from existing contacts; "Add new contact" option creates a new row in `client_contacts`
  - **Artist** (autofill from this label's `artists` array) — typing autocompletes; "Add new artist" pushes to the array
- Submit → sets lead's `client_id` to the label client
- Currently no booking record is created (that's Chunk 7) — just the link

**Definition of done:**
- Button appears only on booked leads
- All three paths complete cleanly
- Autofill works for both contacts and artists
- Lead's client_id gets set correctly
- After conversion, button changes to "View Client Profile →"

---

### 4.6 — Public registration form

**Route:** `/register/[token]` — **no login required, public route**
**File:** `app/register/[token]/page.tsx`

**Fields (match Jotform exactly):**
1. Full Name (First + Last, two fields side by side) — required
2. Phone Number — required, format hint (000) 000-0000
3. Email — required, pre-filled from token's `prefill_email`
4. Instagram — required
5. How did you hear about us? — optional
6. Billing Address — required (5 sub-fields: street, street 2, city, state, zip)
7. ID Upload — required, file input, accepts images and PDFs, stores to Supabase Storage in private `client-ids` bucket
8. Terms acknowledgment — required checkbox: "By signing below, you acknowledge the information above is accurate and that you have read and agreed to our Terms and Conditions and Cancelation Policy."
9. Signature (typed name as signature for now, can upgrade to drawn signature later) — required

**Logic:**
- On page load: validate token exists, not expired, not used. If invalid → show "This link has expired or already been used."
- On submit:
  - Upload ID to Supabase Storage
  - Create `clients` row with type='individual', registered_at=now(), terms_accepted=true, all form data
  - Mark token's `used_at = now()`
  - If token has `lead_id`, set that lead's `client_id` to the new client
  - Show success page: "Thanks! You're registered. We'll be in touch about your session."
- On Supabase write failure: show error, keep form data so user can retry

**Storage bucket setup:**
- Create private bucket `client-ids` in Supabase Storage
- Files named: `{client_id}/{timestamp}_{original_filename}`
- Store path in `clients.id_file_url`

**Definition of done:**
- Form renders at `/register/[token]` with valid token
- Invalid tokens show error
- All fields validate correctly
- ID upload works to Supabase Storage
- Client gets created on submit
- Lead gets linked back
- Success page shown
- Form is styled to match PRSFlow dark theme (yes, even the public page — it's the client's first impression)

---

### 4.7 — Polish + edge cases

- Notification badge or toast when someone completes registration
- Handle clients without emails (some migrated individuals may have phone-only contact)
- Empty states: "No clients yet" on list page, "No contacts yet" on empty label, "No bookings yet"
- Loading skeletons for the list and detail pages
- Confirm dialogs before destructive actions (delete contact, remove artist)
- Mobile responsive (basic — phone view of list + detail)
- Tests: at minimum, manually test all three Book Client paths end-to-end

---

## 7. The Book Client modal — visual spec

Modeled after the existing New Lead modal but with the three-path flow. Should feel like a sibling component.

**Modal size:** ~480px wide, fits comfortably in center of screen

**Visual hierarchy:**
1. Header: "Book Client" + close X
2. Subhead: lead's name + email (small, muted) — "for Nick Sligh · nick.sligh@umusic.com"
3. Step indicator (small dots or text "Step 1 of 2")
4. Main content area — changes based on path
5. Footer: Back / Cancel / Submit buttons

**Tone:** efficient, not chatty. Studio staff use this 10+ times per day.

---

## 8. Registration form — visual spec

Public-facing, but should still feel like PRSFlow (dark theme, accent color, fonts). This is the client's first interaction with the system.

**Layout:**
- Single-column centered, max-width ~520px
- PRS logo at top
- Welcome message: "Welcome to Paramount Recording Studios. Please complete this form to verify your account."
- Form fields stacked
- Submit button at bottom (accent color, full width)

**Validation:**
- Inline errors below each field
- Don't allow submit until all required fields are valid
- Phone field: format as user types

---

## 9. Things to NOT do

- ❌ Don't enable RLS on any tables. Wait for Chunk 9 (Auth).
- ❌ Don't re-migrate booked leads. The migration is done and committed.
- ❌ Don't change the schema without asking. The data model decisions are intentional.
- ❌ Don't try to clean up the 401 unlinked booked leads in bulk. They're intentionally messy and will resolve naturally.
- ❌ Don't use Tailwind. Use plain CSS with the established CSS variables.
- ❌ Don't introduce new fonts. Stick to Syne / DM Serif Display / DM Mono.
- ❌ Don't auto-send emails. The "Email link" button just opens the user's mail client with mailto:. We're not building email sending until Chunk 5 (webhooks).
- ❌ Don't create a Bookings table. That's Chunk 7. For now, "bookings history" on a client is just `select * from leads where client_id = ?`.

---

## 10. Suggested session flow with Claude Code

**Session 1 (1-2 hours):**
- 4.3 (list page)
- 4.4 (detail page)
- Commit + push between each

**Session 2 (1-2 hours):**
- 4.5 (Book Client modal)
- Manual testing of all three paths
- Commit + push

**Session 3 (1-2 hours):**
- 4.6 (registration form + Storage)
- 4.7 (polish)
- Commit + push
- Mark Chunk 4 complete

**Start each session with:**
> "Read docs/CHUNK_4_BRIEFING.md. We're working on [sub-chunk number]. Run `npm run dev` and let's start."

**End each session with:**
> "Commit and push the current work with a clear message. Update the briefing if anything changed."

---

## 11. After Chunk 4

Next up:
- **Chunk 5:** Webhooks (Squarespace → leads, the new in-app registration form replaces Jotform's role for client creation)
- **Chunk 6:** Session QC
- **Chunk 7:** Work Orders + Bookings table (this is when "booking history" on client profiles becomes structured rather than just linked leads)
- **Chunk 8:** Admin settings
- **Chunk 9:** Auth + RLS
- **Chunk 10:** Dashboard

---

*Update this briefing as Chunk 4 progresses. It's the source of truth for anyone (including future Claude sessions) picking up this work.*
