import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Node runtime (service-role client); never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SERVER-ONLY service-role client — bypasses RLS, must never reach the browser.
// Lazily created so a missing key returns a clear error instead of crashing the
// module at import time (the old `!` assertion made local dev fail opaquely when
// .env.local lacked SUPABASE_SERVICE_ROLE_KEY).
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
const supabaseAdmin = getSupabaseAdmin()

const MAX_FAILS = 5          // consecutive fails before the FIRST lockout

// ─── Escalating lockout ──────────────────────────────────────────────────────
// Each successive failure past MAX_FAILS locks the IP for longer. The previous
// version locked for a flat 30s AND reset fail_count to 0 on lockout, which
// meant an attacker got 5 fresh attempts every 30 seconds forever — ~600/hour,
// with no escalation. Against a 4-digit PIN shared across ~10 staff accounts
// (a ~1-in-1,000 hit rate per guess) that is a couple of hours' work. On
// 29 July 2026 someone was doing exactly that from ~50 IPs at once.
//
// CAPPED AT 60 MINUTES, DELIBERATELY. An unbounded or 24-hour lock would be
// worse than the attack it prevents: staff at one studio all share that
// location's public IP, so one runner fat-fingering their PIN during a session
// would take the whole room offline for the night with no way back in.
const LOCKOUT_TIERS_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000]

// A quiet period this long clears the counter. This replaces the old
// reset-on-lockout — the distinction is the whole fix. Time since the LAST
// failure is what forgives; surviving a lockout is not.
//
// Six hours is a judgement call between two real costs: too short and an
// attacker just paces themselves to farm free attempts; too long and a staff
// member who mistyped this morning is still escalated tonight. Six hours means
// a mistake during the day is forgotten by the evening session, while an
// attacker gets ~4 attempts per IP per 6 hours instead of 600 per hour.
const DECAY_MS = 6 * 60 * 60_000

// Best-effort client IP. On Vercel, x-forwarded-for's first entry is the client.
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

// Append-only record of every rejected attempt — see the migration for why the
// attempted PIN is deliberately NOT stored.
//
// AWAITED, not fire-and-forget: this runs on serverless, where the function can
// be frozen the moment the response is returned. An un-awaited insert would be
// silently dropped under exactly the load we most want recorded. It costs a few
// milliseconds, and only on a failed login.
async function logFailure(
  ip: string,
  userAgent: string | null,
  outcome: 'incorrect' | 'locked',
) {
  if (!supabaseAdmin) return
  const { error } = await supabaseAdmin
    .from('pin_login_failures')
    .insert({ ip, user_agent: userAgent, outcome })
  // Never let telemetry break authentication — log it and carry on.
  if (error) console.error('[pin] could not record failed attempt:', error.message)
}

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    // Local dev without the service-role key: explain instead of crashing.
    return NextResponse.json(
      { error: 'server_config', message: 'SUPABASE_SERVICE_ROLE_KEY is not set — add it to .env.local (see .env.local.example).' },
      { status: 503 },
    )
  }
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
  const userAgent = req.headers.get('user-agent')
  const now = Date.now()

  // ── Server-side lockout check (DB-backed). ──
  const { data: attempt } = await supabaseAdmin
    .from('pin_login_attempts')
    .select('fail_count, locked_until, updated_at')
    .eq('ip', ip)
    .maybeSingle()

  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > now) {
    const retryAfter = Math.ceil((new Date(attempt.locked_until).getTime() - now) / 1000)
    // Recorded separately from 'incorrect' so the log shows whether the lockout
    // is absorbing attempts or the attacker has learned to pace under it.
    await logFailure(ip, userAgent, 'locked')
    return NextResponse.json(
      { error: 'locked', retry_after: retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  // Time since the last failure forgives the counter — NOT surviving a lockout.
  const lastFailAt = attempt?.updated_at ? new Date(attempt.updated_at).getTime() : 0
  const priorFails = now - lastFailAt > DECAY_MS ? 0 : (attempt?.fail_count ?? 0)

  // ── Verify the PIN (bcrypt compare in Postgres via the service-role RPC). ──
  const { data: matches, error: rpcError } = await supabaseAdmin.rpc('verify_staff_pin', { p_pin: pin })
  if (rpcError) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  const match = Array.isArray(matches) ? matches[0] : matches

  // ── Wrong PIN — the counter only ever goes up (see DECAY_MS). ──
  if (!match) {
    const nextCount = priorFails + 1
    const willLock = nextCount >= MAX_FAILS

    // Which lockout this is for the IP: 0 on the first, then 1, 2, 3… Clamped
    // to the last tier so it plateaus at an hour rather than growing forever.
    const tier = Math.min(nextCount - MAX_FAILS, LOCKOUT_TIERS_MS.length - 1)
    const lockoutMs = willLock ? LOCKOUT_TIERS_MS[Math.max(tier, 0)] : 0

    await supabaseAdmin.from('pin_login_attempts').upsert({
      ip,
      // NEVER reset on lockout. That reset was the bug: it handed an attacker a
      // fresh allowance every 30 seconds and made the escalation unreachable.
      fail_count: nextCount,
      locked_until: willLock ? new Date(now + lockoutMs).toISOString() : null,
      updated_at: new Date(now).toISOString(),
    }, { onConflict: 'ip' })

    await logFailure(ip, userAgent, 'incorrect')

    if (willLock) {
      const retryAfter = Math.ceil(lockoutMs / 1000)
      return NextResponse.json(
        { error: 'locked', retry_after: retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
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

  // Return the role so the login screen knows where to send them. One PIN pad
  // serves everyone: staff land on the dashboard, a runner lands on the runner
  // hub. Read server-side with the service-role client so the browser doesn't
  // need a second round trip before it can redirect.
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('auth_user_id', match.auth_user_id)
    .maybeSingle()

  return NextResponse.json({
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
    role: profile?.role ?? null,
  })
}
