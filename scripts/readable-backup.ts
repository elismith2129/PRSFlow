// ─────────────────────────────────────────────────────────────────────────────
// READABLE BACKUP — a plain spreadsheet anybody on staff can open when PRSFlo,
// Supabase, Vercel or GitHub is down (Eli, 2026-10-27: "something that's not
// just backed up as code or database ... an easy to read spreadsheet that
// anybody at my staff could read, backed up every day").
//
// Runs nightly right after scripts/backup.mjs in .github/workflows/
// daily-backup.yml. That JSON dump is the RESTORE copy (every table, every
// file). This is the READ copy: five tabs, names not IDs, real dates, dollars.
// It never restores anything and nothing reads it back.
//
// WHAT LANDS in Drive, in a folder next to the JSON backups:
//   · "PRSFlo Backup – Latest"       — replaced every night (same file, so a
//                                       bookmark keeps working)
//   · "PRSFlo Backup – YYYY-MM-DD"   — one per night, trashed after 90 days
// Both are native Google Sheets (uploaded as .xlsx, converted by Drive).
//
// THE NUMBERS ARE THE APP'S NUMBERS. Billing comes from fetchInvoices() +
// billingStage() — the hub's own loader and badge — and Tenants from the rent
// board's own period / late / partial rules. Nothing here re-derives money.
// If this sheet ever disagrees with the hub, the fix goes in lib/, not here.
//
// HOW IT RUNS: lib/ is TypeScript with @/ imports, so the workflow bundles this
// file with esbuild first (npm run backup:readable). The lib/supabase client is
// built from NEXT_PUBLIC_SUPABASE_ANON_KEY at import time; the workflow passes
// the SERVICE-ROLE key under that name so the hub's loaders see every row
// (RLS would hand the anon key nothing). That key never leaves the runner.
//
// FAILURES ARE LOUD. lib/'s loaders swallow a failed read into an empty list
// (dbResult → toast + logAppError). In the browser that's a red toast; here it
// would be a backup that says "0 invoices". So /api/log-error calls are caught
// below and any one of them fails the run — an empty sheet that looks fine is
// the worst possible backup.
//
// Local test, no database or Drive:  npm run backup:readable -- --fixture f.json --out x.xlsx
// ─────────────────────────────────────────────────────────────────────────────

process.env.TZ = 'America/Los_Angeles'

import ExcelJS from 'exceljs'
import { google } from 'googleapis'
import { Readable } from 'node:stream'
import { readFileSync, writeFileSync } from 'node:fs'
import { supabase } from '@/lib/supabase'
import { fetchInvoices, billingStage, tabsFor, bucketLabel, sortBucket, type InvoiceRow, type Pipeline, type BucketKey } from '@/lib/billing'
import {
  fetchLeases, fetchRentStamps, periodFor, leaseActiveIn, stampKey,
  isRentPartial, isRentLate, currentMonth, shiftMonth, monthLabel, type Lease, type RentStamp,
} from '@/lib/tenants'
import { getLocalToday, timeToMins } from '@/lib/time'

// ─── Config ──────────────────────────────────────────────────────────────────

/** The JSON backup folder — same value as DRIVE_FOLDER_ID in scripts/backup.mjs.
 *  The readable folder is created as its SIBLING (same parent), not inside it,
 *  so it can be shared with staff without opening the raw dumps. */
const JSON_BACKUP_FOLDER_ID = '1SjhWdOP9_Rf3GDkNXU3sRk8CU8bgXk-Q'
const FOLDER_NAME = 'PRSFlo – Readable Backup'
const LATEST_NAME = 'PRSFlo Backup – Latest'
const DATED_PREFIX = 'PRSFlo Backup – '
const KEEP_DAYS = 90

const LEAD_CLOSED_DAYS = 90     // booked/dead leads kept this long
const CAL_BACK_DAYS = 30
const CAL_AHEAD_DAYS = 60
const BILLING_DONE_DAYS = 90    // paid/closed work orders kept this long

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// ─── Catch lib/'s swallowed read failures ────────────────────────────────────

const readFailures: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input)
  if (url === '/api/log-error') {
    try { readFailures.push(JSON.parse(init?.body ?? '{}').message ?? 'unknown') } catch { readFailures.push('unknown') }
    return new Response(null, { status: 204 })
  }
  return realFetch(input, init)
}) as typeof fetch

