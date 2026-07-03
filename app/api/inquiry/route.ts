import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rateLimit'

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

  return NextResponse.json({ ok: true })
}
