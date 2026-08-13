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
// If you add a section to the work order screen, ADD IT HERE TOO.
//
// Deliberately plain: Helvetica, black on white, hairline rules. This is a
// billing document, not a brochure — and a label's accounts payable department
// is going to print it in mono anyway.
// ─────────────────────────────────────────────────────────────────────────────

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type WoPdfRow = Record<string, any>

export type WoPdfInput = {
  wo: Record<string, any>
  studioRows: WoPdfRow[]
  rentalRows: WoPdfRow[]
  paymentRows: WoPdfRow[]
  totals: { studio: number; engineer: number; rentals: number; grand: number; paid: number; balance: number }
}

const PAGE: [number, number] = [612, 792] // US Letter, portrait
const M = 44                              // margin
const BLACK = rgb(0, 0, 0)
const RULE = rgb(0.72, 0.72, 0.72)

const money = (n: number) =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

  text(s: string, x: number, opts: { size?: number; bold?: boolean; width?: number; align?: 'left' | 'right' } = {}) {
    const size = opts.size ?? 9
    const font = opts.bold ? this.bold : this.font
    let str = s ?? ''
    // Hard-truncate rather than wrap: every column here is a label or a figure,
    // and a wrapped cell would break the row grid the reader is scanning down.
    if (opts.width) {
      while (str.length > 1 && font.widthOfTextAtSize(str, size) > opts.width) str = str.slice(0, -1)
    }
    const w = font.widthOfTextAtSize(str, size)
    this.page.drawText(str, {
      x: opts.align === 'right' ? x - w : x,
      y: this.y,
      size,
      font,
      color: BLACK,
    })
  }

  rule(gap = 6) {
    this.y -= gap
    this.page.drawLine({
      start: { x: M, y: this.y },
      end: { x: PAGE[0] - M, y: this.y },
      thickness: 0.5,
      color: RULE,
    })
    this.y -= gap
  }

  gap(n: number) { this.y -= n }
}

const W = PAGE[0] - M * 2
const RIGHT = PAGE[0] - M

/** A label/value pair rendered as one line. */
function kv(s: Sheet, pairs: Array<[string, string]>) {
  const col = W / pairs.length
  pairs.forEach(([k, v], i) => {
    const x = M + col * i
    s.text(k.toUpperCase(), x, { size: 6.5, bold: true, width: col - 8 })
  })
  s.gap(11)
  pairs.forEach(([, v], i) => {
    const x = M + col * i
    s.text(v || '—', x, { size: 9.5, width: col - 8 })
  })
  s.gap(15)
}

function table(
  s: Sheet,
  title: string,
  cols: Array<{ head: string; w: number; align?: 'right' }>,
  rows: string[][],
  footer?: [string, string],
) {
  if (rows.length === 0 && !footer) return
  s.need(46)
  s.text(title.toUpperCase(), M, { size: 7.5, bold: true })
  s.gap(12)

  // GUTTER. Right-aligned cells used to draw to the column's exact right edge,
  // which is the next column's left edge — so "OT" and "ENGINEER" printed as
  // "OTENGINEER" (Eli, 2026-08-11). Every cell now keeps a gutter, and the
  // truncation width matches it so nothing can grow back into the gap.
  const GUT = 8
  const cellX = (x: number, c: { w: number; align?: 'right' }) =>
    c.align === 'right' ? x + c.w - GUT : x

  const drawHead = (sh: Sheet) => {
    let x = M
    cols.forEach(c => {
      sh.text(c.head.toUpperCase(), cellX(x, c), {
        size: 6.5, bold: true, align: c.align, width: c.w - GUT,
      })
      x += c.w
    })
    sh.rule(5)
  }
  drawHead(s)
  // Repeat the header on every continuation page — a table's second page with
  // no headings is a grid of unlabelled numbers.
  s.onNewPage = sh => { sh.text(title.toUpperCase(), M, { size: 7.5, bold: true }); sh.gap(12); drawHead(sh) }

  for (const r of rows) {
    s.need(15)
    let x = M
    cols.forEach((c, i) => {
      s.text(r[i] ?? '', cellX(x, c), { size: 8.5, align: c.align, width: c.w - GUT })
      x += c.w
    })
    s.gap(13)
  }
  s.onNewPage = () => {}

  if (footer) {
    s.rule(4)
    s.text(footer[0].toUpperCase(), M, { size: 7, bold: true })
    s.text(footer[1], RIGHT, { size: 9, bold: true, align: 'right' })
    s.gap(16)
  } else {
    s.gap(6)
  }
}