// ─── Dates ───────────────────────────────────────────────────────────────────

function addDaysIso(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD…' → a Date the sheet shows as that same calendar day. */
function day(v: string | null | undefined): Date | null {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
}

/** A timestamp → its LA calendar day. */
function laDay(ts: string | null | undefined): Date | null {
  if (!ts) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return day(ts)
  const t = new Date(ts)
  if (isNaN(t.getTime())) return null
  return day(t.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
}

/** '14:00' / '2:00 PM' → '2:00 PM'. Anything unreadable is shown as typed. */
function clock(t: string | null | undefined): string {
  if (!t) return ''
  const mins = timeToMins(t)
  if (isNaN(mins)) return t
  const h = Math.floor(mins / 60) % 24, m = mins % 60
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '')
const join = (...p: Array<string | null | undefined>) => p.map(x => (x ?? '').trim()).filter(Boolean).join(' ')

// ─── The data ────────────────────────────────────────────────────────────────

type Data = {
  leads: any[]
  bookings: any[]
  invoices: InvoiceRow[]
  collectionNotes: Record<string, string>
  leases: Lease[]
  stamps: Record<string, RentStamp>
}

/** supabase-js caps a read at 1000 rows; page until a short page. */
async function all(build: (from: number, to: number) => any, what: string): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(`Loading ${what}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

async function load(today: string): Promise<Data> {
  const leadCut = addDaysIso(today, -LEAD_CLOSED_DAYS)
  const calFrom = addDaysIso(today, -CAL_BACK_DAYS)
  const calTo = addDaysIso(today, CAL_AHEAD_DAYS)

  // select('*'), NOT a column list (2026-10-29: the first live run died on
  // "column leads.updated_at does not exist" — lib/supabase.ts's Lead type
  // lists a column the table never got). A backup must not break because a
  // TS type drifted from the schema; a missing column just prints blank.
  // "Touched" = last contact or created, the two dates every lead really has.
  const leads = await all((a, b) => supabase.from('leads')
    .select('*')
    .or(`status.not.in.(booked,dead),created_at.gte.${leadCut},last_contact.gte.${leadCut}`)
    .order('id').range(a, b), 'leads')

  const bookings = await all((a, b) => supabase.from('bookings')
    .select('*')
    .lte('start_date', calTo).gte('end_date', calFrom)
    .order('start_date').order('id').range(a, b), 'bookings')

  const invoices = await fetchInvoices()
  // fetchInvoices returns [] on a failed read; the fetch hook above records
  // that, but an EMPTY table is checked too — "no work orders" is never true.
  const { count: woCount, error: woErr } = await supabase.from('work_orders').select('id', { count: 'exact', head: true })
  if (woErr) throw new Error(`Counting work orders: ${woErr.message}`)
  if ((woCount ?? 0) > 0 && invoices.length === 0) throw new Error(`fetchInvoices returned nothing but work_orders has ${woCount} rows`)

  const notes = await all((a, b) => supabase.from('wo_collection_notes')
    .select('work_order_id, body, initials, created_at')
    .order('created_at', { ascending: false }).range(a, b), 'collection notes')
  const collectionNotes: Record<string, string> = {}
  for (const n of notes) {
    if (collectionNotes[n.work_order_id]) continue // newest first, keep the first
    const when = laDay(n.created_at)
    const stamp = when ? `${when.getUTCMonth() + 1}/${when.getUTCDate()}` : ''
    collectionNotes[n.work_order_id] = join(stamp, n.initials ? `${n.initials}:` : '', n.body)
  }

  const leases = await fetchLeases()
  const stampMap = await fetchRentStamps(tenantMonths())
  return { leads, bookings, invoices, collectionNotes, leases, stamps: Object.fromEntries(stampMap) }
}

const tenantMonths = () => [shiftMonth(currentMonth(), -1), currentMonth(), shiftMonth(currentMonth(), 1)]

// ─── Layout (v2, Eli 2026-11-03) ─────────────────────────────────────────────
// "overall very hard to read … my team is young." v1 was one flat table per
// tab, 14 columns wide. v2: every tab is SECTIONS — a coloured band with a
// plain-English title and a count, then a short table under it. Fewer
// columns, bigger type, today at the top of Calendar, the hub's own bins on
// Billing (one tab per side: Labels, COD), Invoice # beside WO #.
// Section bands use merged cells; no filters (a filter would slice across
// sections). Only the header row freezes — a frozen first column eats a
// phone screen.

const NAVY = 'FF1F3A5F', INK = 'FF1B2430', MUTED = 'FF5A6472', LINE = 'FFE1E6EC', BAND_ROW = 'FFF6F8FA'
const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00;"–"'
const DATE = 'ddd, mmm d'
const SIZE = 11

/** Band colour per section kind — soft, so black text stays readable. */
const TONE: Record<string, string> = {
  hot: 'FFFDE2E1', warm: 'FFFFF1D6', cool: 'FFE3ECF7', good: 'FFDFF3E4', grey: 'FFEDEFF2', purple: 'FFEDE7F6', teal: 'FFE0F2F1', today: 'FFFFF1D6',
}

type Col = { h: string; w: number; fmt?: string; wrap?: true; right?: true; indent?: number }
type Section = { title: string; note?: string; tone: string; rows: any[][]; totals?: Record<number, number>; dim?: (row: any[]) => boolean; divider?: true }

function sheet(wb: ExcelJS.Workbook, name: string, intro: string, cols: Col[], sections: Section[]): number {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }] })
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w })
  const n = cols.length
  const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Arial', size: SIZE, color: { argb: INK }, ...o })

  ws.mergeCells(1, 1, 1, n)
  ws.getCell(1, 1).value = intro
  ws.getCell(1, 1).font = font({ italic: true, size: 10, color: { argb: MUTED } })
  ws.getRow(1).height = 20

  cols.forEach((c, i) => {
    const cell = ws.getCell(2, i + 1)
    cell.value = c.h
    cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } })
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.alignment = { vertical: 'middle', horizontal: c.right ? 'right' : 'left', wrapText: true }
  })
  ws.getRow(2).height = 26

  let r = 3, total = 0
  for (const s of sections) {
    r++ // breathing room above every band
    ws.mergeCells(r, 1, r, n)
    const band = ws.getCell(r, 1)
    band.value = s.note ? `${s.title}   ·   ${s.note}` : s.title
    band.font = font({ bold: true, size: 12 })
    band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TONE[s.tone] ?? TONE.grey } }
    band.alignment = { vertical: 'middle', indent: 1 }
    ws.getRow(r).height = 26
    r++
    if (s.divider) continue
    if (s.rows.length === 0) {
      ws.getCell(r, 1).value = 'Nothing here.'
      ws.getCell(r, 1).font = font({ italic: true, color: { argb: MUTED } })
      r++
      continue
    }
    s.rows.forEach((row, i) => {
      const dim = s.dim?.(row) ?? false
      cols.forEach((c, ci) => {
        const cell = ws.getCell(r, ci + 1)
        const v = row[ci]
        cell.value = v === '' || v === undefined ? null : v
        cell.font = font(dim ? { color: { argb: MUTED }, strike: true } : {})
        cell.alignment = { vertical: 'top', wrapText: !!c.wrap, horizontal: c.right ? 'right' : 'left', indent: c.indent }
        cell.border = { bottom: { style: 'thin', color: { argb: LINE } } }
        if (c.fmt) cell.numFmt = c.fmt
        if (i % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_ROW } }
      })
      ws.getRow(r).height = 20
      r++; total++
    })
    if (s.totals) {
      const first = Math.min(...Object.keys(s.totals).map(Number))
      ws.getCell(r, first).value = 'Total'
      ws.getCell(r, first).font = font({ bold: true })
      ws.getCell(r, first).alignment = { horizontal: 'right' }
      for (const [k, v] of Object.entries(s.totals)) {
        const cell = ws.getCell(r, Number(k) + 1)
        cell.value = Math.round(v * 100) / 100
        cell.numFmt = MONEY
        cell.font = font({ bold: true })
        cell.alignment = { horizontal: 'right' }
        cell.border = { top: { style: 'medium', color: { argb: NAVY } } }
      }
      r++
    }
  }
  return total
}

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const longDay = (iso: string) => {
  const d = day(iso)!
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()
}

// ─── Leads ───────────────────────────────────────────────────────────────────

const LEAD_BINS: Array<{ key: string; title: string; tone: string }> = [
  { key: 'hot', title: 'HOT', tone: 'hot' },
  { key: 'uncontacted', title: 'NOT CONTACTED YET', tone: 'purple' },
  { key: 'warm', title: 'WARM', tone: 'warm' },
  { key: 'leasing', title: 'LEASING (room rental talks)', tone: 'teal' },
  { key: 'cold', title: 'COLD', tone: 'cool' },
  { key: 'booked', title: `BOOKED (last ${LEAD_CLOSED_DAYS} days)`, tone: 'good' },
  { key: 'dead', title: `DID NOT BOOK (last ${LEAD_CLOSED_DAYS} days)`, tone: 'grey' },
]

function leadsSheet(wb: ExcelJS.Workbook, d: Data) {
  const row = (l: any) => [
    join(l.fname, l.lname) || '(no name)',
    join(l.company, l.label && l.label !== l.company ? l.label : ''),
    l.phone ?? '', l.email ?? '', day(l.session_date), l.location ?? '', l.quote ?? '',
    laDay(l.last_contact), laDay(l.created_at), l.source ?? '', l.notes ?? '',
  ]
  const known = new Set(LEAD_BINS.map(b => b.key))
  const bins = [...LEAD_BINS, { key: '__other', title: 'OTHER', tone: 'grey' }]
  const sections = bins.map(b => {
    const list = d.leads
      .filter(l => (b.key === '__other' ? !known.has(l.status) : l.status === b.key))
      .sort((a, z) => String(z.created_at).localeCompare(String(a.created_at)))
    return { title: b.title, note: plural(list.length, 'lead'), tone: b.tone, rows: list.map(row) }
  }).filter(s => s.rows.length || s.title !== 'OTHER')
  return sheet(wb, 'Leads', 'Grouped by status, hottest first. Newest lead at the top of each group.', [
    { h: 'Name', w: 24 }, { h: 'Company / Label', w: 20 }, { h: 'Phone', w: 16 }, { h: 'Email', w: 28 },
    { h: 'Session wanted', w: 15, fmt: DATE }, { h: 'Studio', w: 12 }, { h: 'Quote', w: 13 },
    { h: 'Last contact', w: 14, fmt: DATE }, { h: 'Added', w: 13, fmt: DATE }, { h: 'Came from', w: 14 },
    { h: 'Notes', w: 44, wrap: true },
  ], sections)
}

// ─── Calendar ────────────────────────────────────────────────────────────────

const VENUE_ORDER = ['Paramount', 'Ameraycan', 'Encore', 'Track']

function calendarSheet(wb: ExcelJS.Workbook, d: Data, today: string) {
  const from = addDaysIso(today, -CAL_BACK_DAYS), to = addDaysIso(today, CAL_AHEAD_DAYS)
  type Ev = { date: string; venueRank: number; room: string; cancelled: boolean; row: any[] }
  const evs: Ev[] = []
  // LOCKOUTS + TENANTS ONCE, NOT DAILY (2026-11-03 render: a month-long
  // lockout filled every day of the list with the same line). They get one
  // row each, in a band above Today, with their date range.
  const short = (iso: string) => day(iso)!.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  const standing: any[][] = []
  for (const b of d.bookings) {
    const start = b.start_date, end = b.end_date && b.end_date >= start ? b.end_date : start
    if (b.status === 'lockout' || b.status === 'tenant') {
      standing.push([start === end ? short(start) : `${short(start)} – ${short(end)}`, join(b.location, b.studio ? `– ${b.studio}` : ''),
        b.client_name ?? '', b.artist ?? '', '', cap(b.status), b.wo_number ?? '', b.notes ?? ''])
      continue
    }
    const span = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1
    for (let i = 0, dt = start; dt <= end && i < 400; i++, dt = addDaysIso(dt, 1)) {
      if (dt < from || dt > to) continue
      const time = [clock(b.from_time), clock(b.to_time)].filter(Boolean).join(' – ')
      const staff = [b.engineer_name ? `Eng: ${b.engineer_name}` : '', b.assistant_name ? `Asst: ${b.assistant_name}` : ''].filter(Boolean).join('  ·  ')
      const note = join(span > 1 ? `Day ${i + 1} of ${span}.` : '', b.notes)
      const room = b.studio ?? ''
      evs.push({
        date: dt, venueRank: VENUE_ORDER.indexOf(b.location) < 0 ? 9 : VENUE_ORDER.indexOf(b.location), room,
        cancelled: b.status === 'cancelled',
        row: [time || 'Time TBD', join(b.location, room ? `– ${room}` : ''), b.client_name ?? '', b.artist ?? '',
          staff, cap(b.status), b.wo_number ?? '', note],
      })
    }
  }
  const byDay = new Map<string, Ev[]>()
  for (const e of evs) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
  const sortDay = (list: Ev[]) => list.sort((a, z) =>
    Number(a.cancelled) - Number(z.cancelled) || a.venueRank - z.venueRank || a.room.localeCompare(z.room))
  const tomorrow = addDaysIso(today, 1)
  const section = (date: string): Section => {
    const list = sortDay(byDay.get(date) ?? [])
    const live = list.filter(e => !e.cancelled).length
    const tag = date === today ? 'TODAY  ·  ' : date === tomorrow ? 'TOMORROW  ·  ' : ''
    return {
      title: tag + longDay(date), note: plural(live, 'session'),
      tone: date === today ? 'today' : date < today ? 'grey' : 'cool',
      rows: list.map(e => e.row), dim: row => row[5] === 'Cancelled',
    }
  }
  const upcoming = [...byDay.keys()].filter(k => k >= today).sort()
  const past = [...byDay.keys()].filter(k => k < today).sort().reverse()
  if (!upcoming.includes(today)) upcoming.unshift(today) // "Today · nothing booked" beats a missing day
  const sections = [
    ...(standing.length ? [{ title: 'LOCKOUTS & TENANTS', note: `${plural(standing.length, 'room')} booked for a stretch — not repeated on each day below`, tone: 'teal', rows: standing }] : []),
    ...upcoming.map(section),
    ...(past.length ? [{ title: `PAST ${CAL_BACK_DAYS} DAYS  ·  most recent first`, tone: 'grey', rows: [] as any[][], divider: true as const }] : []),
    ...past.map(section),
  ].filter(s => s.rows.length || s.divider || s.title.startsWith('TODAY'))
  return sheet(wb, 'Calendar', `Today at the top, then the next ${CAL_AHEAD_DAYS} days. The last ${CAL_BACK_DAYS} days are at the bottom. Cancelled sessions are crossed out.`, [
    { h: 'Time / dates', w: 21 }, { h: 'Studio', w: 22 }, { h: 'Client', w: 24 }, { h: 'Artist', w: 20 },
    { h: 'Staff', w: 30 }, { h: 'Status', w: 12 }, { h: 'WO #', w: 10 }, { h: 'Notes', w: 40, wrap: true },
  ], sections)
}

// ─── Billing — the hub's own bins, one tab per side ──────────────────────────

const BIN_TONE: Partial<Record<BucketKey, string>> = {
  balance: 'hot', progress: 'warm', review: 'warm', notstarted: 'grey', po: 'purple', awaiting: 'cool', paid: 'good', closed: 'grey',
}
const BIN_NOTE: Partial<Record<BucketKey, string>> = {
  balance: 'money still owed on a COD session — collect it',
  progress: 'being worked on',
  review: 'money is in — check the work order',
  notstarted: 'first day is still in the future',
  po: 'waiting on the client\'s PO number',
  awaiting: 'invoice sent — waiting on payment',
  paid: `paid in the last ${BILLING_DONE_DAYS} days`,
  closed: `written off or voided in the last ${BILLING_DONE_DAYS} days`,
}

function billingSheet(wb: ExcelJS.Workbook, d: Data, today: string, pipeline: Pipeline) {
  const cut = addDaysIso(today, -BILLING_DONE_DAYS)
  const rows = d.invoices.filter(r => r.pipeline === pipeline).filter(r => {
    if (r.bucket !== 'paid' && r.bucket !== 'closed') return true
    return (r.paidAt ?? r.sessionDate ?? '').slice(0, 10) >= cut
  })
  const bins = [...tabsFor(pipeline).map(b => b.key)]
  if (!bins.includes('closed')) bins.push('closed')
  for (const r of rows) if (!bins.includes(r.bucket)) bins.push(r.bucket)
  const sections: Section[] = bins.map(key => {
    const list = sortBucket(rows.filter(r => r.bucket === key), key)
    const owed = list.reduce((s, r) => s + (r.balance ?? 0), 0)
    const t = { 7: 0, 8: 0, 9: 0 } as Record<number, number>
    for (const r of list) { t[7] += r.total ?? 0; t[8] += r.paid ?? 0; t[9] += r.balance ?? 0 }
    return {
      title: bucketLabel(key).toUpperCase(),
      note: [plural(list.length, 'work order'), owed > 0.005 ? `${money(owed)} owed` : '', BIN_NOTE[key] ?? ''].filter(Boolean).join('  ·  '),
      tone: BIN_TONE[key] ?? 'grey',
      rows: list.map(r => [
        r.woNumber ?? '', r.invoiceNumber ?? '', day(r.sessionDate), r.client ?? '', r.artist ?? '',
        billingStage(r).label, r.poNumber ?? '', r.total ?? 0, r.paid ?? 0, r.balance ?? 0,
        laDay(r.sentAt), laDay(r.paidAt), d.collectionNotes[r.workOrderId] ?? '',
      ]),
      totals: list.length > 1 ? t : undefined,
    }
  })
  const side = pipeline === 'cod' ? 'COD (paid at the studio)' : 'Labels (invoiced)'
  return sheet(wb, pipeline === 'cod' ? 'Billing – COD' : 'Billing – Labels',
    `${side}. Same bins and the same money as the billing hub. Oldest work first inside each bin.`, [
      { h: 'WO #', w: 10 }, { h: 'Invoice #', w: 12 }, { h: 'Session', w: 13, fmt: DATE }, { h: 'Client', w: 24 },
      { h: 'Artist', w: 18 }, { h: 'Stage', w: 16 }, { h: 'PO #', w: 12 },
      { h: 'Total', w: 13, fmt: MONEY, right: true }, { h: 'Paid', w: 13, fmt: MONEY, right: true }, { h: 'Still owed', w: 14, fmt: MONEY, right: true },
      { h: '   Invoice sent', w: 16, fmt: DATE, indent: 3 }, { h: 'Paid on', w: 13, fmt: DATE }, { h: 'Latest note', w: 42, wrap: true },
    ], sections)
}

// ─── Tenants ─────────────────────────────────────────────────────────────────

function tenantsSheet(wb: ExcelJS.Workbook, d: Data) {
  const order: Array<[string, string]> = [
    [currentMonth(), 'THIS MONTH'], [shiftMonth(currentMonth(), -1), 'LAST MONTH'], [shiftMonth(currentMonth(), 1), 'NEXT MONTH'],
  ]
  const sections: Section[] = order.map(([month, label]) => {
    const rows: any[][] = []
    let owed = 0
    for (const lease of d.leases) {
      const p = periodFor(lease, month)
      if (!leaseActiveIn(lease, p)) continue
      const s = d.stamps[stampKey(lease.id, month, 'rent')]
      const status = s?.paidAt ? 'Paid' : isRentPartial(s) ? 'Part paid' : isRentLate(s, p) ? 'LATE' : 'Not due yet'
      const rent = s?.amount ?? lease.amount
      const paid = s?.paidAmount ?? (s?.paidAt ? rent : 0)
      if (!s?.paidAt) owed += Math.max(0, rent - (paid ?? 0))
      rows.push([lease.tenant, join(lease.venue, `– ${lease.roomLabel}`), p.label, rent, status, paid || null,
        laDay(s?.paidAt), laDay(s?.sentAt), s?.qbAt ? 'Yes' : 'No'])
    }
    const late = rows.filter(r => r[4] === 'LATE').length
    return {
      title: `${label}  (${monthLabel(month)})`,
      note: [plural(rows.length, 'tenant'), owed > 0.005 ? `${money(owed)} not paid yet` : 'all paid', late ? `${late} late` : ''].filter(Boolean).join('  ·  '),
      tone: late ? 'hot' : owed > 0.005 ? 'cool' : 'good', rows,
    }
  })
  return sheet(wb, 'Tenants', 'Monthly room rentals. This month first, then last month, then next month.', [
    { h: 'Tenant', w: 24 }, { h: 'Room', w: 24 }, { h: 'Rent period', w: 18 }, { h: 'Rent', w: 13, fmt: MONEY, right: true },
    { h: '   Status', w: 15, indent: 3 }, { h: 'Amount paid', w: 13, fmt: MONEY, right: true }, { h: '   Paid on', w: 16, fmt: DATE, indent: 3 },
    { h: '  Rent email sent', w: 18, fmt: DATE, indent: 2 }, { h: 'In QuickBooks', w: 15 },
  ], sections)
}

// ─── Read Me + workbook ──────────────────────────────────────────────────────

function buildWorkbook(d: Data, today: string, pulledAt: Date): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PRSFlo'
  const readMe = wb.addWorksheet('Start here', { views: [{ showGridLines: false }] })
  const counts = {
    calendar: calendarSheet(wb, d, today),
    labels: billingSheet(wb, d, today, 'billing'),
    cod: billingSheet(wb, d, today, 'cod'),
    leads: leadsSheet(wb, d),
    tenants: tenantsSheet(wb, d),
  }
  const pulled = pulledAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  readMe.getColumn(1).width = 20
  readMe.getColumn(2).width = 90
  const put = (r: number, a: string, b: string, o: { head?: boolean; big?: boolean; tone?: string } = {}) => {
    const A = readMe.getCell(r, 1), B = readMe.getCell(r, 2)
    A.value = a || null; B.value = b || null
    A.font = { name: 'Arial', size: o.big ? 16 : SIZE, bold: true, color: { argb: o.head ? 'FFFFFFFF' : (o.big ? NAVY : INK) } }
    B.font = { name: 'Arial', size: SIZE, bold: !!o.head, color: { argb: o.head ? 'FFFFFFFF' : INK } }
    A.alignment = { vertical: 'top' }; B.alignment = { vertical: 'top', wrapText: true }
    const fill = o.head ? NAVY : o.tone ? TONE[o.tone] : null
    if (fill) for (const c of [A, B]) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    // tall enough for two wrapped lines — 22 clipped the descriptions
    readMe.getRow(r).height = o.big ? 32 : (b.length > 75 ? 36 : 22)
  }
  put(1, 'PRSFlo Backup', '', { big: true })
  put(3, 'Updated', `${pulled}  —  if this is more than a day old, tell Eli.`, { tone: 'today' })
  put(4, 'What this is', 'A read-only copy of PRSFlo for when the app is down. Typing here changes nothing in PRSFlo.')
  put(6, 'Tab', 'What\'s in it', { head: true })
  put(7, 'Calendar', `Every session, today first, then the next ${CAL_AHEAD_DAYS} days. Lockouts and tenants are listed once at the top.  ·  ${counts.calendar} rows`)
  put(8, 'Billing – Labels', `Label work orders in the billing hub's bins — In progress, Awaiting PO, Awaiting payment, Paid…  ·  ${counts.labels} rows`)
  put(9, 'Billing – COD', `COD work orders in the hub's bins — Balance due first.  ·  ${counts.cod} rows`)
  put(10, 'Leads', `Every open lead, grouped Hot → Cold, plus booked / did-not-book from the last ${LEAD_CLOSED_DAYS} days.  ·  ${counts.leads} rows`)
  put(11, 'Tenants', `Monthly room rent — this month, last month, next month.  ·  ${counts.tenants} rows`)
  put(13, 'Tip', 'On a phone, the tabs are along the bottom of the screen. Swipe them sideways to see them all.')
  console.log(`Rows — calendar ${counts.calendar}, labels ${counts.labels}, cod ${counts.cod}, leads ${counts.leads}, tenants ${counts.tenants}`)
  return wb
}

// ─── Drive ───────────────────────────────────────────────────────────────────

function drive() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON')
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(raw), scopes: ['https://www.googleapis.com/auth/drive'] })
  return google.drive({ version: 'v3', auth })
}

