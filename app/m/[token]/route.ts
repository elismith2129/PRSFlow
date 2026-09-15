// ─────────────────────────────────────────────────────────────────────────────
// GET /m/<token> — the login-free copy of a memo, for the newsletter's
// "Read the full memo" button (Eli, 2026-09-15: owners aren't on the app).
//
// The token is 48 hex chars minted by /api/memo-email and never listed
// anywhere; it is the whole gate, exactly like a newsletter's "view in
// browser" link. Archived memos still open — an old email keeps working.
// No signing here: signatures are collected in the app.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { renderPublicMemo } from '@/lib/server/memoEmail'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!/^[a-f0-9]{48}$/.test(token)) return new NextResponse('Not found', { status: 404 })
  const { data } = await supabaseAdmin
    .from('memos').select('id, title, kind, body_html, audience, requires_ack, sent_by_name, sent_at')
    .eq('email_token', token).limit(1)
  const memo = data?.[0]
  if (!memo) return new NextResponse('Not found', { status: 404 })
  return new NextResponse(renderPublicMemo(memo), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
