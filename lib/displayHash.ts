// THE WALL HASH — one function, two callers (2026-11-11).
//
// A TV wall reloads when the hash of what it shows changes. The per-room
// page (app/display/[room]/route.ts) embeds this hash; the shared probe
// (app/display/probe/route.ts) answers every room's hash in one call so the
// building's proxy can serve eleven panels from one request instead of
// forwarding eleven. The two MUST compute the same bytes for the same data,
// or a wall would reload forever — so they share this, and the query columns
// (DISPLAY_COLS, DISPLAY_ST_COLS) live here too.
//
// Whitelisted columns only: no rates beyond the rate code's inputs, no notes.
import { createHash } from 'crypto'

export const DISPLAY_COLS =
  'id,location,studio,start_date,end_date,from_time,to_time,status,session_type,' +
  'payment_type,cod_method,artist,label,client_name,engineer_name,assistant_name,invoice_num,' +
  'work_order_id'

export const DISPLAY_ST_COLS =
  'work_order_id,date,studio,from_time,to_time,times_tbd,eng_name,eng_role,eng_visible,rate,row_rate_type'

/** The grid window every wall shows, anchored on LA's today. Same maths as
 *  the room route (PAST_WEEKS 3, 6 weeks). */
export const DISPLAY_PAST_WEEKS = 3
export const DISPLAY_WEEKS = 6

export function displayWindow(): { gridStart: Date; gridEnd: Date } {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const gridStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  gridStart.setDate(gridStart.getDate() - gridStart.getDay() - DISPLAY_PAST_WEEKS * 7)
  const gridEnd = new Date(gridStart)
  gridEnd.setDate(gridEnd.getDate() + DISPLAY_WEEKS * 7 - 1)
  return { gridStart, gridEnd }
}

export function fmtDisplayDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Row = Record<string, any>

/** Stable order, or an arbitrary row order from Postgres would change the
 *  hash on its own and reload the wall for no reason. Sorts IN PLACE. */
export function sortForHash(bookings: Row[], stRows: Row[]): void {
  bookings.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  stRows.sort((a, b) => `${a.work_order_id}|${a.date}|${a.studio}|${a.eng_role}|${a.eng_name}`
    .localeCompare(`${b.work_order_id}|${b.date}|${b.studio}|${b.eng_role}|${b.eng_name}`))
}

/** An outage gets a CONSTANT hash, not an error page hashed as content. */
export const UNAVAILABLE_HASH = 'unavailable'

export function displayHash(bookings: Row[], stRows: Row[]): string {
  return createHash('sha1').update(JSON.stringify([bookings, stRows])).digest('hex').slice(0, 16)
}
