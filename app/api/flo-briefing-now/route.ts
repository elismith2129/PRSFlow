import { NextResponse } from 'next/server'
import { generateFloBriefing, serviceDb } from '@/lib/server/floBriefing'

// "BRIEF ME NOW" (Eli, 2026-09-07: "can [we] fire it whenever we want?") —
// the dashboard button's endpoint. Same generator as the 8:50 cron; the
// difference is WHO may call it: a signed-in owner, manager or billing user,
// proven by their Supabase access token (the browser sends it, so Vercel's
// bot firewall — which eats curl — never enters the picture).
//
// Always force-regenerates: pressing the button MEANS "read the room again".
// Cost is one Sonnet call — pennies — and the realtime channel delivers the
// fresh row to every open dashboard.

export const maxDuration = 60

export async function POST(request: Request) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const db = serviceDb()
  const { data: userData, error: authErr } = await db.auth.getUser(token)
  const email = userData?.user?.email
  if (authErr || !email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Email is the profile lookup key (the useUserProfile convention).
  const { data: profiles } = await db
    .from('user_profiles')
    .select('role')
    .eq('email', email)
    .is('deleted_at', null)
    .limit(1)
  const role = profiles?.[0]?.role
  if (!role || !['owner', 'manager', 'billing'].includes(role)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const result = await generateFloBriefing({ force: true, source: 'button' })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
