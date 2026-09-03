// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wo-package?id=<work_order_id>[&wo=1]
//
// Returns ONE PDF: the work order, drawn black-and-white, with every page of the
// attached invoice stapled onto the end. `wo=1` returns the work order alone.
//
// THE ONLY PLACE A WORK ORDER BECOMES A DOCUMENT (ruling 2026-08-11). Eli: "the
// only place you ever export a work order is from this billing hub… if you
// needed to make changes you make changes, that saves, and then you hit save and
// download where it regenerates another updated one."
//
// Which means there is NO STORED WORK-ORDER PDF anywhere. Every download is
// built from the live record at the moment you ask for it, so a stale export
// cannot exist. That is worth more than it sounds: the old paper flow's whole
// failure mode was a printed work order that no longer matched the session.
//
// AUTH: the caller's session token is verified and their role checked, THEN the
// service-role client does the reading. Signed-in-and-allowed is the gate; the
// service role is only how the file gets assembled once past it. The route
// never trusts an id on its own — a work order id is guessable enough that an
// unauthenticated fetch would be an invoice leak.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { computeWoTotals } from '@/lib/woTotals'
import { renderWorkOrderPdf, renderBlankWorkOrderPdf, renderExpenseReportPdf, mergePackage } from '@/lib/woPdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

