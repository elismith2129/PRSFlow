# Chunk 6: Calendar & Booking System

**Goal:** Build the calendar interface and booking creation flow that connects leads → clients → sessions. This is the core operational tool for daily studio management.

---

## Overview

The calendar is where staff:
- View all upcoming sessions across all studios
- Create new bookings from leads or returning clients
- Manage work orders (recording, mixing, mastering, filming)
- Handle resource conflicts (double-bookings, engineer availability)
- Track session status (confirmed, tentative, completed, cancelled)

This chunk replaces manual scheduling and creates a single source of truth for what's happening in each studio on any given day.

---

## Sub-chunks

### 6.1 — Schema & Data Model
**Tables to create:**
- `bookings` — core booking record (client_id, lead_id, booking_date, start_time, end_time, location, studio, status, total_price, deposit_paid, balance_due, engineer_needed, engineer_assigned, notes)
- `work_orders` — tasks within a booking (booking_id, work_type, status, rate, estimated_hours, actual_hours, notes)
- `engineers` — staff roster (id, name, email, phone, hourly_rate, active)
- `session_logs` — post-session notes (booking_id, actual_start, actual_end, equipment_used, issues, next_steps)

**Enums/Status values:**
- Booking status: tentative, confirmed, in_progress, completed, cancelled, no_show
- Work order type: recording, mixing, mastering, filming, other
- Work order status: pending, in_progress, completed, cancelled

**Relationships:**
- bookings.client_id → clients.id
- bookings.lead_id → leads.id (tracks which lead generated this booking)
- work_orders.booking_id → bookings.id
- session_logs.booking_id → bookings.id

### 6.2 — Calendar UI (Week View)
**Layout:**
- Time grid: 8am–12am (midnight) in 30-minute blocks
- Columns: one per studio (Studio A, Studio B, etc.)
- Rows: time slots
- Color coding: tentative (gray), confirmed (green), completed (blue), cancelled (red)

**Features:**
- Click empty slot → opens "New Booking" modal
- Click existing booking → opens booking detail/edit modal
- Drag to resize booking (change duration)
- Drag to move booking (change time/studio)
- Filter by location (Paramount, Ameraycan, Encore, Track)
- Navigate weeks (prev/next arrows)
- "Today" button to jump to current week
- Mini month picker for date jumping

### 6.3 — New Booking Flow
**Entry points:**
1. Click empty calendar slot → pre-fills time/studio
2. "Start Booking" button on lead detail card → pre-fills client/lead
3. "+ NEW BOOKING" button in calendar header → blank form

**Form fields:**
- Client (search/select from existing, or create new)
- Lead (optional — links back to which lead generated this)
- Date, Start Time, End Time
- Location (dropdown: Paramount, Ameraycan, Encore, Track)
- Studio (cascading dropdown based on location)
- Work Orders section:
  * Add multiple work orders (recording, mixing, mastering, filming)
  * Each has: type, estimated hours, rate
  * Auto-calculates subtotal per work order
- Pricing:
  * Total (sum of all work orders)
  * Deposit paid (dollar amount)
  * Balance due (auto-calculated)
- Engineer needed? (checkbox)
- Engineer assigned (dropdown from engineers table, only if needed)
- Session notes (optional)
- Status (tentative vs confirmed)

**Validation:**
- Conflict detection: if another booking exists in same studio at overlapping time, show warning
- Engineer conflict: if assigned engineer has another booking at same time, show warning
- Allow override with confirmation ("Book anyway?")

### 6.4 — Booking Detail & Edit
**When clicking an existing booking:**
- Modal shows all booking details (read-only by default)
- "Edit" button unlocks fields
- "Cancel Booking" button (confirm dialog, sets status to cancelled)
- "Mark Completed" button (sets status to completed, prompts for session log)
- Work orders list (inline edit: add/remove, change hours/rates)
- Payment tracking (deposit/balance fields)
- Session log section (post-session notes, actual start/end, equipment used)

### 6.5 — Work Orders & Pricing
**Work order management:**
- Each booking can have multiple work orders (1 recording session + 2 mixing sessions, etc.)
- Each work order tracks: type, estimated hours, rate, actual hours (filled post-session)
- Pricing auto-updates when work orders change
- Work order statuses independent of booking status (booking confirmed, but one work order completed and one pending)

