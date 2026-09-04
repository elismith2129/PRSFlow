# TV display calendars — build brief (Eli, 2026-08-18)

> **⚠ READ THIS FIRST — SHIPPED ARCHITECTURE (2026-08-26). The sections below
> this box are the original brief; the delivery path changed completely after
> a day of debugging, and the final pieces live OUTSIDE this repo.**
>
> ## How the TVs actually get the calendar (working on Encore B)
>
> **The Sharp panels cannot load ANY Let's Encrypt certificate.** They run a
> 2013 Android 4.4 browser (Sharp "HTML5 Browser") that ignores user-installed
> CAs and shows a WHITE SCREEN instead of any error page — every failure looks
> identical to a rendering bug, which burned hours. Everything on Vercel uses
> Let's Encrypt, so the TVs can NEVER load `prsflow.paramountrecording.com`
> directly. Do not retry certificates; do not debug the HTML when a panel is
> white — the panel probably never received it.
>
> **The path that works:** TVs speak plain `http://` to the WordPress host
> they've trusted for years, and WordPress fetches the page from Vercel
> server-side:
>
> ```
> Sharp TV ── http://paramountrecordingla.com/prsflow-display/{slug} ──▶ WordPress
>                                            (PRSFlo Display Proxy plugin)
>                                                        │ https + secret header
>                                                        ▼
>                    https://prsflow.paramountrecording.com/display/{slug} (Vercel)
> ```
>
> **Pieces, and where each one lives:**
>
> 1. **The display page** — `app/display/[room]/route.ts` (IN this repo).
>    Server-rendered, service-role, carved dark register, 5-second
>    change-detection poll (sha1 probe + `location.reload()`), self-healing
>    error page. Slugs from `lib/displayRooms.ts` (`ers-b`, `prs-a`, …).
> 2. **The WordPress plugin** — **NOT in this repo.** "PRSFlo Display Proxy"
>    (single file `prsflow-display-proxy.php`), installed and active on
>    `paramountrecordingla.com` via wp-admin → Plugins. It intercepts
>    `/prsflow-display/{slug}`, validates the slug (`[a-z0-9-]`, no open
>    proxy), fetches the Vercel page with a shared-secret header
>    (`x-prsflo-display-key`), passes query strings through (the refresh
>    probe + `?diag=1` depend on that), adds `X-Robots-Tag: noindex`, and
>    serves a self-retrying "Reconnecting…" page if Vercel is unreachable.
>    To edit it: wp-admin → Plugins → Plugin File Editor, or rebuild the zip
>    and "Replace current with uploaded". The live secret value is IN the
>    installed plugin file and in the Vercel firewall rule — per repo policy
>    it is not committed here.
> 3. **Vercel firewall rules** (project → Firewall — NOT in this repo):
>    Vercel bot protection challenges non-browser fetches ("Security
>    Checkpoint code 99" — WordPress can't run its JavaScript test), so:
>    • *TV Displays* — path starts `/display` AND header
>      `x-prsflo-display-key` equals the secret → **Bypass**.
>    • *TV Displays Deny* — path starts `/display` AND header ≠ secret →
>      **Deny** (closes the public back door; staff use the WP URL too).
>    Firewall rules only take effect after **Review Changes → Publish** —
>    unpublished rules silently evaporate (bit us once).
> 4. **The TV itself:** CONTENT MENU → HTML5 Browser, Web URL =
>    `http://paramountrecordingla.com/prsflow-display/ers-b` (note **http**).
>    Changing the URL does NOT re-navigate — relaunch HTML5 Browser after.
>
> **Also true:** Vercel is on Pro (the 5-second poll ≈ 2M invocations/month
> across 11 TVs ≈ $1–2 overage; Hobby would have PAUSED the whole app at the
> limit). Rent-only `lockout` bookings render on the wall in booked-green
> with no COD strip. `scripts/display-proxy.mjs` (in repo) is the SUPERSEDED
> Mac-based LAN proxy from the same debugging day — kept as fallback; the
> WordPress plugin replaced it so no always-on machine is needed.
>
> **Rollout to the other ten TVs** = same URL with each room's slug from
> `lib/displayRooms.ts`, one panel at a time.

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
