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
import { fetchInvoices, billingStage, type InvoiceRow } from '@/lib/billing'
import {
  fetchLeases, fetchRentStamps, periodFor, leaseActiveIn, stampKey,
  isRentPartial, isRentLate, currentMonth, shiftMonth, type Lease, type RentStamp,
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

// ─── Rows per tab ────────────────────────────────────────────────────────────

const LEAD_ORDER: Record<string, number> = { hot: 0, uncontacted: 1, warm: 2, leasing: 3, cold: 4, booked: 5, dead: 6 }

function leadRows(d: Data) {
  return [...d.leads]
    .sort((a, b) => (LEAD_ORDER[a.status] ?? 9) - (LEAD_ORDER[b.status] ?? 9)
      || String(b.created_at).localeCompare(String(a.created_at)))
    .map(l => [
      join(l.fname, l.lname) || '(no name)', join(l.company, l.label && l.label !== l.company ? l.label : ''),
      cap(l.status), l.source ?? '', l.billing ?? '', l.phone ?? '', l.email ?? '', l.location ?? '',
      day(l.session_date), l.quote ?? '', l.follow_rating ?? null, laDay(l.last_contact), laDay(l.created_at), l.notes ?? '',
    ])
}

function calendarRows(d: Data, today: string) {
  const from = addDaysIso(today, -CAL_BACK_DAYS), to = addDaysIso(today, CAL_AHEAD_DAYS)
  const out: any[][] = []
  for (const b of d.bookings) {
    const start = b.start_date, end = b.end_date && b.end_date >= start ? b.end_date : start
    const total = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1
    for (let i = 0, dt = start; dt <= end && i < 400; i++, dt = addDaysIso(dt, 1)) {
      if (dt < from || dt > to) continue
      out.push([
        day(dt), clock(b.from_time), clock(b.to_time), b.location ?? '', b.studio ?? '', cap(b.status),
        b.client_name ?? '', b.artist ?? '', b.label ?? '', b.engineer_name ?? '', b.assistant_name ?? '',
        b.wo_number ?? '', b.po ?? '', join(total > 1 ? `Day ${i + 1} of ${total}.` : '', b.notes),
      ])
    }
  }
  const studioKey = (r: any[]) => `${r[3]}|${r[4]}`
  return out.sort((a, b) => a[0] - b[0] || studioKey(a).localeCompare(studioKey(b)))
}

function billingRows(d: Data, today: string) {
  const cut = addDaysIso(today, -BILLING_DONE_DAYS)
  return d.invoices
    .map(r => ({ r, stage: billingStage(r) }))
    .filter(({ r, stage }) => {
      if (stage.key !== 'paid' && stage.key !== 'closed') return true
      const last = (r.paidAt ?? r.sessionDate ?? '').slice(0, 10)
      return last >= cut
    })
    .sort((a, b) => String(b.r.sessionDate ?? '').localeCompare(String(a.r.sessionDate ?? '')))
    .map(({ r, stage }) => [
      r.woNumber ?? '', day(r.sessionDate), r.client ?? '', r.artist ?? '', r.isCod ? 'COD' : 'Billing',
      r.poNumber ?? '', stage.label, r.total ?? 0, r.paid ?? 0, r.balance ?? 0,
      r.invoiceNumber ?? '', laDay(r.sentAt), laDay(r.paidAt), d.collectionNotes[r.workOrderId] ?? '',
    ])
}

function tenantRows(d: Data) {
  const out: any[][] = []
  for (const month of tenantMonths()) {
    for (const lease of d.leases) {
      const p = periodFor(lease, month)
      if (!leaseActiveIn(lease, p)) continue
      const s = d.stamps[stampKey(lease.id, month, 'rent')]
      const status = s?.paidAt ? 'Paid' : isRentPartial(s) ? 'Partial' : isRentLate(s, p) ? 'Late' : 'Open'
      out.push([
        lease.tenant, lease.venue, lease.roomLabel, s?.amount ?? lease.amount, p.label,
        laDay(s?.sentAt), laDay(s?.paidAt), s?.paidAmount ?? (s?.paidAt ? s?.amount ?? lease.amount : null),
        status, s?.qbAt ? 'Yes' : 'No',
      ])
    }
  }
  return out
}

// ─── Workbook ────────────────────────────────────────────────────────────────

const NAVY = 'FF1F3A5F', BAND = 'FFF2F5F9', LINE = 'FFD9DEE5'
const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00;"-"'
const DATE = 'ddd mmm d, yyyy'
const FILL: Record<string, string> = {
  Hot: 'FDE2E1', Warm: 'FFF1D6', Cold: 'E3ECF7', Uncontacted: 'EDE7F6', Booked: 'DFF3E4', Dead: 'EEEEEE', Leasing: 'E0F2F1',
  Confirmed: 'DFF3E4', Tentative: 'FFF1D6', Cancelled: 'EEEEEE', Lockout: 'E0F2F1', Tenant: 'E0F2F1', Tour: 'EDE7F6',
  Paid: 'DFF3E4', Partial: 'FFF1D6', Open: 'E3ECF7', Late: 'FDE2E1',
  'Balance due': 'FDE2E1', 'Not approved': 'FDE2E1', Sent: 'E3ECF7', 'Awaiting PO': 'FFF1D6',
  'Needs invoice': 'FFF1D6', 'Needs review': 'FFF1D6', 'Needs approval': 'FFF1D6', 'Ready to send': 'E3ECF7', Approved: 'DFF3E4',
}

type Col = { h: string; w: number; fmt?: string; status?: true; wrap?: true }

function tab(wb: ExcelJS.Workbook, name: string, note: string, cols: Col[], rows: any[][], totals?: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }] })
  ws.getCell(1, 1).value = note
  ws.getCell(1, 1).font = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF5A6472' } }
  cols.forEach((c, i) => {
    const cell = ws.getCell(2, i + 1)
    cell.value = c.h
    cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    ws.getColumn(i + 1).width = c.w
  })
  ws.getRow(2).height = 30
  rows.forEach((row, ri) => {
    const r = ws.getRow(ri + 3)
    cols.forEach((c, ci) => {
      const cell = r.getCell(ci + 1)
      const v = row[ci]
      cell.value = v === '' || v === undefined ? null : v
      cell.font = { name: 'Arial', size: 10 }
      cell.border = { bottom: { style: 'thin', color: { argb: LINE } } }
      cell.alignment = { vertical: 'top', wrapText: !!c.wrap }
      if (c.fmt) cell.numFmt = c.fmt
      if (ri % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }
      if (c.status && typeof v === 'string' && FILL[v]) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + FILL[v] } }
        cell.font = { name: 'Arial', size: 10, bold: true }
      }
    })
  })
  if (rows.length === 0) {
    ws.getCell(3, 1).value = '(nothing in this range)'
    ws.getCell(3, 1).font = { name: 'Arial', italic: true, size: 10, color: { argb: 'FF5A6472' } }
  } else {
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: rows.length + 2, column: cols.length } }
  }
  if (totals && rows.length) {
    const tr = ws.getRow(rows.length + 3)
    tr.getCell(totals[0] - 1).value = 'TOTALS'
    tr.getCell(totals[0] - 1).font = { name: 'Arial', bold: true, size: 10 }
    for (const c of totals) {
      const cell = tr.getCell(c)
      const L = ws.getColumn(c).letter
      const sum = rows.reduce((s, r) => s + (Number(r[c - 1]) || 0), 0)
      cell.value = { formula: `SUM(${L}3:${L}${rows.length + 2})`, result: Math.round(sum * 100) / 100 }
      cell.numFmt = MONEY
      cell.font = { name: 'Arial', bold: true, size: 10 }
      cell.border = { top: { style: 'medium', color: { argb: NAVY } } }
    }
  }
  return rows.length
}

