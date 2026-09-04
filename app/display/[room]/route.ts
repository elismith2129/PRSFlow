// TV wall calendars — /display/[room]  (e.g. /display/ers-b)
//
// WHY THIS IS A ROUTE HANDLER AND NOT A PAGE
// The screens are Sharp PN-B401 signage panels on Android 4.4.2, so the browser
// is Chromium 30 (2013). It has NO CSS custom properties (needs 49), NO CSS Grid
// (57), NO ES6 (49), NO fetch (42), NO Promise (32). A React page renders blank
// there — confirmed on the Encore B panel, 2026-08-19. So this route emits
// hand-written HTML with a <table> grid and literal values, and refreshes with
// <meta http-equiv="refresh">. Zero client script: it cannot leak memory, cannot
// drop a socket, and survives a browser from 2013. (Those panels also needed
// ISRG Root X1 installed by hand before they would complete a TLS handshake
// with Vercel — see docs/TV-DISPLAY-BRIEF.md.)
//
// DESIGN SOURCE: the CARVED system, not the design this branch currently ships.
// Ruled 2026-08-19: the wall is a new surface with no legacy users, so it is
// built to where the app is going rather than where it is. Values are resolved
// literals from redesign/carved — styles/globals.css tokens (§3), the status
// system (§5), the card anatomy (§10b) and SessionCard.tsx — because var() does
// not exist on the target. THE LIME/TEAL ACCENT IS RETIRED (§12): there is no
// accent colour on this page. When carved merges, replace these literals with
// the tokens; do not re-derive them from main.
//
// Ten-foot minimums (§13): artist ≥15px equivalent, mono ≥12px, COD strip
// full-width and unmissable. Dark register only — the wall runs dark.
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timeToMins } from '@/lib/time'
import { findDisplayRoom } from '@/lib/displayRooms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SERVER-ONLY service-role client. RLS blocks anon reads (July 2 / Aug 14) and a
// signage browser cannot hold a login across reboots, so the wall is served by
// the server with an explicit column whitelist. Rates, engineer_rate, phone,
// email, po and notes never leave this process.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const COLS =
  'id,location,studio,start_date,end_date,from_time,to_time,status,session_type,' +
  'payment_type,cod_method,artist,label,client_name,engineer_name,assistant_name,invoice_num'

// TV CONTRAST OVERRIDE (Eli, 2026-09-03): the carved dark register
// (#1b1a17 ground, warm-ivory ink) reads muddy from across a live room, so
// THIS SURFACE ONLY runs true black + white — ground, grid lines and dates.
// The status cards keep their carved alpha fills untouched (FILL/INK below).
// The app itself stays on carved; do not copy these values anywhere else.
const BG = '#000000'
const FG = '#ffffff'
const WASH = 'rgba(255,255,255,.16)'   // grid lines / rails — brighter than app
const WASH2 = 'rgba(255,255,255,.30)'  // heavy ticks / week boundaries
const INK = '#1c2626'         // --c-chip-ink, text ON status fills
const HOT = '#ff5a4d'         // --c-st-hot
const HOT_TEXT = '#fff4f2'    // --c-hot-text

// Dark register: chips are ALPHA fills so they sit in the room (§6), not the
// full-brightness light-mode values. Copied from the
// ':root:not([data-theme="light"]) .c-ev.c-fill-*' rules.
const FILL: Record<string, string> = {
  booked: 'rgba(67,223,174,.72)',
  warm: 'rgba(255,169,77,.68)',
  uncon: 'rgba(127,178,229,.68)',
  tech: 'rgba(181,163,239,.62)',
  dead: 'rgba(204,209,207,.5)',
  hot: 'rgba(255,90,77,.7)',
  cold: 'rgba(95,201,232,.68)',
}

// STATUS_ALIASES, components/carved/index.tsx — booking status -> carved slot.
const SLOT: Record<string, string> = {
  confirmed: 'booked', tentative: 'warm', cancelled: 'hot',
  tour: 'uncon', tech: 'tech', open_hours: 'dead', lockout: 'booked',
}

// Tour/Tech/Open Hours are BLOCK events: no work order, nothing to collect, so
// they must never show a payment element (SessionCard.tsx).
// lockout joins the no-payment list ONLY for the wall: a rent-only monthly
// lockout occupies the room ("Lockout · Hiker", Eli 2026-08-26) but a COD
// strip on it would tell a runner to collect money nobody collects at a desk.
const BLOCKS = ['tour', 'tech', 'open_hours', 'lockout']

