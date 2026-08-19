// TV wall calendars — /display/[room]  (e.g. /display/ers-b)
//
// WHY THIS IS A ROUTE HANDLER AND NOT A PAGE
// The screens are Sharp PN-B401 signage panels running Android 4.4.2, whose
// WebView is Chromium 30 (2013). It has NO CSS custom properties (needs 49),
// NO CSS Grid (57), NO ES6 (49), NO fetch (42), NO Promise (32). A React page
// renders a blank screen there — confirmed on the Encore B panel, 2026-08-19.
// So this route emits hand-written HTML with a <table> grid and literal hex,
// and refreshes itself with <meta http-equiv="refresh">. Zero client JS: it
// cannot leak memory, cannot drop a socket, and survives a browser from 2013.
// (Those panels also needed ISRG Root X1 installed by hand before they would
// complete a TLS handshake with Vercel — see docs/TV-DISPLAY-BRIEF.md.)
//
// The colour + card anatomy below is copied from StudioMonthView in
// app/(main)/calendar/page.tsx — same status colours, same field order, same
// 1ST-/2ND- staff tags. The values are literal because var() does not exist on
// the target; if the tokens in styles/globals.css move, move them here too.
//
// fmtTime/initials are deliberate page-local copies: lib/format.ts's header
// records that the calendar chip's compact "8P" formatter is intentionally
// page-local and stays where it is. This is another such surface.
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timeToMins } from '@/lib/time'
import { findDisplayRoom } from '@/lib/displayRooms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SERVER-ONLY service-role client. RLS blocks anon reads (July 2 / Aug 14) and
// a signage browser cannot hold a login across reboots, so the wall is served
// by the server with an explicit column whitelist instead. Rates, notes, phone
// numbers and contact details never leave this process.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const COLS =
  'id,location,studio,start_date,end_date,from_time,to_time,status,session_type,' +
  'payment_type,cod_method,artist,label,client_name,engineer_name,assistant_name,invoice_num'

// styles/globals.css dark tokens, resolved. See file header.
const C = {
  bg: '#0d0f14', surface: '#161920', border: '#2a2e3d',
  text: '#e8eaf2', text2: '#8b90a8', text3: '#4a4f64',
  accent: '#c8f04e', cold: '#6B7280', cod: '#f87171',
}

// STATUS_TOP_COLORS, calendar/page.tsx
const STATUS: Record<string, string> = {
  confirmed: '#14B8A6', tentative: '#F97316', cancelled: '#EF4444',
  tour: '#a855f7', tech: '#6B7280', open_hours: '#e2e8f0',
}

const MIN_ROW_H = 116   // ~8 rows fill 1080p; content grows a row past this
const WEEKS = 10        // render past the month end and let the screen clip

type B = Record<string, any>

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

function chipBorders(top: string, isBlockType: boolean): string {
  const glow = top === '#F97316' ? 'rgba(249,115,22,0.4)'
    : top === '#14B8A6' ? 'rgba(20,184,166,0.4)' : 'rgba(255,255,255,0.08)'
  const side = isBlockType ? '2px solid rgba(200,240,78,0.7)' : `1px solid ${glow}`
  return `border-left:${side};border-right:${side};border-bottom:${side};`
}

/** Full card — a session that lives on one day. */
function card(b: B): string {
  const top = STATUS[b.status] ?? STATUS.confirmed
  const isBilling = b.payment_type === 'billing'
  const name = isBilling
    ? (b.artist && b.label ? `${b.label} / ${b.artist}` : b.artist || b.label || b.client_name || '')
    : (b.client_name || '')
  const time = b.from_time && b.to_time
    ? `${fmtTime(b.from_time)}–${fmtTime(b.to_time)}`
    : b.from_time ? fmtTime(b.from_time) : ''
  const cod = !isBilling && b.cod_method
    ? (b.cod_method === 'Credit Card' ? 'CC' : String(b.cod_method).toUpperCase()) : ''
  const eng = b.engineer_name ? `1ST-${initials(b.engineer_name)}` : ''
  const asst = b.assistant_name ? `2ND-${initials(b.assistant_name)}` : ''
  const inv = b.invoice_num ? `#${b.invoice_num}` : ''
  // §5: a cancelled session is the hot fill plus a struck title.
  const strike = b.status === 'cancelled' ? 'text-decoration:line-through;' : ''

  let out = `<div style="background:${C.bg};border-top:4px solid ${top};`
    + chipBorders(top, b.session_type !== 'recording')
    + `border-radius:3px;padding:6px 9px;margin-bottom:5px;overflow:hidden">`
  out += `<div style="font-size:19px;font-weight:700;color:${C.text};line-height:1.25;word-break:break-word;${strike}">${esc(name)}</div>`
  if (time) out += `<div style="font-size:15px;color:${C.cold};margin-top:2px">${esc(time)}</div>`
  if (inv || eng || asst) {
    out += `<div style="margin-top:4px"><span style="font-size:13px;color:${C.text2}">${esc(inv)}</span>`
      + `<span style="float:right;font-size:13px;color:${C.cold}">${esc([eng, asst].filter(Boolean).join(' '))}</span>`
      + `<div style="clear:both"></div></div>`
  }
  if (cod) out += `<div style="font-size:13px;font-weight:700;color:${C.cod};margin-top:2px">COD ${esc(cod)}</div>`
  return out + `</div>`
}

