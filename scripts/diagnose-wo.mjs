#!/usr/bin/env node
// Diagnose a work order's booking-card projection.  READ-ONLY — writes nothing.
//
//   node scripts/diagnose-wo.mjs 1140
//
// WHY THIS EXISTS (2026-09-08): WO 1140 had studio time in more than one room
// but only showed on the calendar in Studio C. Reading the code could not
// settle whether the projection built one segment or the save never ran, and a
// sandboxed session cannot reach Supabase. This prints the three things that
// decide it, side by side:
//
//   1. the studio_time_rows as they actually are in the database
//   2. the booking cards that actually exist for the WO
//   3. what buildBookingProjection WOULD produce from those rows right now
//
// If (3) shows more segments than (2) shows cards, the rows are fine and the
// save/projection is at fault. If (3) shows ONE segment, the rows are the
// problem — a missing date or a blank room silently drops out of the grid.
//
// ⚠ The segment logic below MIRRORS buildBookingProjection in
// components/calendar/WorkOrderPopup.tsx. It is a copy on purpose (a script
// cannot import a React component), so if that function's grouping rules
// change, change them here too or this tool will start lying.

import fs from 'fs'
import path from 'path'

const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const envPath = path.join(root, '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('No .env.local found at ' + envPath)
  process.exit(1)
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const woArg = process.argv[2]
if (!woArg) {
  console.error('Usage: node scripts/diagnose-wo.mjs <wo number, e.g. 1140>')
  process.exit(1)
}

const get = async (p) => {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

// ── Same next-day test the projection uses (lib/time.ts isNextDay) ───────────
const isNextDay = (a, b) => {
  if (!a || !b) return false
  const d = new Date(a + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10) === b
}

const run = async () => {
  const woCols = 'id,wo_number,invoice_number,booking_id,session_status,client,artist,status,updated_at'

  // wo_number is TEXT shaped 'WO-1140' (migration 20260721120000: default
  // 'WO-' || nextval). Accept whatever the user types — 1140, WO-1140, wo-1140
  // — and try the invoice number too, which is a different sequence entirely.
  const digits = String(woArg).replace(/\D/g, '')
  const tries = [
    ['wo_number', `WO-${digits}`],
    ['wo_number', woArg],
    ['invoice_number', digits],
    ['invoice_number', woArg],
  ]
  let wos = []
  for (const [col, val] of tries) {
    if (!val) continue
    wos = await get(`work_orders?${col}=eq.${encodeURIComponent(val)}&select=${woCols}`)
    if (wos.length) { console.log(`(matched on ${col} = "${val}")`); break }
  }
  if (!wos.length) {
    console.log(`No work order matches "${woArg}" as a WO number or invoice number.`)
    const near = await get(`work_orders?select=wo_number,invoice_number,client,artist&order=created_at.desc&limit=15`)
    console.log('\nMost recent work orders, in case the number is off:')
    for (const w of near) {
      console.log(`   ${String(w.wo_number).padEnd(10)} invoice ${String(w.invoice_number || '—').padEnd(8)} ${w.artist || w.client || ''}`)
    }
    return
  }

  for (const wo of wos) {
    console.log('═'.repeat(72))
    console.log(`WO ${wo.wo_number}  (invoice ${wo.invoice_number || '—'})  ${wo.artist || wo.client || ''}`)
    console.log(`  id ${wo.id}`)
    console.log(`  session_status=${wo.session_status}  wo status=${wo.status}  last saved ${wo.updated_at}`)

    const st = await get(`studio_time_rows?work_order_id=eq.${wo.id}` +
      `&select=id,date,studio,location,from_time,to_time,eng_name,eng_role,sort_order&order=sort_order`)
    console.log(`\n─ studio_time_rows (${st.length}) ` + '─'.repeat(40))
    for (const r of st) {
      const flag = !r.date ? '  ⚠ NO DATE — dropped from the projection'
        : !r.studio ? '  · no room (staff-only row, expected)' : ''
      console.log(`   date=${(r.date || '—').padEnd(12)} room=${JSON.stringify(r.studio || '')
        .padEnd(12)} loc=${(r.location || '—').padEnd(12)} ${r.from_time || '—'}–${r.to_time || '—'}${flag}`)
    }

    const bk = await get(`bookings?work_order_id=eq.${wo.id}` +
      `&select=id,location,studio,start_date,end_date,from_time,to_time,status&order=start_date`)
    console.log(`\n─ booking cards that EXIST (${bk.length}) ` + '─'.repeat(30))
    for (const b of bk) {
      console.log(`   ${(b.location || '—').padEnd(12)} ${(b.studio || '—').padEnd(12)} ` +
        `${b.start_date} → ${b.end_date}  ${b.status}` + (b.id === wo.booking_id ? '   [PRIMARY]' : ''))
    }

    // ── Replay the projection over the live rows ──────────────────────────────
    const venue = bk.find(b => b.id === wo.booking_id)?.location || bk[0]?.location || ''
    const dated = st.filter(r => r.date && r.studio).sort((a, b) => a.date.localeCompare(b.date))
    const segs = []
    for (const r of dated) {
      const last = segs[segs.length - 1]
      const rLoc = r.location || venue
      if (last && last.studio === r.studio && last.location === rLoc && isNextDay(last.end, r.date)) last.end = r.date
      else segs.push({ studio: r.studio, location: rLoc, start: r.date, end: r.date })
    }
    console.log(`\n─ cards the projection WOULD build (${segs.length}) ` + '─'.repeat(24))
    segs.forEach((s, i) => console.log(`   ${(s.location || '—').padEnd(12)} ${String(s.studio).padEnd(12)} ` +
      `${s.start} → ${s.end}   ${i === 0 ? '[primary]' : '[secondary]'}`))

    console.log('\n─ VERDICT ' + '─'.repeat(60))
    const dropped = st.filter(r => !r.date && r.studio).length
    if (segs.length > bk.length) {
      console.log(`   ✗ ${segs.length} segments but only ${bk.length} card(s) exist.`)
      console.log('     The rows are fine — the cards were never written. Re-open the WO')
      console.log('     and hit Save: that runs the projection and should create them.')
      console.log('     If Save does NOT create them, the bug is in the RPC insert path.')
    } else if (segs.length === bk.length) {
      console.log(`   ✓ ${segs.length} segment(s), ${bk.length} card(s) — projection matches the cards.`)
      if (bk.length === 1 && st.length > 1) {
        console.log('     Only one card because all dated rows are ONE consecutive run in ONE room.')
        console.log('     That card spans start→end and the calendar paints it on every day in range.')
      }
    } else {
      console.log(`   ? ${bk.length} card(s) but only ${segs.length} segment(s) — extra/stale cards.`)
    }
    if (dropped) console.log(`   ⚠ ${dropped} row(s) have a room but NO DATE — those can never become a card.`)
  }
}

run().catch(e => { console.error('Failed: ' + e.message); process.exit(1) })