const MIN_ROW_H = 116   // ~8 rows fill 1080p; content grows a row past this
const WEEKS = 10        // render past the month end and let the panel clip

type B = Record<string, any>

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Deliberate page-local copy: lib/format.ts's header records that the calendar
// chip's compact "8P" formatter is intentionally page-local. Matches
// fmtCardTime in carved's SessionCard.tsx byte for byte.
function fmtTime(t: string): string {
  if (!t) return ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!m) return t
  let h = parseInt(m[1])
  const min = m[2]
  const ap = m[3]?.toUpperCase()
  if (ap) return `${h}${min !== '00' ? ':' + min : ''}${ap === 'AM' ? 'A' : 'P'}`
  const suf = h >= 12 ? 'P' : 'A'
  if (h > 12) h -= 12
  if (h === 0) h = 12
  return `${h}${min !== '00' ? ':' + min : ''}${suf}`
}

function initials(name: string | null): string {
  if (!name?.trim()) return ''
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

// SYSTEM FONTS ONLY — no webfont link. This page used to pull Archivo Black and
// DM Mono from fonts.googleapis.com, and that turned the Encore B panel white
// (2026-08-19): a <link rel="stylesheet"> is RENDER-BLOCKING, and an Android 4.4
// device cannot reliably complete TLS to Google's font CDN — same class of
// certificate problem that needed ISRG Root X1 installed by hand. The browser
// sat waiting on a stylesheet that never arrived and painted nothing.
//
// A wall display must have ZERO render-blocking external requests. Arial Black
// is the same kind of heavy grotesque as Archivo Black and ships with the
// device. If the real faces are ever wanted here, self-host them and load them
// with font-display:swap so a failed fetch can never block the paint again.
const ARCHIVO = "'Arial Black','Helvetica Neue',Helvetica,Arial,sans-serif"
const MONO = "'Courier New',Courier,monospace"

/** The §10b payload: Archivo name, client line, mono times. */
function payload(b: B, ink: string, big: boolean) {
  const isBilling = b.payment_type === 'billing'
  // Billing leads with the artist; COD leads with who's paying.
  const name = isBilling
    ? (b.artist || b.label || b.client_name || '')
    : (b.client_name || '')
  const labelLine = isBilling && b.label && b.label !== name ? b.label : ''
  const time = b.from_time && b.to_time
    ? `${fmtTime(b.from_time)}–${fmtTime(b.to_time)}`
    : b.from_time ? fmtTime(b.from_time) : ''
  // The accent border on non-recording types is retired (§12); it returns as a tag.
  const tag = b.session_type === 'filming' ? 'FILM'
    : b.session_type === 'event_playback' ? 'EVENT' : ''
  const strike = b.status === 'cancelled' ? 'text-decoration:line-through;' : ''

  let out = `<div style="padding:4px 10px 3px;overflow:hidden">`
    + `<div style="font-family:${ARCHIVO};font-size:${big ? 22 : 17}px;line-height:1.3;color:${ink};`
    + `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${strike}">${esc(name)}</div>`
  if (labelLine) {
    out += `<div style="font-size:15px;font-weight:700;opacity:.85;line-height:1.2;color:${ink};`
      + `white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(labelLine)}</div>`
  }
  if (time) {
    out += `<div style="font-family:${MONO};font-size:15px;font-weight:500;opacity:.85;line-height:1.25;`
      + `color:${ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">`
      + `${esc(time)}${tag ? '  ' + esc(tag) : ''}</div>`
  }
  return out + `</div>`
}

/** Full card — one day, full §10b anatomy: payload, footer band, COD strip. */
function card(b: B): string {
  const slot = SLOT[b.status] ?? 'dead'
  const cancelled = b.status === 'cancelled'
  const ink = cancelled ? HOT_TEXT : INK
  const isBilling = b.payment_type === 'billing'
  const showPayment = !BLOCKS.includes(b.status ?? '') && !isBilling
  const cod = b.cod_method === 'Credit Card' ? 'CC' : String(b.cod_method ?? '').toUpperCase()
  const inv = b.invoice_num ? `#${b.invoice_num}` : ''
  const staff = [
    b.engineer_name && `1ST-${initials(b.engineer_name)}`,
    b.assistant_name && `2ND-${initials(b.assistant_name)}`,
  ].filter(Boolean).join(' · ')

  let out = `<div style="background:${FILL[slot]};border-radius:14px;overflow:hidden;margin-bottom:5px">`
  out += payload(b, ink, true)
  // The footer is a SHADE of the chip, not a second surface (§10b) — rgba black
  // over the fill works against every status without a per-status variant.
  if (inv || staff) {
    out += `<div style="background:rgba(0,0,0,.3);padding:2px 10px;font-size:13px;font-weight:800;`
      + `line-height:1.35;color:${ink};white-space:nowrap;overflow:hidden">`
      + `<span>${esc(inv)}</span>`
      + `<span style="float:right">${esc(staff)}</span>`
      + `<div style="clear:both"></div></div>`
  }
  // Billing renders NOTHING — silence is the billing signal (§10b).
  if (showPayment) {
    out += `<div style="background:${HOT};color:${HOT_TEXT};padding:1px 10px;font-size:13px;`
      + `font-weight:800;letter-spacing:.07em;line-height:1.35;text-align:center;`
      + `white-space:nowrap;overflow:hidden">${cod ? 'COD ' + esc(cod) : 'COD'}</div>`
  }
  return out + `</div>`
}

/** Multi-day — ONE compact line per day it covers, never a stacked card and
 *  never a bar spanning columns. Eli's rule: multi-day truncates so it cannot
 *  widen a row. ‹ means it started earlier, › that it continues. */
function spanBar(b: B, day: string): string {
  const slot = SLOT[b.status] ?? 'dead'
  const cancelled = b.status === 'cancelled'
  const ink = cancelled ? HOT_TEXT : INK
  const isBilling = b.payment_type === 'billing'
  const name = isBilling
    ? (b.artist || b.label || b.client_name || '')
    : (b.client_name || '')
  const lead = b.start_date < day ? '‹ ' : ''
  const tail = b.end_date > day ? ' ›' : ''
  const strike = cancelled ? 'text-decoration:line-through;' : ''
  return `<div style="background:${FILL[slot]};border-radius:14px;padding:3px 10px;margin-bottom:4px;`
    + `font-family:${ARCHIVO};font-size:15px;line-height:1.3;color:${ink};`
    + `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${strike}">`
    + `${esc(lead + name + tail)}</div>`
}

/** Change detection. The wall must update within seconds of a booking edit,
 *  and Chromium 30 has no fetch, no Promise and no supabase-js — but it does
 *  have XMLHttpRequest (and has since 2006). So: this page embeds a hash of
 *  exactly what it rendered, and a ten-line ES3 loop asks the same route for
 *  the current hash every POLL_MS. Different hash -> location.reload().
 *
 *  Hashing the rendered rows rather than trusting bookings.updated_at is
 *  deliberate: a timestamp column only works if every write path maintains it,
 *  and the WO save goes through atomic RPCs. A hash of the payload cannot be
 *  wrong — if anything on screen would differ, the hash differs.
 *
 *  The meta refresh stays as a backstop at 15 minutes. If the script ever dies
 *  the wall still heals itself; it just does so slowly. */
// 5000 → 30000 → 60000 (Eli, 2026-09-03). Every poll routes through the
// WordPress host (the plugin proxy — see docs/TV-DISPLAY-BRIEF.md), and its
// Varnish layer rate-limits by IP: panels at 5s from one building tripped
// "429 Too Many Requests", which Varnish serves BEFORE the plugin runs — so
// the self-healing Reconnecting page never got a chance. 30s still 429'd
// (panels running the old 5s bundle kept the throttle hot), so one minute it
// is. A booking change reaches the wall within a minute — fine for a wall.
// The durable fix is Pixelgate whitelisting the studio IPs.
const POLL_MS = 60000

function poller(hash: string, _probeUrl: string): string {
  // The probe URL is built from location at runtime, not baked in, so the page
  // still polls correctly when it is served through a proxy on another host.
  // These panels cannot complete TLS to Vercel (no Let's Encrypt root, and the
  // HTML5 Browser ignores user-installed CAs — 2026-08-19), so the wall reaches
  // this page via the WordPress host it already trusts. A hardcoded /display/...
  // path would 404 against that origin.
  return `<script>(function(){`
    + `var v=${JSON.stringify(hash)};`
    + `var u=location.pathname+location.search+(location.search?"&":"?")+"probe=1";`
    + `function c(){try{var x=new XMLHttpRequest();`
    + `x.open("GET",u+"&t="+(new Date()).getTime(),true);`
    + `x.onreadystatechange=function(){if(x.readyState===4&&x.status===200){`
    + `if(x.responseText&&x.responseText!==v){location.reload();}}};`
    + `x.send();}catch(e){}}`
    + `setInterval(c,${POLL_MS});})();</script>`
}

function page(title: string, body: string, tail = ''): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">`
    // 900 → 3600 (2026-09-03). This watchdog reload is a FULL page load through
    // the WordPress host, and it's the death path: probes that hit Varnish's
    // 429 are ignored harmlessly (the poller requires status 200), but if THIS
    // reload lands on a throttled moment the panel is left on Varnish's error
    // page, which has no self-recovery. One risky load per hour, not four.
    + `<meta http-equiv="refresh" content="3600">`
    + `<title>${esc(title)}</title>`
    + `<style>`
    + `html,body{margin:0;padding:0;background:${BG};color:${FG};`
    + `font-family:Helvetica,Arial,sans-serif;overflow:hidden;cursor:none}`
    + `table{border-collapse:collapse;width:100%;table-layout:fixed}`
    + `td{vertical-align:top;overflow:hidden}`
    + `</style></head><body>${body}${tail}</body></html>`
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ room: string }> }) {
  const { room: slug } = await ctx.params
  const room = findDisplayRoom(slug)
  const html = (s: string, code = 200) =>
    new Response(s, { status: code, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })

  // Optional gate. Unset = open, so a screen never goes dark because an env var
  // was missed; set DISPLAY_KEY in Vercel to require ?k= on every panel.
  const key = process.env.DISPLAY_KEY
  if (key && req.nextUrl.searchParams.get('k') !== key) {
    return html(page('Display', `<div style="padding:40px;font-size:20px;color:${FG}">Not authorised.</div>`), 401)
  }
  if (!room) {
    return html(page('Display', `<div style="padding:40px;font-size:20px;color:${FG}">Unknown room "${esc(slug)}".</div>`), 404)
  }

  // ?diag=1 — the bisection page. Barest possible HTML: no script, no external
  // request, no database, one table, inline styles only. Added 2026-08-19 after
  // the Encore B panel kept painting white while the same URL rendered
  // correctly in every other browser, and guessing at which CSS feature
  // Chromium 30 choked on was not converging.
  //   Renders  -> HTML delivery, inline CSS and tables are all fine, so the
  //               fault is something specific in the full page.
  //   White    -> the panel is not receiving this route at all (wrong URL in
  //               the Web URL field, cache, TLS, or the app itself).
  if (req.nextUrl.searchParams.get('diag')) {
    return html(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>diag</title></head>'
      + `<body style="background:${BG};color:${FG};font-family:Helvetica,Arial,sans-serif;margin:0">`
      + `<div style="padding:30px 40px 0;font-size:64px">DISPLAY OK</div>`
      + `<div style="padding:6px 40px 24px;font-size:30px">${esc(room.label)} — ${esc(new Date().toISOString())}</div>`
      + `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:30px">`
      + `<tr><td style="border:1px solid ${FG};padding:10px">Sun</td>`
      + `<td style="border:1px solid ${FG};padding:10px">Mon</td>`
      + `<td style="border:1px solid ${FG};padding:10px">Tue</td></tr>`
      + `<tr><td style="border:1px solid ${FG};height:140px;padding:10px;vertical-align:top">1`
      + `<div style="background:rgba(67,223,174,.72);color:#1c2626;border-radius:14px;padding:8px 12px;margin-top:8px">Card test</div>`
      + `</td><td style="border:1px solid ${FG};padding:10px">2</td>`
      + `<td style="border:1px solid ${FG};padding:10px">3</td></tr></table>`
      + '</body></html>'
    )
  }

  const now = new Date()
  // Anchor on the week containing the 1st, then keep rendering past the month
  // end — the wall should use every row the panel can show, not stop at the 31st.
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const gridStart = new Date(first)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())
  const gridEnd = new Date(gridStart)
  gridEnd.setDate(gridEnd.getDate() + WEEKS * 7 - 1)

  const { data, error } = await supabaseAdmin
    .from('bookings').select(COLS)
    .eq('location', room.location).eq('studio', room.studio)
    .lte('start_date', fmtDate(gridEnd)).gte('end_date', fmtDate(gridStart))

  const bookings: B[] = data ?? []

  // Stable ordering first, or an arbitrary row order from Postgres would change
  // the hash on its own and reload the wall every few seconds for no reason.
  bookings.sort((a, b) => String(a.id).localeCompare(String(b.id)))

  // An outage gets a CONSTANT hash, not an error page hashed as content. The
  // error page embeds this same value, so a wall that loses the database sits
  // quietly on its message instead of reloading every POLL_MS for hours — and
  // the moment data returns the hash changes and it heals itself.
  const hash = error
    ? 'unavailable'
    : createHash('sha1').update(JSON.stringify(bookings)).digest('hex').slice(0, 16)

  // The probe: same query, no HTML. Answered before anything is rendered, so a
  // check costs one query and 16 bytes rather than a full page build. Must sit
  // ahead of the error branch or an outage would answer probes with HTML.
  if (req.nextUrl.searchParams.get('probe')) {
    return new Response(hash, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const probeUrl = req.nextUrl.pathname + (key ? `?k=${encodeURIComponent(key)}&probe=1` : '?probe=1')

  // A wall that goes blank is worse than a wall that says why.
  if (error) {
    return html(page(
      room.label,
      `<div style="padding:40px;font-size:20px;color:${HOT}">Data unavailable. Retrying.</div>`,
      poller(hash, probeUrl),
    ))
  }

  const todayStr = fmtDate(now)
  const monthNow = now.getMonth()

  let rows = ''
  for (let w = 0; w < WEEKS; w++) {
    rows += '<tr>'
    for (let d = 0; d < 7; d++) {
      const cell = new Date(gridStart)
      cell.setDate(cell.getDate() + w * 7 + d)
      const ds = fmtDate(cell)
      const isToday = ds === todayStr
      const inMonth = cell.getMonth() === monthNow

      const todays = bookings
        .filter(b => b.start_date <= ds && b.end_date >= ds)
        .sort((a, b) => timeToMins(a.from_time) - timeToMins(b.from_time))

      // No accent exists (§12), so "today" is a monochrome inversion: ivory
      // disc, background-coloured numeral.
      let inner = `<div style="width:26px;height:26px;border-radius:50%;margin-bottom:3px;`
        + `text-align:center;line-height:26px;font-size:17px;`
        + (isToday ? `background:${FG};color:${BG};font-weight:700`
                   : `color:${FG};opacity:${inMonth ? '.6' : '.28'}`)
        + `">${cell.getDate()}</div>`

      for (const b of todays) inner += b.start_date === b.end_date ? card(b) : spanBar(b, ds)

      rows += `<td style="height:${MIN_ROW_H}px;padding:5px 6px;`
        + `border-right:1px solid ${WASH};border-bottom:1px solid ${WASH};`
        + (isToday ? `background:${WASH2}` : inMonth ? '' : `background:rgba(0,0,0,.18)`)
        + `">${inner}</td>`
    }
    rows += '</tr>'
  }

  const head = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d =>
    `<td style="text-align:center;padding:5px 0;font-size:16px;color:${FG};opacity:.45;`
    + `letter-spacing:0.05em;text-transform:uppercase">${d}</td>`
  ).join('')

  // The clock is load-bearing: a frozen page is only obvious if it shows a time.
  const stamp = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })

  const body =
    `<div style="padding:12px 18px 8px;border-bottom:1px solid ${WASH};overflow:hidden">`
    + `<span style="font-family:${ARCHIVO};font-size:30px;color:${FG};text-transform:uppercase">${esc(room.location)} ${esc(room.studio)}</span>`
    + `<span style="font-size:26px;color:${FG};opacity:.6;margin-left:14px">${esc(now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</span>`
    + `<span style="float:right;font-family:${MONO};font-size:18px;color:${FG};opacity:.45;margin-top:12px">${esc(stamp)}</span>`
    + `</div>`
    + `<table><tr>${head}</tr>${rows}</table>`

  return html(page(room.label, body, poller(hash, probeUrl)))
}
