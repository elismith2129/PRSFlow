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

// carved tokens, dark register (styles/globals.css §3)
const BG = '#1b1a17'          // --c-bg
const FG = '#d9d6cd'          // --c-fg, warm ivory — NOT white
const WASH = 'rgba(217,214,205,.07)'   // --c-wash
const WASH2 = 'rgba(217,214,205,.13)'  // --c-wash2
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
  tour: 'uncon', tech: 'tech', open_hours: 'dead',
}

// Tour/Tech/Open Hours are BLOCK events: no work order, nothing to collect, so
// they must never show a payment element (SessionCard.tsx).
const BLOCKS = ['tour', 'tech', 'open_hours']

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

const ARCHIVO = "'Archivo Black','Arial Black',Helvetica,sans-serif"
const MONO = "'DM Mono',ui-monospace,'Courier New',monospace"

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

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="refresh" content="120">`
    + `<title>${esc(title)}</title>`
    + `<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">`
    + `<style>`
    + `html,body{margin:0;padding:0;background:${BG};color:${FG};`
    + `font-family:Inter,Helvetica,Arial,sans-serif;overflow:hidden;cursor:none}`
    + `table{border-collapse:collapse;width:100%;table-layout:fixed}`
    + `td{vertical-align:top;overflow:hidden}`
    + `</style></head><body>${body}</body></html>`
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

  // A wall that goes blank is worse than a wall that says why.
  if (error) {
    return html(page(room.label, `<div style="padding:40px;font-size:20px;color:${HOT}">Data unavailable. Retrying.</div>`))
  }

  const bookings: B[] = data ?? []
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

  return html(page(room.label, body))
}
