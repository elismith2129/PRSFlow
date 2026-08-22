#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Load the extracted history CSVs into `financial_history`.
//
//   node scripts/import-financial-history.mjs <dir-with-csvs>            (dry)
//   node scripts/import-financial-history.mjs <dir-with-csvs> --commit
//
// Pairs with scripts/extract-financial-history.py, which turns the "PRS Daily
// Numbers" workbook into one CSV per year. This script does no interpretation
// whatsoever: the columns are already exactly the table's columns. All the
// judgement — which columns are real, which are roll-ups, how Track's headers
// drifted — lives in the extractor, where it is checked against the
// spreadsheet's own totals. Splitting it this way means the thing that touches
// the database is dumb enough to be obviously correct.
//
// DRY RUN BY DEFAULT. Without --commit it parses, counts and totals, and writes
// nothing.
//
// RAW fetch, NOT @supabase/supabase-js — the same choice scripts/backup.mjs
// documents: the JS client drags in a realtime client that crashes under Node
// 20+ without `ws`, for a script that only ever needs POST.
//
// Needs SUPABASE_SERVICE_ROLE_KEY. `financial_history` has an owner-only SELECT
// policy and NO write policy at all, so writes must come from service-role and
// never from a browser. Reads .env.local the same way the app does.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [, , dir, ...flags] = process.argv
const COMMIT = flags.includes('--commit')

if (!dir) {
  console.error('usage: node scripts/import-financial-history.mjs <dir-with-csvs> [--commit]')
  process.exit(1)
}

// ─── Env ─────────────────────────────────────────────────────────────────────

function loadEnv() {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv()

// ─── Parse ───────────────────────────────────────────────────────────────────
// The extractor writes plain CSV with no embedded commas or quotes in any
// field — venue, room and category are all controlled vocabularies, and the
// name columns are empty. So a split is honest here in a way it would not be
// against the original spreadsheet.

const NUMERIC = new Set(['amount'])

function parseCsv(text) {
  // SPLIT ON \r?\n, NOT \n. Python's csv.writer terminates lines with CRLF per
  // RFC 4180, so splitting on \n alone leaves a stray \r welded to the last
  // field of every row — including the header, which then asks Postgres for a
  // column called "source_key\r" and gets a 400 with a genuinely baffling
  // message. Costs nothing to handle both endings; costs an hour not to.
  const [head, ...lines] = text.trim().split(/\r?\n/)
  const cols = head.split(',').map(c => c.trim())
  return lines.filter(Boolean).map(line => {
    const cells = line.split(',')
    const row = {}
    cols.forEach((c, i) => {
      const v = cells[i] ?? ''
      // Empty client/artist must land as NULL, not as an empty string — a blank
      // string would read as "we know it, and it is nothing".
      row[c] = v === '' ? null : NUMERIC.has(c) ? Number(v) : v
    })
    return row
  })
}

const files = readdirSync(dir)
  .filter(f => /^financial_history_\d{4}\.csv$/.test(f))
  .sort()

if (files.length === 0) {
  console.error(`No financial_history_<year>.csv files in ${dir}`)
  console.error('Run scripts/extract-financial-history.py first.')
  process.exit(1)
}

const all = []
console.log('')
for (const f of files) {
  const rows = parseCsv(readFileSync(join(dir, f), 'utf8'))
  const sum = rows.reduce((s, r) => s + r.amount, 0)
  console.log(`  ${f}   ${String(rows.length).padStart(6)} rows   $${Math.round(sum).toLocaleString('en-US')}`)
  all.push(...rows)
}

const byCat = {}
for (const r of all) byCat[r.category] = (byCat[r.category] ?? 0) + r.amount
console.log(`\n  TOTAL          ${String(all.length).padStart(6)} rows   $${Math.round(all.reduce((s, r) => s + r.amount, 0)).toLocaleString('en-US')}`)
for (const [c, v] of Object.entries(byCat).sort()) {
  console.log(`    ${c.padEnd(14)} $${Math.round(v).toLocaleString('en-US')}`)
}

if (!COMMIT) {
  console.log('\nDry run — nothing written. Re-run with --commit.\n')
  process.exit(0)
}

// ─── Write ───────────────────────────────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).')
  process.exit(1)
}

// merge-duplicates + the unique index on (source_key, category) make this
// re-runnable: a second pass updates rather than doubling the books.
const headers = {
  'apikey': key,
  'Authorization': `Bearer ${key}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates,return=minimal',
}

const CHUNK = 1000
let done = 0
for (let i = 0; i < all.length; i += CHUNK) {
  const chunk = all.slice(i, i + CHUNK)
  const res = await fetch(
    `${url}/rest/v1/financial_history?on_conflict=source_key,category`,
    { method: 'POST', headers, body: JSON.stringify(chunk) },
  )
  if (!res.ok) {
    console.error(`\n\nFailed at row ${i}: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  done += chunk.length
  process.stdout.write(`\r  written ${done}/${all.length}`)
}

console.log(`\n\n✓ ${done} rows in financial_history\n`)