function buildWorkbook(d: Data, today: string, pulledAt: Date): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PRSFlo'
  const readMe = wb.addWorksheet('Read Me', { views: [{ showGridLines: false }] })

  const counts = {
    leads: tab(wb, 'Leads', `Open leads + booked/dead from the last ${LEAD_CLOSED_DAYS} days · hottest first`, [
      { h: 'Name', w: 22 }, { h: 'Company / Label', w: 18 }, { h: 'Status', w: 12, status: true },
      { h: 'Source', w: 13 }, { h: 'COD or Billing', w: 12 }, { h: 'Phone', w: 15 }, { h: 'Email', w: 26 },
      { h: 'Venue', w: 12 }, { h: 'Session date', w: 18, fmt: DATE }, { h: 'Quote', w: 12 },
      { h: 'Follow-up rating', w: 10 }, { h: 'Last contact', w: 18, fmt: DATE }, { h: 'Added', w: 18, fmt: DATE },
      { h: 'Notes', w: 40, wrap: true },
    ], leadRows(d)),
    calendar: tab(wb, 'Calendar', `${CAL_BACK_DAYS} days back through ${CAL_AHEAD_DAYS} days ahead · one row per room per day`, [
      { h: 'Date', w: 18, fmt: DATE }, { h: 'Start', w: 10 }, { h: 'End', w: 10 }, { h: 'Venue', w: 12 },
      { h: 'Room', w: 11 }, { h: 'Status', w: 12, status: true }, { h: 'Client', w: 20 }, { h: 'Artist', w: 18 },
      { h: 'Label', w: 14 }, { h: 'Engineer', w: 14 }, { h: 'Assistant', w: 13 }, { h: 'WO #', w: 10 },
      { h: 'PO #', w: 11 }, { h: 'Notes', w: 34, wrap: true },
    ], calendarRows(d, today)),
    billing: tab(wb, 'Billing', `Every work order not paid or closed, + paid/closed in the last ${BILLING_DONE_DAYS} days · same stage and money as the billing hub`, [
      { h: 'WO #', w: 10 }, { h: 'Session date', w: 18, fmt: DATE }, { h: 'Client', w: 22 }, { h: 'Artist', w: 18 },
      { h: 'COD or Billing', w: 12 }, { h: 'PO #', w: 12 }, { h: 'Stage', w: 15, status: true },
      { h: 'Total', w: 13, fmt: MONEY }, { h: 'Paid', w: 13, fmt: MONEY }, { h: 'Balance', w: 13, fmt: MONEY },
      { h: 'Invoice #', w: 12 }, { h: 'Invoice sent', w: 18, fmt: DATE }, { h: 'Paid on', w: 18, fmt: DATE },
      { h: 'Latest collection note', w: 36, wrap: true },
    ], billingRows(d, today), [8, 9, 10]),
    tenants: tab(wb, 'Tenants', 'Active leases · last, this and next rent period', [
      { h: 'Tenant', w: 22 }, { h: 'Venue', w: 12 }, { h: 'Room', w: 14 }, { h: 'Rent', w: 13, fmt: MONEY },
      { h: 'Rent period', w: 18 }, { h: 'Email sent', w: 18, fmt: DATE }, { h: 'Paid on', w: 18, fmt: DATE },
      { h: 'Amount paid', w: 13, fmt: MONEY }, { h: 'Status', w: 11, status: true }, { h: 'In QuickBooks', w: 13 },
    ], tenantRows(d)),
  }

  readMe.getColumn(1).width = 24
  readMe.getColumn(2).width = 84
  readMe.getCell('A1').value = 'PRSFlo — Readable Backup'
  readMe.getCell('A1').font = { name: 'Arial', bold: true, size: 16, color: { argb: NAVY } }
  const pulled = pulledAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const lines: Array<[string, string, boolean?]> = [
    ['Pulled', pulled],
    ['What this is', 'A read-only copy of PRSFlo, made every night. If PRSFlo is down, use this to see leads, the calendar, billing and tenants. Do not edit it — changes here go nowhere, and tonight\'s copy replaces "Latest" anyway.'],
    ['Where', `Shared Drive › ${FOLDER_NAME}. "${LATEST_NAME}" is replaced every night; a dated copy is kept for ${KEEP_DAYS} days.`],
    ['', ''],
    ['Tab', 'What\'s in it', true],
    ['Leads', `Every open lead (hot, uncontacted, warm, leasing, cold), plus booked and dead leads added or contacted in the last ${LEAD_CLOSED_DAYS} days.  ·  ${counts.leads} rows`],
    ['Calendar', `Every booking from ${CAL_BACK_DAYS} days ago to ${CAL_AHEAD_DAYS} days ahead, all four venues, cancelled included. A multi-day booking has one row per day.  ·  ${counts.calendar} rows`],
    ['Billing', `Every work order that isn't paid or closed, plus paid/closed ones from the last ${BILLING_DONE_DAYS} days. Stage, total, paid and balance match the billing hub.  ·  ${counts.billing} rows`],
    ['Tenants', `Every active lease, with last month's, this month's and next month's rent period.  ·  ${counts.tenants} rows`],
    ['', ''],
    ['If something looks wrong', 'Check "Pulled" first. If it is more than a day old, last night\'s backup failed — tell Eli.'],
  ]
  lines.forEach(([k, v, head], i) => {
    const a = readMe.getCell(i + 3, 1), b = readMe.getCell(i + 3, 2)
    a.value = k || null; b.value = v || null
    a.font = { name: 'Arial', bold: true, size: 10 }
    b.font = { name: 'Arial', size: 10 }
    a.alignment = { vertical: 'top' }
    b.alignment = { vertical: 'top', wrapText: true }
    if (head) for (const c of [a, b]) {
      c.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    }
  })
  console.log(`Rows — leads ${counts.leads}, calendar ${counts.calendar}, billing ${counts.billing}, tenants ${counts.tenants}`)
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
  const meta = await dr.files.get({ fileId: JSON_BACKUP_FOLDER_ID, fields: 'parents', supportsAllDrives: true })
  const parent = meta.data.parents?.[0]
  if (!parent) throw new Error('Could not find the parent of the JSON backup folder')
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