const ALL = { supportsAllDrives: true, includeItemsFromAllDrives: true }
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function findInFolder(dr: ReturnType<typeof drive>, folderId: string, name: string, mime: string) {
  const res = await dr.files.list({
    ...ALL, q: `name = '${q(name)}' and '${folderId}' in parents and mimeType = '${mime}' and trashed = false`,
    fields: 'files(id, name)', pageSize: 5,
  })
  return res.data.files?.[0]?.id ?? null
}

async function readableFolder(dr: ReturnType<typeof drive>): Promise<string> {
  // Next to the JSON folder when the service account can see the level above;
  // otherwise INSIDE it (2026-10-30: the second live run failed here — the
  // service account is shared on the JSON folder only, and Drive hides the
  // parent of a folder you were shared into). Inside is still safe to share:
  // Drive access flows down, never up, so sharing this subfolder with staff
  // shows them this subfolder and nothing around it.
  const meta = await dr.files.get({ fileId: JSON_BACKUP_FOLDER_ID, fields: 'parents', supportsAllDrives: true })
  const parent = meta.data.parents?.[0] ?? JSON_BACKUP_FOLDER_ID
  if (parent === JSON_BACKUP_FOLDER_ID) console.log('Parent of the JSON folder not visible — using a subfolder inside it.')
  const found = await findInFolder(dr, parent, FOLDER_NAME, 'application/vnd.google-apps.folder')
  if (found) return found
  const made = await dr.files.create({
    supportsAllDrives: true, fields: 'id',
    requestBody: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
  })
  console.log(`Created folder "${FOLDER_NAME}" — share it with staff from Drive.`)
  return made.data.id!
}

