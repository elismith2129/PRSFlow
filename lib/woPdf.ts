// ─────────────────────────────────────────────────────────────────────────────
// lib/woPdf — the work order as a REAL black-and-white PDF.
//
// SERVER ONLY. Imported by /api/wo-package; never from a 'use client' file.
//
// WHY THIS EXISTS AT ALL (Eli, 2026-08-11): the work order used to become a
// document via the browser's print dialogue and a print stylesheet. That gives
// you a page you have to save by hand, at whatever size and margins the browser
// felt like, and it cannot be stapled to anything. Billing needs ONE file to
// email a label. So the work order is now drawn, not printed.
//
// AND THE PRINT STYLESHEET IS DELETED. That is the whole reason this is safe.
// An earlier plan kept both, which would have meant the work order's appearance
// existed in two descriptions that could quietly disagree — and the one that
// drifted would be the one clients receive. Eli's call ("the only place you ever
// export a work order is from this billing hub") collapses it back to one.
//
// ── REBUILT 2026-08-13 ───────────────────────────────────────────────────────
// v1.9.0 shipped this as a GENERIC INVOICE — a reasonable billing document that
// was not the work order. Eli's ruling closed the question: "we have two
// versions — digital WO, and then black and white flat one that is exact
// representation." So this file is now a section-by-section replica of
// components/calendar/WorkOrderPopup.tsx, in the same order, with the same
// column sets and the same labels.
//
// WHAT IS DELIBERATELY NOT HERE — everything the screen marks `data-no-print`,
// because those are internal and a client receives this file:
//   · the Open/Completed status badge      · Booking Notes ("internal only")
//   · Equipment Condition                  · Needs Attention / Runner Notes
//   · the Seed panel and Batch edit (controls, not content)
// If you add a `data-no-print` section to the screen, it does NOT belong here.
// If you add a PRINTABLE section, IT MUST BE ADDED HERE TOO — row data flows
// through automatically, a whole new section does not.
//
// Schedule (dates/times/rooms) appears ONLY in the Studio Time table, exactly as
// on the screen (docs/WO-SPEC.md §3). Do not add a "session date" to the header;
// that is the second source of truth the WO rebuild removed.
//
// Deliberately plain: Helvetica, black on white, hairline rules. This is a
// billing document, not a brochure — and a label's accounts payable department
// is going to print it in mono anyway.
// ─────────────────────────────────────────────────────────────────────────────

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { calcHours } from '@/lib/time'
import { engChargeForRow } from '@/lib/woTotals'

export type WoPdfRow = Record<string, any>

export type WoPdfInput = {
  wo: Record<string, any>
  studioRows: WoPdfRow[]
  rentalRows: WoPdfRow[]
  paymentRows: WoPdfRow[]
  totals: { studio: number; engineer: number; rentals: number; grand: number; paid: number; balance: number }
  /**
   * BLANK FORM MODE (ruling 2026-08-12). Draws the same document with every
   * value empty and a writable baseline under each cell — the paper work order,
   * replaced. Nothing is created, stored, or put on the calendar.
   */
  blank?: boolean
}

const PAGE: [number, number] = [612, 792] // US Letter, portrait
const M = 44                              // margin
const BLACK = rgb(0, 0, 0)
const RULE = rgb(0.72, 0.72, 0.72)
const HAIR = rgb(0.85, 0.85, 0.85)        // blank-form writing lines

const W = PAGE[0] - M * 2                 // 524pt of usable width
const RIGHT = PAGE[0] - M

const money = (n: number) =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Money that may arrive as "$1,450.00", "1450", 1450 or null. */
const num = (v: any): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isFinite(n) ? n : 0
}

/** A cell that should print as blank rather than as "$0.00" or "0". */
const cash = (v: any): string => (v === null || v === undefined || v === '' ? '' : money(num(v)))

/**
 * "2026-08-04" → "Aug 4".
 *
 * DELIBERATELY NOT the screen's shortDate, which renders "8-4". That is an
 * internal shorthand that works in a 58px cell for someone who knows what
 * month the session was in. This page goes to a label's accounts payable
 * department, months later, printed. They get the month's name.
 */
