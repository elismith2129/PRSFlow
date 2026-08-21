#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Import the spreadsheet years into `financial_history`.
//
//   node scripts/import-financial-history.mjs <file.csv> [--commit]
//
// DRY RUN BY DEFAULT. Without --commit it parses, maps, reconciles and prints
// what it WOULD write, and touches nothing. Run it dry, read the reconciliation,
// then run it again with --commit. An importer that writes on first contact with
// a three-year spreadsheet is how you find out about a column mismatch after the
// fact.
//
// WIDE IN, LONG OUT. One spreadsheet row carries four money columns; each
// becomes its own row, filed by category. See the migration header for why.
//
// RE-RUNNABLE. Every output row carries a `source_key` — the file name plus a
// hash of the source line — and the unique index on (source_key, category)
// makes a second run an UPSERT. Fixing one bad line in the CSV and re-importing
// updates that line instead of doubling the year.
//
// Needs SUPABASE_SERVICE_ROLE_KEY: `financial_history` has an owner-only SELECT
// policy and NO write policy at all, deliberately, so writes must come from a
// service-role context and never from a browser.
//
// ⚠ COLUMN MAPPING IS NOT FINAL. The aliases below are a first guess at Eli's
// sheet. Run dry: the script prints every header it did not recognise and every
// row it could not place, so the first dry run IS the mapping conversation.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [, , file, ...flags] = process.argv
const COMMIT = flags.includes('--commit')

if (!file) {
  console.error('usage: node scripts/import-financial-history.mjs <file.csv> [--commit]')
  process.exit(1)
}

// ─── Column aliases ──────────────────────────────────────────────────────────
// Lowercased, punctuation-stripped header → what it means. Add real ones here
// after the first dry run reports what the sheet actually says.

const DATE_KEYS = ['date', 'sessiondate', 'day', 'startdate']
const VENUE_KEYS = ['venue', 'studio', 'location', 'building']
const ROOM_KEYS = ['room', 'studioroom', 'rm']
const CLIENT_KEYS = ['client', 'clientname', 'company', 'account']
const ARTIST_KEYS = ['artist', 'artistname', 'project']

const MONEY_KEYS = {
  room: ['room', 'roomcost', 'roomcharge', 'roomrate', 'studio', 'studiotime', 'studiocost'],
  assistant: ['assistant', 'asst', 'assistantcost', 'asstcost', 'assistantcharge', 'second'],
  engineering: ['engineering', 'engineer', 'eng', 'engcost', 'engineeringcost', 'engineercharge'],
  rental: ['rental', 'rentals', 'rentalcost', 'gear', 'equipment', 'equipmentrental'],
}

const VENUE_ALIASES = {
  prs: 'Paramount', paramount: 'Paramount',
  ars: 'Ameraycan', ameraycan: 'Ameraycan', america: 'Ameraycan',
  ers: 'Encore', encore: 'Encore',
  trs: 'Track', trk: 'Track', track: 'Track',
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// ─── CSV parsing ─────────────────────────────────────────────────────────────
// Hand-rolled because a Google Sheets export is well-formed CSV — quoted fields
// with embedded commas and doubled quotes, nothing exotic. One dependency less.

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ }
        else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * Find the header row.
 *
 * NOT ALWAYS ROW 1. Real sheets open with a title, a blank line, maybe a note.
 * The header is the first row within the top 20 that names a date column AND at
 * least one money column — a rule that survives decoration above it.
 */
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const keys = rows[i].map(norm)
    const hasDate = keys.some(k => DATE_KEYS.includes(k))
    const hasMoney = Object.values(MONEY_KEYS).some(list => keys.some(k => list.includes(k)))
    if (hasDate && hasMoney) return i
  }
  return -1
}

function money(v) {
  const s = String(v ?? '').trim()
  if (!s) return 0
  // Accounting parentheses are negatives: (1,200) → -1200.
  const neg = /^\(.*\)$/.test(s)
  const n = parseFloat(s.replace(/[()$,\s]/g, ''))
  if (!isFinite(n)) return 0
  return neg ? -n : n
}

/**
 * Date → ISO, kept as TEXT throughout.
 *
 * Never `new Date(...)`. Parsing '3/4/2024' into a Date and formatting it back
 * runs the value through the machine's timezone, which in Los Angeles shifts
 * some dates back a day — and a session that moves from the 1st to the previous
 * month lands in the wrong bar on the chart. Ambiguous m/d vs d/m is resolved as
 * US order, which is what a Los Angeles studio's sheet will be.
 */