/** Build the work order as a standalone PDF. Returns the raw bytes. */
export async function renderWorkOrderPdf(input: WoPdfInput): Promise<Uint8Array> {
  const { wo, studioRows, rentalRows, paymentRows, totals } = input
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const s = new Sheet(doc, font, bold)

  // ── Letterhead ────────────────────────────────────────────────────────────
  s.text('PARAMOUNT RECORDING STUDIOS', M, { size: 14, bold: true })
  s.text(wo.wo_number ? `WORK ORDER ${wo.wo_number}` : 'WORK ORDER', RIGHT, { size: 9, bold: true, align: 'right' })
  s.gap(13)
  s.text('6245 Santa Monica Blvd, Los Angeles, CA 90038', M, { size: 8 })
  if (wo.invoice_number) s.text(`Invoice ${wo.invoice_number}`, RIGHT, { size: 8, align: 'right' })
  s.rule(9)

  // ── Who and when ──────────────────────────────────────────────────────────
  kv(s, [
    ['Client', wo.label || wo.client || '—'],
    ['Artist', wo.artist || '—'],
    ['Ordered by', wo.ordered_by || '—'],
  ])
  kv(s, [
    ['Session date', wo.session_date || '—'],
    ['Payment', wo.payment_status || '—'],
    ['PO number', wo.po_number || (wo.no_po_needed ? 'Not required' : '—')],
  ])
  s.rule(2)

  // ── Studio time ───────────────────────────────────────────────────────────
  table(
    s,
    'Studio time',
    [
      { head: 'Date', w: 64 },
      { head: 'Room', w: 40 },
      { head: 'From', w: 56 },
      { head: 'To', w: 56 },
      { head: 'Hrs', w: 36, align: 'right' },
      { head: 'Rate', w: 52, align: 'right' },
      { head: 'OT', w: 52, align: 'right' },
      { head: 'Engineer', w: 90 },
      { head: 'Charge', w: 78, align: 'right' },
    ],
    studioRows.map(r => [
      r.date || '',
      r.studio || '',
      r.from_time || '',
      r.to_time || '',
      r.total_hours != null ? String(r.total_hours) : '',
      r.rate ? String(r.rate) : '',
      r.ot_charge ? money(r.ot_charge) : '',
      r.eng_name || '',
      money(Number(r.charge || 0) + Number(r.ot_charge || 0)),
    ]),
    ['Studio subtotal', money(totals.studio)],
  )

  if (totals.engineer > 0) {
    s.need(18)
    s.text('ENGINEERING', M, { size: 7, bold: true })
    s.text(money(totals.engineer), RIGHT, { size: 9, bold: true, align: 'right' })
    s.gap(16)
  }

  // ── Rentals ───────────────────────────────────────────────────────────────
  if (rentalRows.length > 0) {
    table(
      s,
      'Equipment rentals',
      [{ head: 'Item', w: W - 90 }, { head: 'Charge', w: 90, align: 'right' }],
      rentalRows.map(r => [r.item || r.description || '', money(r.charge)]),
      ['Rentals subtotal', money(totals.rentals)],
    )
  }

  // ── The money ─────────────────────────────────────────────────────────────
  s.rule(4)
  s.need(52)
  const line = (k: string, v: string, big = false) => {
    s.text(k.toUpperCase(), M, { size: big ? 8.5 : 7.5, bold: big })
    s.text(v, RIGHT, { size: big ? 12 : 9.5, bold: big, align: 'right' })
    s.gap(big ? 20 : 15)
  }
  line('Total', money(totals.grand))
  line('Paid', money(totals.paid))
  line('Balance due', money(totals.balance), true)

  // ── Payments ──────────────────────────────────────────────────────────────
  if (paymentRows.length > 0) {
    table(
      s,
      'Payments received',
      [
        { head: 'Type', w: 96 },
        { head: 'Last four', w: 74 },
        { head: 'Memo', w: W - 96 - 74 - 90 },
        { head: 'Amount', w: 90, align: 'right' },
      ],
      paymentRows.map(r => [r.type || '', r.last_four || '', r.memo || '', money(r.amount)]),
    )
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  const notes = [wo.session_notes, wo.booking_notes].filter(Boolean).join('  •  ')
  if (notes) {
    s.need(30)
    s.text('NOTES', M, { size: 7.5, bold: true })
    s.gap(12)
    // Crude wrap at the page width — notes are the one free-text field here, so
    // truncating them the way table cells are truncated would lose meaning.
    let rest = String(notes)
    while (rest.length > 0) {
      s.need(13)
      let cut = rest.length
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), 8.5) > W) cut--
      if (cut < rest.length) {
        const sp = rest.lastIndexOf(' ', cut)
        if (sp > 20) cut = sp
      }
      s.text(rest.slice(0, cut), M, { size: 8.5 })
      s.gap(12)
      rest = rest.slice(cut).trimStart()
    }
    s.gap(6)
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  if (wo.print_name) {
    s.need(34)
    s.rule(6)
    s.text(`Signed: ${wo.print_name}`, M, { size: 8.5 })
    s.gap(14)
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
