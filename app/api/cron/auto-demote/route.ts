import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Lead } from '@/lib/supabase'
import { overdueDays, isParked } from '@/lib/crm'
import { DEMOTE_AFTER_OVERDUE_DAYS } from '@/lib/settings'
import { sweepUntriaged } from '@/lib/server/leadAI'

// 60 is the safe ceiling on every Vercel plan — so the sweep below is capped
// at 8 leads/night (~3s per model call). New inquiries triage inline at the
// door, so the sweep only ever chews old backlog, 8 at a time.
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-DEMOTE, rewritten 2026-09-07 (Eli ruling: decay surfaces, never hides).
// The old cron demoted the moment keep_hot_until expired and handed the
// demoted lead a fresh +3d timer — so a neglected lead spent its whole life
// invisible and went cold without anyone being told. Now:
//   · a due lead sits VISIBLY in the CRM's Due lane, escalating ("overdue Nd")
//   · only after DEMOTE_AFTER_OVERDUE_DAYS ignored does it drop a temperature
//   · hot→warm resets keep_hot_until to NOW — the lead lands DUE in the warm
//     lane immediately (visible), and the overdue clock restarts so it gets
//     the same visible grace before going cold
//   · warm→cold clears the timer; cold feeds the weekly re-engage roundup
//   · every demotion writes a lead_activity entry (type 'system') and is
//     reported by Flo's morning briefing
//   · parked leads (parked_until in the future) are never demoted — parking
//     is a deliberate human act
// Predicates come from lib/crm — the same math the CRM page renders, so the
// cron can never disagree with what staff saw on screen.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = new Date().toISOString()

  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .in('status', ['hot', 'warm'])
    if (error) throw error

    const leads = (data ?? []) as Lead[]
    const demoted: { id: number; from: string; to: string; name: string; overdue: number }[] = []

    for (const l of leads) {
      if (isParked(l)) continue
      const od = overdueDays(l)
      if (od < DEMOTE_AFTER_OVERDUE_DAYS) continue

      const isHot = l.status === 'hot'
      const patch = isHot
        ? { status: 'warm', keep_hot_until: now } // due NOW in the warm lane — visible, clock restarted
        : { status: 'cold', keep_hot_until: null } // cold: no cadence; the weekly roundup owns it
      const { error: e1 } = await supabase.from('leads').update(patch).eq('id', l.id)
      if (e1) { console.error(`auto-demote: lead ${l.id} update failed`, e1); continue }

      const name = [l.label, `${l.fname ?? ''} ${l.lname ?? ''}`.trim()].filter(Boolean).join(' / ') || `Lead ${l.id}`
      const note = isHot
        ? `Flo - Demoted Hot → Warm - ${od}d overdue`
        : `Flo - Demoted Warm → Cold - ${od}d overdue`
      const { error: e2 } = await supabase.from('lead_activity').insert({ lead_id: l.id, type: 'system', note })
      if (e2) console.error(`auto-demote: lead ${l.id} activity insert failed`, e2)

      demoted.push({ id: l.id, from: l.status, to: patch.status, name, overdue: od })
    }

    // Triage safety net: anything that slipped through untriaged (manual
    // leads created while the API was down, pre-migration rows) gets Flo's
    // read overnight. Capped inside; never fails the demote pass.
    const triaged = await sweepUntriaged(8)

    return NextResponse.json({
      success: true,
      timestamp: now,
      demoted_hot_to_warm: demoted.filter(d => d.from === 'hot').length,
      demoted_warm_to_cold: demoted.filter(d => d.from === 'warm').length,
      demoted,
      triaged,
    })
  } catch (error: any) {
    console.error('Auto-demote cron error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
