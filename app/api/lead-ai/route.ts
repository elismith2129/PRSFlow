import { NextResponse } from 'next/server'
import { serviceDb } from '@/lib/server/floBriefing'
import { runLeadAI } from '@/lib/server/leadAI'

// Signed-in staff ask Flo to (re)read one lead — the dealer calls this after
// every outcome so the NEXT deal of that lead carries a fresh play, and the
// CRM calls it after a manual lead is created. Auth mirrors
// /api/flo-briefing-now: a real Supabase access token proves a person; any
// active staff profile qualifies (working leads is the whole staff's job).

export const maxDuration = 60

export async function POST(request: Request) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const db = serviceDb()
  const { data: userData, error: authErr } = await db.auth.getUser(token)
  const email = userData?.user?.email
  if (authErr || !email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data: profiles } = await db
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .is('deleted_at', null)
    .limit(1)
  if (!profiles?.length) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

  let body: { lead_id?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const leadId = Number(body.lead_id)
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
  }

  const result = await runLeadAI(leadId, 'staff')
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