function toIso(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (m) {
    let [, mo, d, y] = m
    if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

function venueOf(raw, room) {
  const v = VENUE_ALIASES[norm(raw)]
  if (v) return v
  // Some sheets put "PRS A" in one cell. Try the room column's prefix too.
  const first = String(room ?? '').trim().split(/\s+/)[0]
  return VENUE_ALIASES[norm(first)] ?? String(raw ?? '').trim()
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const text = readFileSync(file, 'utf8')
const rows = parseCsv(text)
const hi = findHeader(rows)

if (hi === -1) {
  console.error('Could not find a header row in the first 20 lines.')
  console.error('Looked for a date column plus at least one money column.')
  console.error('First rows were:')
  rows.slice(0, 8).forEach((r, i) => console.error(`  ${i}: ${r.join(' | ')}`))
  console.error('\nAdd the real header names to DATE_KEYS / MONEY_KEYS at the top of this file.')
  process.exit(1)
}

const header = rows[hi].map(norm)
const rawHeader = rows[hi]
const idxOf = list => header.findIndex(k => list.includes(k))

const iDate = idxOf(DATE_KEYS)
const iVenue = idxOf(VENUE_KEYS)
const iRoom = idxOf(ROOM_KEYS)
const iClient = idxOf(CLIENT_KEYS)
const iArtist = idxOf(ARTIST_KEYS)
const moneyIdx = Object.fromEntries(
  Object.entries(MONEY_KEYS).map(([cat, list]) => [cat, idxOf(list)]),
)

const claimed = new Set([iDate, iVenue, iRoom, iClient, iArtist, ...Object.values(moneyIdx)])
const unknown = rawHeader
  .map((h, i) => ({ h: h.trim(), i }))
  .filter(x => x.h && !claimed.has(x.i))

const fileTag = file.split('/').pop()
const out = []
const skipped = []

for (let r = hi + 1; r < rows.length; r++) {
  const cells = rows[r]
  if (cells.every(c => String(c).trim() === '')) continue

  const joined = cells.join('|')
  // Totals/subtotal rows would double every figure they summarise.
  if (/^\s*(total|subtotal|sum|grand total)/i.test(String(cells[0] ?? ''))) {
    skipped.push({ line: r + 1, why: 'totals row', preview: joined.slice(0, 80) })
    continue
  }

  const iso = toIso(cells[iDate])
  if (!iso) {
    skipped.push({ line: r + 1, why: 'unparseable date', preview: joined.slice(0, 80) })
    continue
  }

  const room = iRoom >= 0 ? String(cells[iRoom] ?? '').trim() : ''
  const venue = venueOf(iVenue >= 0 ? cells[iVenue] : '', room)
  const sourceKey = `${fileTag}#${createHash('sha1').update(`${r}|${joined}`).digest('hex').slice(0, 16)}`

  let any = false
  for (const [category, ci] of Object.entries(moneyIdx)) {
    if (ci < 0) continue
    const amount = money(cells[ci])
    if (amount === 0) continue
    any = true
    out.push({
      session_date: iso,
      venue,
      room,
      category,
      direction: 'revenue',
      amount,
      client_name: iClient >= 0 ? String(cells[iClient] ?? '').trim() || null : null,
      artist_name: iArtist >= 0 ? String(cells[iArtist] ?? '').trim() || null : null,
      source_file: fileTag,
      source_key: sourceKey,
    })
  }
  if (!any) skipped.push({ line: r + 1, why: 'no money on the row', preview: joined.slice(0, 80) })
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

const byCat = {}
const byYear = {}
for (const o of out) {
  byCat[o.category] = (byCat[o.category] ?? 0) + o.amount
  const y = o.session_date.slice(0, 4)
  byYear[y] = (byYear[y] ?? 0) + o.amount
}
const usd = n => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })

console.log(`\nFile          ${file}`)
console.log(`Header line   ${hi + 1}`)
console.log(`Mapped        date=${rawHeader[iDate]}  venue=${iVenue >= 0 ? rawHeader[iVenue] : '—'}  room=${iRoom >= 0 ? rawHeader[iRoom] : '—'}`)
for (const [cat, ci] of Object.entries(moneyIdx)) {
  console.log(`              ${cat.padEnd(12)} ${ci >= 0 ? rawHeader[ci] : '⚠ NOT FOUND'}`)
}
if (unknown.length) {
  console.log(`\n⚠ Unrecognised columns (ignored): ${unknown.map(u => u.h).join(', ')}`)
  console.log('  If any of those is money, add it to MONEY_KEYS and re-run.')
}

console.log(`\nRows out      ${out.length}  (from ${rows.length - hi - 1} source lines)`)
console.log('By category')
for (const c of ['room', 'engineering', 'assistant', 'rental']) {
  console.log(`  ${c.padEnd(12)} ${usd(byCat[c] ?? 0)}`)
}
console.log('By year')
for (const y of Object.keys(byYear).sort()) console.log(`  ${y}         ${usd(byYear[y])}`)
console.log(`  TOTAL        ${usd(Object.values(byCat).reduce((s, v) => s + v, 0))}`)

const venues = [...new Set(out.map(o => `${o.venue} · ${o.room}`))].sort()
console.log(`\nRooms seen (${venues.length})`)
venues.forEach(v => console.log(`  ${v}`))

if (skipped.length) {
  console.log(`\nSkipped ${skipped.length} line(s):`)
  skipped.slice(0, 15).forEach(s => console.log(`  line ${s.line}  ${s.why}  ${s.preview}`))
  if (skipped.length > 15) console.log(`  … and ${skipped.length - 15} more`)
}

console.log('\n⚠ CHECK THE TOTALS ABOVE AGAINST THE SPREADSHEET BEFORE COMMITTING.')

if (!COMMIT) {
  console.log('\nDry run — nothing written. Re-run with --commit when the numbers match.\n')
  process.exit(0)
}

// ─── Write ───────────────────────────────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

let done = 0
for (let i = 0; i < out.length; i += 500) {
  const chunk = out.slice(i, i + 500)
  const { error } = await db
    .from('financial_history')
    .upsert(chunk, { onConflict: 'source_key,category' })
  if (error) {
    console.error(`\nFailed at row ${i}: ${error.message}`)
    process.exit(1)
  }
  done += chunk.length
  process.stdout.write(`\r  written ${done}/${out.length}`)
}
console.log(`\n\n✓ ${done} rows in financial_history from ${fileTag}\n`)
