// ─────────────────────────────────────────────────────────────────────────────
// SERVER-ONLY: Flo's lead brain — triage + the play. Three callers:
//   · /api/lead-ai            — signed-in staff (dealer outcome → fresh play;
//                               manual re-triage)
//   · /api/inquiry            — every new web inquiry, right after insert
//   · /api/cron/auto-demote   — nightly sweep of untriaged leads (safety net)
// Never import from client code — service-role key path.
//
// THE RULING (Eli 2026-09-07, "19-year-olds at the helm"): the kid never
// decides what matters and never composes from scratch. Flo files each lead —
// PRIORITY (labels, film, multi-day, high budget, known clients → upper
// management, never dealt to the volume queue) or VOLUME (the kids work it) —
// and keeps a current play: why this move, what to say, how to send it. The
// play TEACHES: every play carries its one-line reason, so the method trains
// itself into whoever works the queue. Deterministic code still owns WHO is
// due and WHEN (lib/crm); Flo owns what matters and what to say.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import { serviceDb } from './floBriefing'

const MODEL = 'claude-sonnet-5' // same id rule as floBriefing — never a dated id

export type LeadAIResult =
  | { ok: true; lead_id: number; tier: string }
  | { ok: false; error: string }

/** Triage (or re-triage) one lead and refresh its play. Safe to call
 *  repeatedly; each run reads the full record. Never throws — a lead the AI
 *  couldn't read is still a workable lead (the dealer has a generic play). */
export async function runLeadAI(leadId: number, source: string): Promise<LeadAIResult> {
  const db = serviceDb()
  try {
    const [{ data: leadRows, error: e1 }, { data: activity, error: e2 }] = await Promise.all([
      db.from('leads').select('*').eq('id', leadId).limit(1),
      db.from('lead_activity').select('type, note, created_at').eq('lead_id', leadId)
        .order('created_at', { ascending: false }).limit(25),
    ])
    if (e1) throw e1
    if (e2) throw e2
    const lead = leadRows?.[0]
    if (!lead) throw new Error(`lead ${leadId} not found`)

    // Terminal statuses don't get plays; don't spend the call.
    if (['booked', 'dead', 'leasing'].includes(lead.status)) {
      return { ok: true, lead_id: leadId, tier: lead.ai_tier ?? 'volume' }
    }

    const payload = {
      lead: {
        name: `${lead.fname ?? ''} ${lead.lname ?? ''}`.trim(),
        label: lead.label || null,
        artist: lead.artist_name || null,
        company: lead.company || null,
        status: lead.status,
        source: lead.source,
        booking_type: lead.booking || null,
        billing: lead.billing || null,
        quote: lead.quote || null,
        day_rate: lead.rate_daily || null,
        session_date: lead.session_date || null,
        session_end_date: lead.session_end_date || null,
        location: lead.location || null,
        notes: lead.notes || null,
        has_phone: !!lead.phone,
        has_email: !!lead.email,
        is_known_client: !!lead.client_id,
        last_contact: lead.last_contact || null,
        created_at: lead.created_at,
        current_tier: lead.ai_tier || null,
      },
      activity_newest_first: (activity ?? []).map(a => ({ type: a.type, note: a.note, at: a.created_at })),
      today: new Date().toISOString().slice(0, 10),
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      thinking: { type: 'disabled' }, // read-and-report job, same rule as the briefing
      system: `You triage sales leads for Paramount Recording Studios (four buildings in Hollywood: Paramount, Ameraycan, Encore, Track) and write the next play for whoever works the lead — often a 19-year-old on their first job. You are Flo.

TIER — who handles this lead:
"priority" — upper management takes it. Any of: a record label or known artist, film/photo/event shoot, multi-day hold, budget or quote in the thousands, a returning known client, or anything that reads high-profile. When in doubt between the tiers, choose priority — a whale in the kids' queue costs more than a looky-loo in management's.
"volume" — the everyday queue: single sessions, small budgets, price shoppers, vague inquiries.

HEAT SIGNALS (the studio's standing rules — use them in your reasoning):
HOT: asked for specific dates or availability, requested a quote, mentioned budget, said they want to book, asked about gear or rooms, has a project timeline, returning client. Logistical questions = hot.
WARM: just looking for information, comparing studios, "might record later this year", slow to respond, general questions only, no budget discussed.

THE PLAY — the single next move for this lead, right now:
- "why": one short sentence teaching the reason, plain words. ("Second no-answer — switch to text; calls are easy to ignore.")
- "say": the message to send or the opening line to speak. 1–3 sentences, friendly, plain, no hype, no emoji. Never invent prices, dates, or availability — if a number matters, the play says to check with the office. Reference what THEY said (their notes/activity) so it reads personal.
- "method": "call", "text", or "email" — respecting which contact info exists. Prefer text after a failed call. Never a method whose contact info is missing.

READ THE RECORD: the activity log (newest first) tells you what's been tried. Escalate sensibly: fresh lead → introduce and ask what they're looking to book; no-answers → change channel; stale conversation → revive with something specific from their notes; near their session date → urgency is honest, use it.

OUTPUT — strict JSON, nothing else:
{"tier": "priority"|"volume", "tier_reason": string, "play": {"why": string, "say": string, "method": "call"|"text"|"email"}}
tier_reason: one line, plain. Keep the current_tier unless the record shows new evidence for moving it.`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    })

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('')
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('lead AI returned no JSON')
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      tier?: string
      tier_reason?: string
      play?: { why?: string; say?: string; method?: string }
    }
    const tier = parsed.tier === 'priority' ? 'priority' : 'volume'
    const play = parsed.play && typeof parsed.play === 'object'
      ? {
          why: String(parsed.play.why ?? '').slice(0, 300),
          say: String(parsed.play.say ?? '').slice(0, 600),
          method: ['call', 'text', 'email'].includes(String(parsed.play.method)) ? String(parsed.play.method) : 'call',
        }
      : null

    const { error: e3 } = await db.from('leads').update({
      ai_tier: tier,
      ai_tier_reason: String(parsed.tier_reason ?? '').slice(0, 300) || null,
      ai_play: play,
      ai_play_at: new Date().toISOString(),
    }).eq('id', leadId)
    if (e3) throw e3

    return { ok: true, lead_id: leadId, tier }
  } catch (err) {
    console.error(`lead-ai failed (${source}, lead ${leadId}):`, err)
    await db.from('app_errors').insert({
      message: `Lead AI (${source}, lead ${leadId}): ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000),
      url: '/api/lead-ai',
      meta: { source, lead_id: leadId },
    }).then((): void => undefined, (): void => undefined)
    return { ok: false, error: String(err) }
  }
}

/** Nightly safety net: triage anything that slipped through untriaged.
 *  Capped so a backlog can't blow the cron's time or budget. */
export async function sweepUntriaged(cap = 20): Promise<number> {
  const db = serviceDb()
  const { data } = await db.from('leads')
    .select('id')
    .in('status', ['uncontacted', 'hot', 'warm'])
    .is('ai_tier', null)
    .order('created_at', { ascending: false })
    .limit(cap)
  let done = 0
  for (const row of data ?? []) {
    const r = await runLeadAI(row.id, 'sweep')
    if (r.ok) done++
  }
  return done
}
