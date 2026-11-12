// THE SHARED PROBE (Eli, 2026-11-11 — docs/TODO.md "TV walls: one shared
// probe instead of eleven"). Every room's wall hash in one call, as JSON:
//   { "prs-a": "3f0c…", "prs-b": "…", … , "_at": "2026-11-11T01:02:03Z" }
//
// Each building's display proxy (scripts/display-proxy.mjs) fetches this
// every ten seconds and answers its panels' ?probe=1 from memory, so Vercel
// sees one call per building per 10s instead of one per panel per 15s. The
// per-room route still answers ?probe=1 itself for a panel that is pointed
// straight at Vercel, and the hash it embeds is computed by the same function
// (lib/displayHash) — identical bytes, or a wall would reload forever.
//
// Two queries, all rooms: bookings in the window, then the day rows for every
// WO on any wall. Then the per-room split is done here, in memory.
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DISPLAY_ROOMS } from '@/lib/displayRooms'
import { DISPLAY_COLS, DISPLAY_ST_COLS, UNAVAILABLE_HASH, displayHash, displayWindow, fmtDisplayDate, sortForHash } from '@/lib/displayHash'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export async function GET(req: NextRequest) {
  const key = process.env.DISPLAY_KEY
  if (key && req.nextUrl.searchParams.get('k') !== key) {
    return new Response('Not authorised.', { status: 401, headers: { 'cache-control': 'no-store' } })
  }
  const { gridStart, gridEnd } = displayWindow()
  const out: Record<string, string> = {}

  const { data, error } = await supabaseAdmin
    .from('bookings').select(DISPLAY_COLS)
    .lte('start_date', fmtDisplayDate(gridEnd)).gte('end_date', fmtDisplayDate(gridStart))
  const all: Record<string, any>[] = data ?? []
  const woIds = Array.from(new Set(all.map(b => b.work_order_id).filter(Boolean)))
  let st: Record<string, any>[] = []
  let stError: unknown = null
  if (!error && woIds.length) {
    const r = await supabaseAdmin.from('studio_time_rows').select(DISPLAY_ST_COLS).in('work_order_id', woIds)
    st = r.data ?? []
    stError = r.error
  }

  for (const room of DISPLAY_ROOMS) {
    if (error || stError) { out[room.slug] = UNAVAILABLE_HASH; continue }
    const bookings = all.filter(b => b.location === room.location && b.studio === room.studio)
    const ids = new Set(bookings.map(b => b.work_order_id).filter(Boolean))
    const rows = st.filter(r => ids.has(r.work_order_id))
    sortForHash(bookings, rows)
    out[room.slug] = displayHash(bookings, rows)
  }
  out._at = new Date().toISOString()
  return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