/** Multi-day session — ONE compact line per day it covers, never a stacked
 *  card and never a bar that spans columns. Eli's rule: multi-day truncates so
 *  it cannot widen the rows. ‹ means it started earlier, › that it continues. */
function spanBar(b: B, day: string): string {
  const top = STATUS[b.status] ?? STATUS.confirmed
  const isBilling = b.payment_type === 'billing'
  const name = isBilling
    ? (b.artist && b.label ? `${b.label} / ${b.artist}` : b.artist || b.label || b.client_name || '')
    : (b.client_name || '')
  const lead = b.start_date < day ? '‹ ' : ''
  const tail = b.end_date > day ? ' ›' : ''
  const strike = b.status === 'cancelled' ? 'text-decoration:line-through;' : ''
  return `<div style="background:${C.bg};border-left:5px solid ${top};`
    + `border-top:1px solid rgba(255,255,255,0.08);border-right:1px solid rgba(255,255,255,0.08);`
    + `border-bottom:1px solid rgba(255,255,255,0.08);border-radius:0;padding:3px 8px;margin-bottom:4px;`
    + `font-size:15px;font-weight:700;color:${C.text};white-space:nowrap;overflow:hidden;`
    + `text-overflow:ellipsis;${strike}">${esc(lead + name + tail)}</div>`
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="refresh" content="120">`
    + `<title>${esc(title)}</title>`
    + `<style>`
    + `html,body{margin:0;padding:0;background:${C.bg};color:${C.text};`
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
    return html(page('Display', `<div style="padding:40px;font-size:20px;color:${C.text2}">Not authorised.</div>`), 401)
  }

  if (!room) {
    return html(page('Display', `<div style="padding:40px;font-size:20px;color:${C.text2}">Unknown room "${esc(slug)}".</div>`), 404)
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
    return html(page(room.label, `<div style="padding:40px;font-size:20px;color:${C.cod}">Data unavailable. Retrying.</div>`), 200)
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

      let inner = `<div style="width:26px;height:26px;border-radius:50%;margin-bottom:3px;`
        + `text-align:center;line-height:26px;font-size:17px;`
        + (isToday
            ? `background:${C.accent};color:${C.bg};font-weight:700`
            : `color:${inMonth ? C.text2 : C.text3}`)
        + `">${cell.getDate()}</div>`

      for (const b of todays) inner += b.start_date === b.end_date ? card(b) : spanBar(b, ds)

      rows += `<td style="height:${MIN_ROW_H}px;padding:5px 6px;`
        + `border-right:1px solid rgba(255,255,255,0.05);border-bottom:1px solid rgba(255,255,255,0.05);`
        + (isToday ? `background:rgba(200,240,78,0.04)` : inMonth ? '' : `background:rgba(0,0,0,0.18)`)
        + `">${inner}</td>`
    }
    rows += '</tr>'
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const head = days.map(d =>
    `<td style="text-align:center;padding:5px 0;font-size:16px;color:${C.text3};letter-spacing:0.05em;text-transform:uppercase">${d}</td>`
  ).join('')

  // The clock is load-bearing: a frozen page is only obvious if it shows a time.
  const stamp = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })

  const body =
    `<div style="padding:12px 18px 8px;border-bottom:1px solid ${C.border};overflow:hidden">`
    + `<span style="font-size:30px;font-weight:700;color:${C.accent};text-transform:uppercase">${esc(room.location)} ${esc(room.studio)}</span>`
    + `<span style="font-size:26px;color:${C.text};margin-left:14px">${esc(now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</span>`
    + `<span style="float:right;font-size:18px;color:${C.text3};margin-top:12px">${esc(stamp)}</span>`
    + `</div>`
    + `<table><tr>${head}</tr>${rows}</table>`

  return html(page(room.label, body))
}
