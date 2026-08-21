# TV display calendars — build brief (Eli, 2026-08-18)

*Per-room wall calendars on Sharp Info Displays (signage screens that render a
web page). First up in a fresh session: mock → Eli picks → build. Start with
**Encore Studio B**; the pattern then stamps out per room.*

## Eli's requirements (his words, distilled)

- **Traditional calendar** per room — the month-grid style he currently
  builds by hand on a WordPress site (he'll provide a screenshot/link as the
  reference for dimensions and layout sizing).
- **View-only, zero interaction**: no nav, no clicks, nothing focusable. It
  lives on a wall.
- **Auto-updating** — a booking change appears on the TV without anyone
  touching it.
- **Readable from across a room** — signage type sizes, not desktop sizes.
- **Design-system faithful**: "the cal's look and feel and cal cards follow
  all the rules" — the shared session-card language (status colours per spec
  §5, one shared card idiom), just rendered big and read-only.
- **Multi-day sessions TRUNCATE** — short labels, never widening/growing the
  calendar rows.
- **Built into the MAIN app** (production domain), not a preview URL that has
  to be typed into each TV — e.g. `/display/encore/b`.

## Build notes for the session that takes this

- **Auth is the real design decision.** RLS blocks anon reads (July 2 / Aug
  14), and a signage browser can't be counted on to hold a login across
  reboots. Proposed: a service-role API route (`/api/display?studio=…&room=…
  &key=…`) gated by a `DISPLAY_KEY` env var, returning ONLY what the wall may
  show (artist/label, times, status — decide with Eli whether client names
  belong on a wall guests can see). The page polls it (~60s) + hard-refreshes
  nightly. This page fetches from the API, not supabase-js, so the realtime
  standing rule doesn't apply directly — note it in PROJECT_LOG when built.
- Route lives OUTSIDE `(main)` (no AuthGuard, no rail), like `/inquiry`.
- Screen assumption to confirm: 1080p landscape. Test at exact resolution.
- Bookings are location-keyed: filter `location='Encore'` + room letter via
  the projection cards (`bookings`), same source the calendar reads.
- Kiosk hygiene: no hover states, no cursors, overflow hidden, dark theme
  (spec default), clock/date header so a frozen page is visibly frozen.
- Per-room config table or just URL params? Start with URL params; a config
  table is Phase 2 if per-room quirks appear.

## Open questions for Eli (blocking the mock)

1. Screenshot (or link) of the current WordPress room calendar — the sizing
   reference.
2. Month grid confirmed? Or rolling next-N-weeks? (His "trad calendar"
   suggests month grid.)
3. What may a WALL show: artist only? artist + label? Never rates/phone —
   confirm the redaction list.
4. TV resolution/orientation (assumed 1920×1080 landscape).
