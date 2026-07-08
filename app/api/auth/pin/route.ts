import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Node runtime (service-role client); never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SERVER-ONLY service-role client — bypasses RLS, must never reach the browser.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const MAX_FAILS = 5          // failed attempts before lockout
const LOCKOUT_MS = 30_000    // 30-second lockout (mirrors the UI)

// Best-effort client IP. On Vercel, x-forwarded-for's first entry is the client.
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(req: NextRequest) {
  let body: { pin?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // Validate shape only — never log or echo the PIN itself.
  const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const ip = clientIp(req)
  const now = Date.now()

  // ── Server-side lockout check (DB-backed). ──
  const { data: attempt } = await supabaseAdmin
    .from('pin_login_attempts')
    .select('fail_count, locked_until')
    .eq('ip', ip)
    .maybeSingle()

  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > now) {
    const retryAfter = Math.ceil((new Date(attempt.locked_until).getTime() - now) / 1000)
    return NextResponse.json({ error: 'locked', retry_after: retryAfter }, { status: 429 })
  }

  // ── Verify the PIN (bcrypt compare in Postgres via the service-role RPC). ──
  const { data: matches, error: rpcError } = await supabaseAdmin.rpc('verify_staff_pin', { p_pin: pin })
  if (rpcError) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  const match = Array.isArray(matches) ? matches[0] : matches

  // ── Wrong PIN — increment counter; lock after MAX_FAILS consecutive fails. ──
  if (!match) {
    const nextCount = (attempt?.fail_count ?? 0) + 1
    const willLock = nextCount >= MAX_FAILS
    await supabaseAdmin.from('pin_login_attempts').upsert({
      ip,
      fail_count: willLock ? 0 : nextCount,
      locked_until: willLock ? new Date(now + LOCKOUT_MS).toISOString() : null,
      updated_at: new Date(now).toISOString(),
    }, { onConflict: 'ip' })

    if (willLock) {
      return NextResponse.json({ error: 'locked', retry_after: Math.ceil(LOCKOUT_MS / 1000) }, { status: 429 })
    }
    return NextResponse.json({ error: 'incorrect' }, { status: 401 })
  }

  // Correct PIN — clear this IP's failure counter.
  await supabaseAdmin.from('pin_login_attempts').delete().eq('ip', ip)

  // Valid PIN but no usable auth credentials yet (e.g. the runner, or a profile
  // whose password hasn't been provisioned by scripts/set-staff-passwords.mjs) —
  // fail cleanly instead of attempting a sign-in.
  if (!match.auth_user_id || !match.supabase_password) {
    return NextResponse.json({ error: 'no_account' }, { status: 403 })
  }

  // ── Single-step session mint: sign in with the server-stored password.
  //    Uses a DEDICATED anon-key client (NOT supabaseAdmin) — signInWithPassword
  //    makes its client adopt the user's session, which would poison the shared
  //    service-role client's later RLS-bypassing queries. The browser adopts the
  //    returned session via setSession() with no further OTP exchange. ──
  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data: signInData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
    email: match.email,
    password: match.supabase_password,
  })
  if (signInError || !signInData?.session) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  return NextResponse.json({
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
  })
}