function pdfDate(d: any): string {
  const str = String(d || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const dt = new Date(`${str}T12:00:00`)
  if (isNaN(dt.getTime())) return str
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * A tiny layout cursor. pdf-lib has no concept of flow — every draw call takes
 * absolute coordinates with the origin at the BOTTOM left — so anything with a
 * variable number of rows needs this or it silently runs off the bottom of the
 * page.
 */
class Sheet {
  doc: PDFDocument
  page: PDFPage
  y: number
  font: PDFFont
  bold: PDFFont
  onNewPage: (s: Sheet) => void = () => {}

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc
    this.font = font
    this.bold = bold
    this.page = doc.addPage(PAGE)
    this.y = PAGE[1] - M
  }

  /** Reserve vertical space, breaking to a new page when it will not fit. */
  need(h: number) {
    if (this.y - h >= M + 28) return
    this.page = this.doc.addPage(PAGE)
    this.y = PAGE[1] - M
    this.onNewPage(this)
  }

  text(
    s: string,
    x: number,
    opts: {
      size?: number
      bold?: boolean
      width?: number
      align?: 'left' | 'right' | 'center'
      dy?: number
      tracking?: number
    } = {},
  ) {
    const size = opts.size ?? 9
    const font = opts.bold ? this.bold : this.font
    let str = s ?? ''
    // Hard-truncate rather than wrap: every column here is a label or a figure,
    // and a wrapped cell would break the row grid the reader is scanning down.
    if (opts.width) {
      while (str.length > 1 && font.widthOfTextAtSize(str, size) > opts.width) str = str.slice(0, -1)
    }
    if (!str) return
    const w = font.widthOfTextAtSize(str, size)
    const x0 =
      opts.align === 'right' ? x - w :
      opts.align === 'center' ? x - w / 2 :
      x
    this.page.drawText(str, {
      x: x0,
      y: this.y + (opts.dy ?? 0),
      size,
      font,
      color: BLACK,
      ...(opts.tracking ? { characterSpacing: opts.tracking } : {}),
    })
  }

  /** Full-width separator. */
  rule(gap = 6) {
    this.y -= gap
    this.line(M, RIGHT, RULE, 0.5)
    this.y -= gap
  }

  /** A horizontal line at the current baseline, in page coordinates. */
  line(x1: number, x2: number, color = RULE, thickness = 0.5, dy = 0) {
    this.page.drawLine({
      start: { x: x1, y: this.y + dy },
      end: { x: x2, y: this.y + dy },
      thickness,
      color,
    })
  }

  gap(n: number) { this.y -= n }
}

type Col = { head: string; w: number; align?: 'right' }

/**
 * A labelled band — the micro-caps label over its value, several to a line.
 * This is the screen's meta row (§8 IdWell: field width follows content, short
 * fields share a line) flattened to print.
 */
function band(s: Sheet, items: Array<{ k: string; v: string; w: number }>, blank = false) {
  s.need(30)
  let x = M
  items.forEach(it => {
    s.text(it.k.toUpperCase(), x, { size: 6.5, bold: true, width: it.w - 10, tracking: 0.6 })
    x += it.w
  })
  s.gap(12)
  x = M
  items.forEach(it => {
    if (blank || !it.v) {
      // A writing line, so a printed blank is actually fillable.
      s.line(x, x + it.w - 12, HAIR, 0.5, -2)
    }
    if (!blank) s.text(it.v || '', x, { size: 9.5, width: it.w - 12 })
    x += it.w
  })
  s.gap(16)
}

function sectionTitle(s: Sheet, title: string) {
  s.text(title.toUpperCase(), M, { size: 7.5, bold: true, tracking: 0.8 })
  s.gap(12)
}

/**
 * A data table. Mirrors the screen's tables: header band, rows, no vertical
 * rules (the screen uses zebra banding, which does not survive a mono printer,
 * so print gets a hairline baseline per row instead).
 */
function table(
  s: Sheet,
  title: string,
  cols: Col[],
  rows: string[][],
  opts: {
    footer?: Array<[string, string]>
    /** Sub-rows keyed by parent row index — the engineer line under a studio row. */
    subRows?: Record<number, string[][]>
    /** Draw a writing line under every row (blank form). */
    ruledRows?: boolean
    /** Render the header even with no rows (blank form). */
    always?: boolean
  } = {},
) {
  const { footer, subRows, ruledRows, always } = opts
  if (rows.length === 0 && !footer && !always) return
  s.need(52)
  sectionTitle(s, title)

  // GUTTER. Right-aligned cells used to draw to the column's exact right edge,
  // which is the next column's left edge — so "OT" and "ENGINEER" printed as
  // "OTENGINEER" (Eli, 2026-08-11). Every cell now keeps a gutter, and the
  // truncation width matches it so nothing can grow back into the gap.
  const GUT = 8
  const cellX = (x: number, c: Col) => (c.align === 'right' ? x + c.w - GUT : x)

  const drawHead = (sh: Sheet) => {
    let x = M
    cols.forEach(c => {
      sh.text(c.head.toUpperCase(), cellX(x, c), {
        size: 6.5, bold: true, align: c.align, width: c.w - GUT, tracking: 0.4,
      })
      x += c.w
    })
    // Same trap as the footer: rule() leaves the cursor `gap` below the line,
    // and the next row's glyphs rise back through it. The first row of every
    // table printed with a line struck through it.
    sh.rule(5)
    sh.gap(6)
  }
  drawHead(s)
  // Repeat the header on every continuation page — a table's second page with
  // no headings is a grid of unlabelled numbers.
  s.onNewPage = sh => { sectionTitle(sh, title); drawHead(sh) }

  const drawRow = (r: string[], indent = false) => {
    s.need(15)
    let x = M
    cols.forEach((c, i) => {
      const v = r[i] ?? ''
      if (v) s.text(v, cellX(x, c), { size: indent ? 8 : 8.5, align: c.align, width: c.w - GUT })
      x += c.w
    })
    if (ruledRows) s.line(M, RIGHT, HAIR, 0.5, -3.5)
    s.gap(13)
  }

  rows.forEach((r, i) => {
    drawRow(r)
    ;(subRows?.[i] ?? []).forEach(sub => drawRow(sub, true))
  })
  s.onNewPage = () => {}

  if (footer && footer.length) {
    // The extra drop matters: rule() leaves the cursor only `gap` below the
    // line, and a 7pt cap height then rises straight back through it — the
    // subtotal labels printed with a line struck through them.
    s.rule(5)
    s.gap(7)
    footer.forEach(([k, v], i) => {
      s.need(14)
      s.text(k.toUpperCase(), M, { size: 7, bold: true, tracking: 0.6 })
      // A subtotal with no value is a blank form — give it somewhere to write.
      if (v) s.text(v, RIGHT, { size: 9, bold: i === footer.length - 1, align: 'right' })
      else s.line(RIGHT - 110, RIGHT, HAIR, 0.5, -2)
      s.gap(13)
    })
    s.gap(4)
  } else {
    s.gap(6)
  }
}

/** Wrapped free text — the one place truncation would lose meaning. */
function paragraph(s: Sheet, body: string, size = 8.5, leading = 12) {
  let rest = String(body)
  while (rest.length > 0) {
    s.need(leading + 2)
    let cut = rest.length
    while (cut > 1 && s.font.widthOfTextAtSize(rest.slice(0, cut), size) > W) cut--
    if (cut < rest.length) {
      const sp = rest.lastIndexOf(' ', cut)
      if (sp > 20) cut = sp
    }
    s.text(rest.slice(0, cut), M, { size })
    s.gap(leading)
    rest = rest.slice(cut).trimStart()
  }
}

// The COD terms, verbatim from the work order screen. If the screen's wording
// changes, change it here in the same edit — this is the text a client signs.
const COD_TERMS =
  'By signing below, I acknowledge that I am authorized to approve charges for this session. ' +
  'I accept responsibility for all associated costs and understand that payment is due in full ' +
  'at the time of service unless otherwise agreed. I also acknowledge that Paramount Recording ' +
  'is not responsible for any media, personal items, or equipment left behind.'
const COD_TERMS_2 =
  'No Tapes, CDs, DVDs, Thumb Drives, Computer Drives or other Recording Media will be released ' +
  'until payment in full is received.'

/** Build the work order as a standalone PDF. Returns the raw bytes. */
export async function renderWorkOrderPdf(input: WoPdfInput): Promise<Uint8Array> {
  const { wo, studioRows, rentalRows, paymentRows, totals, blank = false } = input
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const s = new Sheet(doc, font, bold)

  const isCod = blank || String(wo.payment_status || '').toUpperCase() === 'COD'

  // ── Letterhead — the screen's centred branding block ──────────────────────
  s.text('PARAMOUNT RECORDING GROUP', PAGE[0] / 2, { size: 13, bold: true, align: 'center', tracking: 1.1 })
  s.gap(13)
  s.text('Paramount · Encore · Ameraycan · Wilder · Track · Enterprise', PAGE[0] / 2, {
    size: 8, align: 'center',
  })
  s.gap(13)
  s.text('Recording Studios  (323) 465-4000', M, { size: 8 })
  s.text('6245 Santa Monica Blvd, Los Angeles, CA 90038', PAGE[0] / 2, { size: 8, align: 'center' })
  s.text(`Invoice #  ${blank ? '' : (wo.invoice_number || '—')}`, RIGHT, { size: 8, align: 'right' })
  if (blank) s.line(RIGHT - 62, RIGHT, HAIR, 0.5, -2)
  s.gap(16)

  // ── Title line ────────────────────────────────────────────────────────────
  s.text(
    blank ? 'WORK ORDER' : `WORK ORDER${wo.wo_number ? `  ·  ${wo.wo_number}` : ''}`,
    M,
    { size: 12, bold: true, tracking: 0.5 },
  )
  if (blank) {
    s.text('BLANK FORM — NOT A RECORD OF A SESSION', RIGHT, { size: 7.5, bold: true, align: 'right', tracking: 0.6 })
  }
  s.rule(9)

  // ── Who ───────────────────────────────────────────────────────────────────
  // The client panel, flattened. Billing sessions lead with the label; COD
  // sessions lead with the person — the same split the panel makes on screen.
  const isBilling = !blank && String(wo.payment_status || '').toLowerCase() === 'billing'
  band(s, [
    { k: isBilling ? 'Label' : 'Client', v: isBilling ? (wo.label || '') : (wo.client || ''), w: 190 },
    { k: 'Artist', v: wo.artist || '', w: 170 },
    { k: isBilling ? 'A&R / ordered by' : 'Ordered by', v: wo.ordered_by || '', w: 164 },
  ], blank)
  band(s, [
    { k: 'Email', v: wo.email || '', w: 190 },
    { k: 'Phone', v: wo.phone || '', w: 170 },
    {
      k: 'Payment',
      v: blank ? '' : [wo.payment_status || '', wo.cod_method || ''].filter(Boolean).join(' · '),
      w: 164,
    },
  ], blank)

  // ── The work order's own fields ───────────────────────────────────────────
  band(s, [
    { k: 'Session type', v: wo.session_type || '', w: 128 },
    { k: 'Status', v: blank ? '' : (wo.session_status || ''), w: 110 },
    { k: 'Invoice #', v: wo.invoice_number || '', w: 96 },
    {
      k: 'PO #',
      v: blank ? '' : (wo.po_number || (wo.no_po_needed ? 'Not required' : '')),
      w: 106,
    },
    {
      k: 'Food budget',
      v: blank ? '' : (wo.food_budget ? (wo.food_amount ? money(num(wo.food_amount)) : 'Yes') : 'No'),
      w: 84,
    },
  ], blank)

  s.rule(2)

  // ── Studio time ───────────────────────────────────────────────────────────
  // Same twelve columns as the screen, same order. The lock and delete cells
  // are controls, not content, and have no print equivalent.
  // Twelve columns in 524pt. Widths are content-driven (§8: field width follows
  // content) and were set against the worst case in each: "$1,425.00" in the
  // money columns, "10:00 PM" in the times. Do not shave them to fit a new
  // column — drop the column or take the width from Session info, which is the
  // only one that truncates gracefully.
  const stCols: Col[] = [
    { head: 'Studio', w: 38 },
    { head: 'Date', w: 44 },
    // Session info doubles as the STAFF NAME cell on engineer sub-rows, so it
    // gets every point the money columns can spare — a truncated note is a
    // shrug, a truncated name is a question.
    { head: 'Session info', w: 90 },
    { head: 'From', w: 46 },
    { head: 'To', w: 46 },
    { head: 'Hrs', w: 22, align: 'right' },
    { head: 'Type', w: 26 },
    { head: 'Rate', w: 50, align: 'right' },
    { head: 'OT hrs', w: 28, align: 'right' },
    { head: 'OT rate', w: 40, align: 'right' },
    { head: 'OT chg', w: 42, align: 'right' },
    { head: 'Total', w: 52, align: 'right' },
  ]

  const stRows: string[][] = []
  const stSubs: Record<number, string[][]> = {}

  if (blank) {
    for (let i = 0; i < 10; i++) stRows.push(new Array(stCols.length).fill(''))
  } else {
    studioRows.forEach(r => {
      // A standalone staff row carries no studio — on screen it renders as the
      // engineer sub-row ALONE, with no studio line above it. Same here.
      const isEngOnly = !String(r.studio || '').trim()
      const isDayRow = r.row_rate_type === 'day'
      const rowTotal = num(r.charge) + num(r.ot_charge)
      const rowHrs = r.total_hours ?? calcHours(r.from_time || '', r.to_time || '')

      if (!isEngOnly) {
        stRows.push([
          r.studio || '',
          pdfDate(r.date),
          r.session_info || '',
          r.from_time || '',
          r.to_time || '',
          rowHrs != null && rowHrs !== '' ? String(rowHrs) : '',
          // The screen's Day/Hr segment. `rate_daily` is a RATE, not a flag —
          // `row_rate_type` is the only thing that decides which one shows.
          isDayRow ? 'Day' : 'Hr',
          (isDayRow ? r.rate_daily : r.rate) ? String(isDayRow ? r.rate_daily : r.rate) : '',
          r.ot_hours ? String(r.ot_hours) : '',
          r.ot_rate ? String(r.ot_rate) : '',
          cash(r.ot_charge),
          rowTotal ? money(rowTotal) : '',
        ])
      }

      // Engineer / assistant sub-row — visible unless explicitly hidden, which
      // is what `eng_visible: false` means on screen (staff_mode 'none').
      const hasEng = r.eng_visible !== false && (r.eng_name || r.eng_rate || r.eng_hours)
      if (hasEng) {
        // engChargeForRow is the SAME function the screen's per-row figure and
        // computeWoTotals both use — including its clock-over-stored-hours
        // preference. A local copy here is how the document ends up disagreeing
        // with the screen that approved it (CLAUDE.md: money math has one home).
        // No fallback rate: the row's own eng_rate is the only source.
        const engCharge = engChargeForRow(r)
        const engHrs = calcHours(
          r.eng_from_time || r.from_time || '',
          r.eng_to_time || r.to_time || '',
        ) ?? (r.eng_hours ?? null)
        const sub = [
          r.eng_role === 'assistant' ? '2ND' : '1ST',
          isEngOnly ? pdfDate(r.date) : '',
          r.eng_name || '',
          r.eng_from_time || r.from_time || '',
          r.eng_to_time || r.to_time || '',
          engHrs != null && engHrs !== '' ? String(engHrs) : '',
          '',
          r.eng_rate ? String(r.eng_rate) : '',
          '', '', '',
          engCharge ? money(engCharge) : '',
        ]
        if (isEngOnly) { stRows.push(sub) } else { stSubs[stRows.length - 1] = [sub] }
      }
    })
  }

  table(s, 'Studio time', stCols, stRows, {
    subRows: stSubs,
    ruledRows: blank,
    always: true,
    footer: blank
      ? [['Studio', ''], ['Engineering', ''], ['Total', '']]
      : [
          ['Studio', money(totals.studio)],
          ...(totals.engineer > 0 ? ([['Engineering', money(totals.engineer)]] as Array<[string, string]>) : []),
          ['Total', money(totals.studio + totals.engineer)],
        ],
  })

  // ── Rentals ───────────────────────────────────────────────────────────────
  const rentCols: Col[] = [
    { head: 'Qty', w: 38 },
    { head: 'Item', w: 192 },
    { head: 'Supplier', w: 96 },
    { head: 'Date(s) used', w: 84 },
    { head: 'Rate', w: 52, align: 'right' },
    { head: 'Charge', w: 62, align: 'right' },
  ]
  const rentRows = blank
    ? Array.from({ length: 4 }, () => new Array(rentCols.length).fill(''))
    : rentalRows.map(r => [
        r.qty ? String(r.qty) : '',
        r.item || r.description || '',
        r.supplier || '',
        r.dates_used || '',
        r.rate ? String(r.rate) : '',
        cash(r.charge),
      ])

  if (blank || rentRows.length > 0) {
    table(s, 'Rentals', rentCols, rentRows, {
      ruledRows: blank,
      always: blank,
      footer: [['Rentals total', blank ? '' : money(totals.rentals)]],
    })
  }

  // ── Session notes ─────────────────────────────────────────────────────────
  // The client-facing notes only. Booking Notes are marked "Internal only" on
  // the screen and Needs Attention says so in its placeholder — neither prints.
  if (blank || wo.session_notes) {
    s.need(40)
    sectionTitle(s, 'Session notes')
    if (blank) {
      for (let i = 0; i < 4; i++) { s.need(15); s.line(M, RIGHT, HAIR, 0.5, -3.5); s.gap(15) }
      s.gap(4)
    } else {
      paragraph(s, String(wo.session_notes))
      s.gap(6)
    }
  }

  // ── Payments ──────────────────────────────────────────────────────────────
  const payCols: Col[] = [
    { head: 'Type', w: 96 },
    { head: 'Amount', w: 72, align: 'right' },
    { head: 'Memo', w: 296 },
    { head: 'Last four', w: 60 },
  ]
  const payRows = blank
    ? Array.from({ length: 4 }, () => new Array(payCols.length).fill(''))
    : paymentRows.map(r => [
        r.payment_type || r.type || '',
        cash(r.amount),
        r.memo || '',
        r.last_four || '',
      ])

  if (blank || payRows.length > 0) {
    table(s, 'Payments', payCols, payRows, { ruledRows: blank, always: blank })
  }

  // ── Totals — the screen's totals block, same six labels, same order ───────
  s.need(90)
  s.rule(5)
  s.gap(7)
  const totalLine = (k: string, v: string, big = false) => {
    s.need(16)
    s.text(k.toUpperCase(), M, { size: big ? 8.5 : 7.5, bold: big, tracking: 0.6 })
    if (blank) s.line(RIGHT - 110, RIGHT, HAIR, 0.5, -2)
    else s.text(v, RIGHT, { size: big ? 12 : 9.5, bold: big, align: 'right' })
    s.gap(big ? 19 : 15)
  }
  totalLine('Studio total', money(totals.studio))
  if (blank || totals.engineer > 0) totalLine('Eng total', money(totals.engineer))
  totalLine('Rentals total', money(totals.rentals))
  totalLine('Grand total', money(totals.grand), true)
  totalLine('Total paid', money(totals.paid))
  totalLine('Balance due', money(totals.balance), true)

  // ── COD terms + signature ─────────────────────────────────────────────────
  // COD only, exactly as on screen: a billing session is invoiced, not signed
  // for at the desk.
  if (isCod) {
    s.need(120)
    s.rule(6)
    s.gap(7)
    paragraph(s, COD_TERMS, 8, 11)
    s.gap(2)
    paragraph(s, COD_TERMS_2, 8, 11)
    s.gap(10)

    s.need(56)
    const half = (W - 24) / 2
    s.text('PRINT NAME', M, { size: 6.5, bold: true, tracking: 0.6 })
    s.text('DATE', M + half + 24, { size: 6.5, bold: true, tracking: 0.6 })
    s.gap(16)
    if (!blank) {
      s.text(wo.print_name || '', M, { size: 9.5, width: half })
      s.text(wo.signed_date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), M + half + 24, { size: 9.5, width: half })
    }
    s.line(M, M + half, RULE, 0.5, -3)
    s.line(M + half + 24, RIGHT, RULE, 0.5, -3)
    s.gap(26)

    s.text('SIGNATURE', M, { size: 6.5, bold: true, tracking: 0.6 })
    s.gap(26)
    s.line(M, RIGHT, RULE, 0.5, -3)
    s.gap(12)
    // The captured signature is a canvas data URL on the record. It is not
    // drawn as an image here on purpose: a signature rendered from state onto
    // a regenerated document is a signature that can silently change. The
    // acknowledgement below states that one was captured, and when.
    if (!blank && wo.signature_data) {
      s.text('Signature captured electronically on the work order.', M, { size: 7.5 })
      s.gap(12)
    }
  }

  // Page numbers last, once the total is known.
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE[0] - M - 60, y: M - 14, size: 7, font, color: RULE,
    })
  })

  return doc.save()
}

