import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rateLimit'
import { sendMail, esc } from '@/lib/sendMail'

// Node runtime (service-role client); never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SERVER-ONLY service-role client — bypasses RLS, must never reach the browser.
// This is the ONLY insert path for Web Inquiry leads (the anon leads-INSERT
// policy is dropped in a companion migration), so the per-IP rate limit here
// cannot be bypassed by hitting the table directly.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// Basic email shape check (mirrors the client-side validation).
function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Best-effort client IP. On Vercel, x-forwarded-for's first entry is the client.
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  // ── Rate limit: 3 requests per minute per IP. ──
  const { allowed } = await checkRateLimit(supabaseAdmin, 'inquiry', ip, 3, 60_000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429 }
    )
  }

  let body: {
    fname?: unknown
    lname?: unknown
    email?: unknown
    phone?: unknown
    notes?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const fname = typeof body.fname === 'string' ? body.fname.trim() : ''
  const lname = typeof body.lname === 'string' ? body.lname.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  if (!fname || !lname || !email || !phone) {
    return NextResponse.json({ error: 'Please fill in all required fields.' }, { status: 400 })
  }
  if (!validEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('leads').insert({
    fname,
    lname,
    email,
    phone,
    notes: notes || null,
    status: 'uncontacted',
    source: 'Web Inquiry',
    created_at: new Date().toISOString(),
  })

  if (error) {
    console.error('inquiry insert failed:', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }

  // ── Alert the team ────────────────────────────────────────────────────────
  // AFTER the insert, and awaited but never checked. The lead is the thing that
  // matters: if the mail provider is down, a lead that saved without an email is
  // a missed notification, but a lead lost because mail failed is a lost
  // customer. `sendMail` swallows its own errors and logs them.
  //
  // Awaited rather than fire-and-forget because a serverless function can be
  // frozen the moment it returns a response — a dangling promise may simply
  // never run.
  {
    // Defaults to the shared inbox, so this needs no new configuration to work.
    // Set INQUIRY_ALERT_TO (comma-separated) to send somewhere else.
    const alertTo = (process.env.INQUIRY_ALERT_TO || 'info@paramountrecording.com')
      .split(',').map(a => a.trim()).filter(Boolean)
    const name = `${fname} ${lname}`
    await sendMail({
      to: alertTo,
      // The name is in the subject so it's readable from a phone's lock screen
      // without opening anything — that is the whole job of this email.
      subject: `New inquiry — ${name}`,
      // Reply goes to the customer, not to a noreply address.
      replyTo: email,
      text:
        `New studio inquiry\n\n` +
        `Name:  ${name}\n` +
        `Email: ${email}\n` +
        `Phone: ${phone}\n` +
        (notes ? `\nNotes:\n${notes}\n` : '') +
        `\nThis lead is in the CRM under Needs Action.`,
      html: `
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1b1a17">
          <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b6a66;margin:0 0 10px">
            Paramount Recording Group
          </p>
          <h2 style="margin:0 0 14px;font-size:20px">New studio inquiry</h2>
          <table cellpadding="0" cellspacing="0" style="font-size:15px">
            <tr><td style="padding:2px 14px 2px 0;color:#6b6a66">Name</td><td><strong>${esc(name)}</strong></td></tr>
            <tr><td style="padding:2px 14px 2px 0;color:#6b6a66">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
            <tr><td style="padding:2px 14px 2px 0;color:#6b6a66">Phone</td><td><a href="tel:${esc(phone)}">${esc(phone)}</a></td></tr>
          </table>
          ${notes ? `<p style="margin:14px 0 0;white-space:pre-wrap">${esc(notes)}</p>` : ''}
          <p style="margin:20px 0 0;font-size:13px;color:#6b6a66">
            This lead is already in the CRM under Needs Action.
          </p>
        </div>`,
    })
  }

  return NextResponse.json({ ok: true })
}
