import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rateLimit'

// First-party error sink (Phase 0 audit fix). Writes client-reported errors to
// app_errors via the service role. Fire-and-forget from the client; always
// returns 204 so the reporter never retries or surfaces its own failures.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(req: NextRequest) {
  const supa = admin()
  if (!supa) return new NextResponse(null, { status: 204 })
  try {
    // Cap the flood: 30 reports/min per IP (internal tool; loops can spray).
    const { allowed } = await checkRateLimit(supa, 'log-error', clientIp(req), 30, 60_000)
    if (!allowed) return new NextResponse(null, { status: 204 })

    const body = await req.json().catch((): null => null)
    if (!body || typeof body.message !== 'string') return new NextResponse(null, { status: 204 })

    await supa.from('app_errors').insert({
      message: String(body.message).slice(0, 1000),
      stack: typeof body.stack === 'string' ? body.stack.slice(0, 4000) : null,
      url: typeof body.url === 'string' ? body.url.slice(0, 300) : null,
      meta: body.meta && typeof body.meta === 'object' ? body.meta : null,
      user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
    })
  } catch {
    // Never fail loudly — this is the error reporter.
  }
  return new NextResponse(null, { status: 204 })
}
