// ─────────────────────────────────────────────────────────────────────────────
// POST /api/memo-email — mail a memo to the office as a newsletter.
//
// Gate: a signed-in owner or manager (the same people who can send memos).
// Recipients: every active profile whose role is in MEMO_MAIL_ROLES, by the
// profile's email. Runners never get mail — they sign in the app.
//
// Mints the memo's email_token on first send (login-free page at /m/<token>),
// sends one mail per recipient through lib/sendMail (soft failure), and
// stamps emailed_at + email_to on the memo. Re-sending is allowed — an edited
// list, a bounced address — and just re-stamps.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { sendMail } from '@/lib/sendMail'
import { buildMemoEmail, MEMO_MAIL_ROLES, type MemoForMail } from '@/lib/server/memoEmail'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { data: me } = await supabaseAdmin.from('user_profiles').select('role').eq('auth_user_id', userData.user.id).limit(1)
  const role = me?.[0]?.role
  if (role !== 'owner' && role !== 'manager') return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })

  let body: { memo_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const memoId = String(body.memo_id ?? '')
  if (!memoId) return NextResponse.json({ error: 'Missing memo_id' }, { status: 400 })

  const { data: memos, error: mErr } = await supabaseAdmin.from('memos').select('*').eq('id', memoId).limit(1)
  const memo = memos?.[0]
  if (mErr || !memo) return NextResponse.json({ error: 'Memo not found.' }, { status: 404 })

  // Token: minted once, kept for life — the link in an old email keeps working.
  let emailToken: string = memo.email_token
  if (!emailToken) {
    emailToken = randomBytes(24).toString('hex')
    const { error } = await supabaseAdmin.from('memos').update({ email_token: emailToken }).eq('id', memoId)
    if (error) return NextResponse.json({ error: `Could not prepare the link: ${error.message}` }, { status: 500 })
  }

  const { data: people } = await supabaseAdmin
    .from('user_profiles').select('email, display_name, role')
    .in('role', MEMO_MAIL_ROLES).is('deleted_at', null)
  const recipients = (people ?? []).map(p => String(p.email ?? '').trim()).filter(e => /@/.test(e))
  if (recipients.length === 0) return NextResponse.json({ error: 'No office emails on file.' }, { status: 400 })

  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const mail = buildMemoEmail({ ...(memo as MemoForMail), email_token: emailToken }, origin)

  const sent: string[] = []
  const failed: { email: string; reason: string }[] = []
  for (const to of recipients) {
    const r = await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text })
    if (r.ok) sent.push(to); else failed.push({ email: to, reason: (r as { ok: false; reason: string }).reason })
  }

  if (sent.length > 0) {
    await supabaseAdmin.from('memos').update({ emailed_at: new Date().toISOString(), email_to: sent }).eq('id', memoId)
  }
  return NextResponse.json({ sent, failed, link: `${origin}/m/${emailToken}` }, { status: sent.length > 0 ? 200 : 502 })
}