**Pricing display:**
- Show per-work-order subtotals
- Show total
- Show deposit paid / balance due
- Flag overdue balances (if booking is completed but balance > 0)

### 6.6 — Engineer Assignment & Availability
**Engineer roster:**
- Admin page to add/edit engineers (name, rate, active status)
- Engineer availability (future: block out unavailable times, for now just conflict warnings)

**Assignment:**
- If "Engineer needed" is checked, assign from dropdown
- Conflict detection: warn if engineer has overlapping booking
- Allow override ("Book anyway, engineer will figure it out")

**Future consideration (not in this chunk):**
- Engineer availability calendar (block out vacation, sick days)
- Automatic suggestion of available engineers

### 6.7 — Session Logs & Post-Session Flow
**After session completes:**
- "Mark Completed" button on booking detail
- Opens session log form:
  * Actual start time (vs scheduled)
  * Actual end time
  * Equipment used
  * Issues encountered
  * Next steps / follow-up needed
- Saves to `session_logs` table
- Booking status → completed
- If balance due > 0, flag for payment follow-up

---

## Key Decisions

### Location/Studio Data
Already defined in Chunk 4:
- Paramount: Studio A, B, C, E, X
- Ameraycan: Studio A, B
- Encore: Studio A, B
- Track: North, South

Store these as reference data (either hardcoded or in a `studios` table).

### Time Blocks
Calendar displays 30-minute blocks (8:00am, 8:30am, 9:00am...). Bookings can start/end at any 30-minute increment. Standard session lengths: 2hr, 4hr, 6hr, 8hr (but allow custom).

### Conflict Handling
**Warn but allow overrides.** Studio conflicts and engineer conflicts show a warning dialog: "Studio A is already booked 2–6pm. Book anyway?" Staff can override — sometimes double-bookings are intentional (overlap during setup/breakdown).

### Pricing & Payment Tracking
**Simple for now.** Track total, deposit, balance. Full invoicing/payment processing is future (Chunk 8 or 9). For now, just track numbers and flag overdue balances.

### Calendar Permissions
**No role-based access in Chunk 6.** Everyone with app access can view and edit all bookings. Permissions/roles come later (Chunk 9 — Auth).

---

## Dependencies

**From Chunk 4:**
- Clients table (bookings link to clients)
- Leads table (bookings link to leads to track conversion)
- Location/Studio dropdown logic already built in lead detail card

**New infrastructure needed:**
- None — calendar is pure app-level feature using existing Supabase setup

---

## Success Criteria

Chunk 6 is complete when:
1. Staff can view a week-view calendar with all studios
2. Staff can create a booking from calendar, lead, or "+ NEW BOOKING"
3. Bookings display on calendar with correct time/studio/color
4. Conflict warnings appear for studio and engineer overlaps
5. Work orders can be added/edited within a booking
6. Pricing auto-calculates from work orders
7. Bookings can be edited, cancelled, or marked completed
8. Session logs can be filled out post-session
9. Engineer assignment works with conflict detection
10. Calendar is usable on desktop (mobile view is Chunk 7)

---

## Out of Scope (Future Chunks)

- Recurring bookings (weekly sessions, etc.) — Chunk 7
- Email/SMS confirmations to clients — Chunk 8
- Invoicing & payment processing — Chunk 8
- Calendar sync (Google Calendar, iCal export) — Chunk 9
- Engineer availability blocking — Chunk 9
- Mobile-responsive calendar — Chunk 7
- Role-based permissions — Chunk 9

---

## Tech Notes

**Calendar library:** Likely build custom with CSS Grid (one column per studio, rows for time slots). Most calendar libraries (FullCalendar, react-big-calendar) are designed for single-resource calendars, not multi-studio grids. Building custom gives full control over the studio-column layout.

**Drag-and-drop:** Use react-beautiful-dnd or similar for drag-to-reschedule. This is polish, not MVP — can add after basic click-to-edit works.

**Time zone:** All times stored in PST/PDT (studio local time). No multi-timezone support needed.

---

**Last updated:** May 20, 2026 — Ready to build