/**
 * THE BLANK WORK ORDER (ruling 2026-08-12).
 *
 * "Just in case we need to create one for a client… I just want to avoid having
 * to create a fake session, go through the whole process to make the work order,
 * and then remember to delete it from the calendar." — Eli
 *
 * Nothing is inserted, nothing is stored, nothing lands on the calendar. It is
 * the paper form, printed from the same description as the real thing, so the
 * two cannot drift apart.
 *
 * THE FORK TO WATCH: this is safe while it is a FORM. If one gets filled in for
 * a real, paid session, that job never enters AR unless the work order is
 * entered properly afterwards. That is the signal it needs to be a real session.
 */
export async function renderBlankWorkOrderPdf(): Promise<Uint8Array> {
  return renderWorkOrderPdf({
    wo: {},
    studioRows: [],
    rentalRows: [],
    paymentRows: [],
    totals: { studio: 0, engineer: 0, rentals: 0, grand: 0, paid: 0, balance: 0 },
    blank: true,
  })
}

/**
 * Staple the invoice onto the end of the work order.
 *
 * Accepts a PDF *or* an image, because the thing billing attaches is whatever
 * QuickBooks or a phone camera produced — Eli: "we also add receipts and
 * pictures to the invoice." An image becomes a full page rather than being
 * rejected, which is the difference between the feature working on a Tuesday
 * and someone going back to email.
 */