/** Everyone who can see the billing hub or a work order can export one. */
const ALLOWED = ['owner', 'manager', 'billing', 'asst_manager']

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const woOnly = req.nextUrl.searchParams.get('wo') === '1'
  const isBlank = req.nextUrl.searchParams.get('blank') === '1'
  if (!id && !isBlank) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  // ── Gate ──────────────────────────────────────────────────────────────────
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles').select('role').eq('auth_user_id', userData.user.id).limit(1)
  const role = profiles?.[0]?.role
  if (!role || !ALLOWED.includes(role)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  }

  // ── The blank form (ruling 2026-08-12) ────────────────────────────────────
  // The paper work order, replaced. It reads nothing and writes nothing — no
  // booking, no work order, no calendar entry, no snapshot. It exits here,
  // BEFORE any of the loading and archiving below, which is the whole point:
  // there is no record for it to be a record OF.
  //
  // It still passes the gate above. A blank form carries the letterhead and the
  // COD terms, so it is company paper, not a public asset.
  if (isBlank) {
    const bytes = await renderBlankWorkOrderPdf()
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Blank work order.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  // Unreachable — the top of the handler already rejects a missing id for every
  // non-blank request. It is here so `id` narrows to string for the reads below.
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  const { data: wos, error } = await supabaseAdmin
    .from('work_orders').select('*').eq('id', id).limit(1)
  if (error || !wos?.[0]) {
    return NextResponse.json({ error: 'Work order not found.' }, { status: 404 })
  }
  const wo = wos[0]

  const [st, rent, pay] = await Promise.all([
    supabaseAdmin.from('studio_time_rows').select('*').eq('work_order_id', id).order('sort_order'),
    supabaseAdmin.from('rental_rows').select('*').eq('work_order_id', id).order('sort_order'),
    supabaseAdmin.from('payment_rows').select('*').eq('work_order_id', id),
  ])

  const studioRows = st.data ?? []
  const rentalRows = rent.data ?? []
  const paymentRows = pay.data ?? []

  // The session's VENUE, for the studio column ("PRS A", not "A"). Studio-time
  // rows store only a room letter and leave `location` blank when it matches the
  // session's, so the booking is the only place the venue lives. Display only —
  // it touches no money.
  let venue: string | null = null
  if (wo.booking_id) {
    const { data: bks } = await supabaseAdmin
      .from('bookings').select('location').eq('id', wo.booking_id).limit(1)
    venue = (bks?.[0] as any)?.location ?? null
  }

  // NO `fallbackEngRate` (2026-08-13). The engineer's rate lives in
  // `studio_time_rows.eng_rate` and nowhere else — `bookings.engineer_rate` is a
  // vestigial column from the deleted booking form and nothing writes it. See
  // the note in lib/billing.fetchInvoices; a fallback here would let a stale
  // pre-rebuild rate print a charge the work order does not have.
  //
  // The SAME totals function the work order screen displays. Two implementations
  // of this arithmetic is how a PDF ends up disagreeing with the screen that
  // approved it — see lib/woTotals for why it was extracted in the first place.
  const totals = computeWoTotals({ studioRows, rentalRows, paymentRows })

  // ── Build ─────────────────────────────────────────────────────────────────
  // NAMED FAILURES (2026-09-03 — the "Could not build the PDF (500)" error).
  // Nothing caught a renderer throw, so any build problem reached the client
  // as an anonymous 500 nobody could act on. The client already displays
  // `body.error`; from here on it says WHAT failed (same law as the login
  // screen: a message may only claim what it knows).
  try {
  const woPdf = await renderWorkOrderPdf({
    wo: { ...wo, location: venue },
    studioRows, rentalRows, paymentRows, totals,
  })

  let attachment: { bytes: Uint8Array; contentType: string } | null = null
  if (!woOnly && wo.invoice_doc_path) {
    const dl = await supabaseAdmin.storage.from('invoices').download(wo.invoice_doc_path)
    if (dl.data) {
      attachment = {
        bytes: new Uint8Array(await dl.data.arrayBuffer()),
        contentType: dl.data.type || (wo.invoice_doc_path.endsWith('.pdf') ? 'application/pdf' : ''),
      }
    }
  }

  // ── Food-budget expense report (2026-08-24) ───────────────────────────────
  // When the session carried a food budget, the paper sheet the label used to
  // get is stapled to the END of the full package: the B&W expense table plus
  // every receipt PHOTO as its own captioned page. This is what retired the
  // splay-the-receipts-on-the-scanner ritual — the runner photographs each
  // receipt at the desk and the package assembles itself here.
  // Full package only (`wo=1` is the convenience export). A failed receipt
  // download skips that photo rather than failing the file.
  let expenseReport: Uint8Array | null = null
  if (!woOnly && wo.food_budget) {
    const { data: expRows } = await supabaseAdmin
      .from('wo_expenses').select('*').eq('work_order_id', id).order('sort_order')
    if (expRows && expRows.length > 0) {
      const receipts: { bytes: Uint8Array; contentType: string; caption: string }[] = []
      for (const e of expRows) {
        if (!e.receipt_path) continue
        const dl = await supabaseAdmin.storage.from('checklist-photos').download(e.receipt_path)
        if (dl.data) {
          receipts.push({
            bytes: new Uint8Array(await dl.data.arrayBuffer()),
            contentType: dl.data.type || (e.receipt_path.endsWith('.png') ? 'image/png' : 'image/jpeg'),
            caption: [e.place, e.amount].filter(Boolean).join(' · ') || e.date || '',
          })
        }
      }
      expenseReport = await renderExpenseReportPdf({
        wo,
        expenses: expRows.map((e: any) => ({ date: e.date ?? '', place: e.place ?? '', amount: e.amount ?? '' })),
        receipts,
      })
    }
  }

  const merged = await mergePackage(woPdf, attachment, expenseReport)

  // KEEP WHAT WENT OUT (ruling 2026-08-11). The exact bytes being handed over
  // are stored, so the package window can later show the ARTIFACT rather than
  // re-rendering today's work order. Without this, reviewing a sent package
  // shows you a document that may never have existed.
  //
  // Only for the real package — `wo=1` is a convenience export from the work
  // order screen, not something that goes to a client.
  //
  // NON-FATAL on failure: the person asked for a file. Refusing to hand it over
  // because the archive copy failed would trade the thing they need for the
  // thing we would like.
  if (!woOnly) {
    const path = `${id}/package-${Date.now()}.pdf`
    const up = await supabaseAdmin.storage
      .from('invoices')
      .upload(path, Buffer.from(merged), { contentType: 'application/pdf', upsert: false })
    if (!up.error) {
      // Remove the previous snapshot AFTER the new one lands, so a failed
      // upload never leaves the row pointing at nothing.
      const old = wo.invoice_package_path
      await supabaseAdmin.from('work_orders').update({ invoice_package_path: path }).eq('id', id)
      if (old && old !== path) await supabaseAdmin.storage.from('invoices').remove([old])
    }
  }

  // Filename billing can recognise in a Downloads folder without opening it.
  const who = String(wo.label || wo.client || 'Work order').replace(/[^\w\- ]+/g, '').trim() || 'Work order'
  const num = wo.invoice_number || wo.wo_number || ''
  const name = `${who}${num ? ` ${num}` : ''}${woOnly ? ' WO' : ''}.pdf`.replace(/\s+/g, ' ')

  return new NextResponse(Buffer.from(merged), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[wo-package] build failed:', msg)
    return NextResponse.json({ error: `PDF build failed: ${msg}` }, { status: 500 })
  }
}