/** Create or replace a Google Sheet by name. Replacing keeps the file id, so
 *  bookmarks and sharing on "Latest" survive every night. */
async function putSheet(dr: ReturnType<typeof drive>, folderId: string, name: string, xlsx: Buffer) {
  const existing = await findInFolder(dr, folderId, name, SHEET_MIME)
  const media = { mimeType: XLSX_MIME, body: Readable.from(xlsx) }
  if (existing) {
    await dr.files.update({ fileId: existing, supportsAllDrives: true, media, fields: 'id' })
    console.log(`✓ Replaced "${name}"`)
  } else {
    await dr.files.create({
      supportsAllDrives: true, fields: 'id', media,
      requestBody: { name, mimeType: SHEET_MIME, parents: [folderId] },
    })
    console.log(`✓ Created "${name}"`)
  }
}

async function trashOld(dr: ReturnType<typeof drive>, folderId: string, today: string) {
  const cut = addDaysIso(today, -KEEP_DAYS)
  let pageToken: string | undefined, trashed = 0
  do {
    const res = await dr.files.list({
      ...ALL, pageToken, pageSize: 200, fields: 'nextPageToken, files(id, name)',
      q: `'${folderId}' in parents and mimeType = '${SHEET_MIME}' and trashed = false`,
    })
    for (const f of res.data.files ?? []) {
      const m = f.name?.match(/^PRSFlo Backup – (\d{4}-\d{2}-\d{2})$/)
      if (m && m[1] < cut) {
        await dr.files.update({ fileId: f.id!, supportsAllDrives: true, requestBody: { trashed: true } })
        trashed++
      }
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  if (trashed) console.log(`Trashed ${trashed} copies older than ${KEEP_DAYS} days`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null }
  const fixture = arg('--fixture'), outFile = arg('--out')
  const today = getLocalToday()
  const pulledAt = new Date()

  const data: Data = fixture ? JSON.parse(readFileSync(fixture, 'utf8')) : await load(today)
  if (readFailures.length) throw new Error(`Database reads failed:\n  · ${readFailures.join('\n  · ')}`)

  const wb = buildWorkbook(data, today, pulledAt)
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer())

  if (outFile) { writeFileSync(outFile, xlsx); console.log(`Wrote ${outFile}`); return }

  const dr = drive()
  const folder = await readableFolder(dr)
  await putSheet(dr, folder, LATEST_NAME, xlsx)
  await putSheet(dr, folder, DATED_PREFIX + today, xlsx)
  await trashOld(dr, folder, today)
  console.log(`Readable backup complete for ${today}.`)
}

main().catch(err => {
  console.error('✗ Readable backup failed:', err?.message ?? err)
  process.exit(1)
})