export async function mergePackage(
  workOrderPdf: Uint8Array,
  attachment: { bytes: Uint8Array; contentType: string } | null,
): Promise<Uint8Array> {
  if (!attachment) return workOrderPdf

  const out = await PDFDocument.load(workOrderPdf)
  const type = (attachment.contentType || '').toLowerCase()

  if (type.includes('pdf')) {
    const src = await PDFDocument.load(attachment.bytes, { ignoreEncryption: true })
    const copied = await out.copyPages(src, src.getPageIndices())
    copied.forEach(p => out.addPage(p))
  } else if (type.includes('png') || type.includes('jpg') || type.includes('jpeg')) {
    const img = type.includes('png')
      ? await out.embedPng(attachment.bytes)
      : await out.embedJpg(attachment.bytes)
    const page = out.addPage(PAGE)
    // Fit inside the margins without distorting it.
    const scale = Math.min((PAGE[0] - M * 2) / img.width, (PAGE[1] - M * 2) / img.height, 1)
    const w = img.width * scale
    const h = img.height * scale
    page.drawImage(img, { x: (PAGE[0] - w) / 2, y: (PAGE[1] - h) / 2, width: w, height: h })
  }
  // Anything else (a .docx someone dragged in) is skipped rather than fatal:
  // a work order with no invoice attached still beats no file at all.

  return out.save()
}
