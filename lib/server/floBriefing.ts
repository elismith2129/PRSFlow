// ─────────────────────────────────────────────────────────────────────────────
// SERVER-ONLY: Flo's briefing generator. Two callers, one brain:
//   · /api/cron/flo-briefing      — the 8:50 Vercel cron (CRON_SECRET)
//   · /api/flo-briefing-now       — the dashboard's "Brief me now" button
//                                   (signed-in owner/manager/billing; added
//                                   2026-09-07 because Vercel's bot firewall
//                                   challenges curl, and a button is better
//                                   anyway)
// Never import this from client code — it holds the service-role key path.
//
// THE VOICE RULING: just the facts. The prompt below IS Flo's personality —
// edit it here, not by post-processing.
//
// THE AUDIENCE RULING: `shared` is for everyone; `slices` are per-seat
// accountability (each person sees their own; owners see all). Private tasks
// are EXCLUDED from the model's input entirely — a briefing row is readable
// by all authenticated staff, so nothing private may enter it.
//
// The deterministic Flo statement on the dashboard remains the authority for
// NUMBERS (review counts, COD out). This briefing is the reader of free text
// and patterns — the prompt forbids inventing figures.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { normFloLines, type FloLine } from '@/lib/floLines'
import { isDue, isParked, overdueDays, isComingUp } from '@/lib/crm'
import type { Lead } from '@/lib/supabase'

// claude-sonnet-5: the current Sonnet (the dated 4-5 id 404'd on the new
// prsflow key, 2026-09-07). If Anthropic retires this id someday the symptom
// is the same 404 in the Brief-me-now error line — swap the id here.
const MODEL = 'claude-sonnet-5'

export type BriefingResult =
  | { ok: true; date: string; skipped?: string; lines?: number; inputs?: Record<string, number> }
  | { ok: false; error: string }

/** The 8:50 AM America/Los_Angeles day boundary, computed SERVER-SIDE.
 *  lib/time's opsToday() uses the runtime's local clock (fine in a browser in
 *  LA, wrong on a UTC server) — do not import it here. Same boundary; if the
 *  roll time ever moves, move it here AND in lib/time + the shift-note RLS. */
export function opsTodayLA(): string {
  const la = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  la.setMinutes(la.getMinutes() - (8 * 60 + 50))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${la.getFullYear()}-${p(la.getMonth() + 1)}-${p(la.getDate())}`
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

export function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function generateFloBriefing(opts: { force: boolean; source: string }): Promise<BriefingResult> {
  const db = serviceDb()
  const today = opsTodayLA()

  // Idempotent: the DST double-schedule (and any re-trigger) must not
  // overwrite a briefing people already read unless force is asked for.
  const existing = await db.from('flo_briefings').select('id').eq('date', today).limit(1)
  if (existing.data?.length && !opts.force) {
    return { ok: true, skipped: 'already written', date: today }
  }

  try {
    const yesterday = (() => {
      const d = new Date(today + 'T12:00:00Z')
      d.setUTCDate(d.getUTCDate() - 1)
      return d.toISOString().slice(0, 10)
    })()
    const weekOut = (() => {
      const d = new Date(today + 'T12:00:00Z')
      d.setUTCDate(d.getUTCDate() + 7)
      return d.toISOString().slice(0, 10)
    })()
    const since26h = new Date(Date.now() - 26 * 3600000).toISOString()
    const since8d = (() => {
      const d = new Date(today + 'T12:00:00Z')
      d.setUTCDate(d.getUTCDate() - 8)
      return d.toISOString().slice(0, 10)
    })()

    const [notes, runnerNotes, openFlags, closedFlags, holds, duties, entries, tasks, profiles, pipeLeads, demotions] =
      await Promise.all([
        db.from('myday_note_posts')
          .select('role, date, shift, session_notes, studio_notes, created_at, author:user_profiles(display_name)')
          .in('date', [yesterday, today])
          .order('created_at', { ascending: true }),
        db.from('runner_note_posts')
          .select('studio, author_name, role, source, text, created_at')
          .gte('created_at', since26h)
          .order('created_at', { ascending: true }),
        db.from('flags')
          .select('studio, source, source_label, runner_note, category, status, acknowledged_by, acknowledged_at, acknowledged_note, created_at')
          .is('deleted_at', null)
          .neq('status', 'resolved')
          .order('created_at', { ascending: true }),
        db.from('flags')
          .select('studio, runner_note, resolved_by, resolved_note, resolved_at')
          .is('deleted_at', null)
          .eq('status', 'resolved')
          .gte('resolved_at', since26h),
        db.from('bookings')
          .select('client_name, label, artist, start_date, end_date, location, studio, work_order_id')
          .eq('status', 'tentative')
          .gte('start_date', today)
          .lte('start_date', weekOut)
          .order('start_date', { ascending: true }),
        db.from('myday_duties')
          .select('id, role, label, cadence, due_days, always_available, created_at')
          .eq('is_active', true),
        db.from('myday_entries')
          .select('duty_id, date, completed_at')
          .gte('date', since8d),
        db.from('dashboard_tasks')
          .select('text, assigned_to, due_date, created_at')
          .eq('completed', false)
          .is('deleted_at', null)
          .eq('is_private', false),
        db.from('user_profiles')
          .select('id, display_name, role')
          .is('deleted_at', null),
        // CRM pipeline (2026-09-07): active leads for the overdue/coming-up
        // read, cold included only so demotion entries can resolve a name.
        db.from('leads')
          .select('*')
          .in('status', ['hot', 'warm', 'uncontacted', 'cold']),
        // Flo's own overnight demotions (auto-demote cron writes these).
        db.from('lead_activity')
          .select('lead_id, note, created_at')
          .eq('type', 'system')
          .gte('created_at', since26h),
      ])

    const firstErr = [notes, runnerNotes, openFlags, closedFlags, holds, duties, entries, tasks, profiles, pipeLeads, demotions]
      .find(r => r.error)?.error
    if (firstErr) throw firstErr

    const nameById = new Map((profiles.data ?? []).map(p => [p.id, p.display_name as string]))

    // Per-duty tick record over the last 8 days — the model reads the gaps,
    // it does not re-derive backlog math (the deterministic grid owns that).
    const ticksByDuty = new Map<string, string[]>()
    for (const e of entries.data ?? []) {
      if (!e.completed_at) continue
      const arr = ticksByDuty.get(e.duty_id) ?? []
      arr.push(e.date)
      ticksByDuty.set(e.duty_id, arr)
    }
    const dutyRecord = (duties.data ?? []).map(d => ({
      seat: d.role, duty: d.label, cadence: d.cadence,
      due_days: d.due_days, // weekly: 0=Sun…6=Sat · monthly: day-of-month · daily: null (Mon–Fri for both seats)
      ticked_dates_last_8_days: (ticksByDuty.get(d.id) ?? []).sort(),
    }))

    // Holds: bookings rows are projection cards — dedupe by work_order_id so
    // a three-room hold reads as one hold.
    const seen = new Set<string>()
    const holdList = (holds.data ?? []).filter(h => {
      const k = h.work_order_id || `${h.client_name}-${h.start_date}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).map(h => ({
      client: h.label || h.client_name, artist: h.artist,
      first_day: h.start_date, last_day: h.end_date, where: `${h.location} ${h.studio}`.trim(),
    }))

    // CRM pipeline read — deterministic math from lib/crm (the same predicates
    // the CRM page renders); the model reads these numbers, it never derives.
    const allLeads = (pipeLeads.data ?? []) as Lead[]
    const leadName = (l: Lead) =>
      [l.label, `${l.fname ?? ''} ${l.lname ?? ''}`.trim()].filter(Boolean).join(' / ') || `Lead ${l.id}`
    const nameByLeadId = new Map(allLeads.map(l => [l.id, leadName(l)]))
    const overdueLeads = allLeads
      .filter(l => (l.status === 'hot' || l.status === 'warm') && isDue(l) && !isParked(l))
      .map(l => ({ name: leadName(l), status: l.status, overdue_days: overdueDays(l) }))
      .sort((a, b) => b.overdue_days - a.overdue_days)

    const payload = {
      today,
      weekday: new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      office_shift_notes: (notes.data ?? []).map(n => {
        // PostgREST types an embedded FK row as an array; normalize either shape.
        const a = n.author as unknown as { display_name: string | null } | { display_name: string | null }[] | null
        const by = (Array.isArray(a) ? a[0]?.display_name : a?.display_name) ?? null
        return {
          seat: n.role, date: n.date, shift: n.shift, by,
          session_notes: n.session_notes, studio_notes: n.studio_notes,
        }
      }),
      runner_notes_last_26h: (runnerNotes.data ?? []).map(n => ({
        studio: n.studio, by: n.author_name, source: n.source, text: n.text, at: n.created_at,
      })),
      open_flags: (openFlags.data ?? []).map(f => ({
        studio: f.studio, category: f.category, status: f.status,
        note: f.runner_note, label: f.source_label,
        open_for_days: daysAgo(f.created_at),
        acknowledged: f.status === 'acknowledged'
          ? { by: f.acknowledged_by, days_ago: daysAgo(f.acknowledged_at), note: f.acknowledged_note }
          : null,
      })),
      flags_resolved_last_26h: (closedFlags.data ?? []).map(f => ({
        studio: f.studio, note: f.runner_note, by: f.resolved_by, how: f.resolved_note,
      })),
      holds_next_7_days: holdList,
      duty_record_last_8_days: dutyRecord,
      open_tasks: (tasks.data ?? []).map(t => ({
        task: t.text,
        assigned_to: t.assigned_to ? (nameById.get(t.assigned_to) ?? 'unknown') : 'unassigned',
        open_for_days: daysAgo(t.created_at),
        due: t.due_date,
      })),
      crm_pipeline: {
        overdue_follow_ups: overdueLeads,
        uncontacted_count: allLeads.filter(l => l.status === 'uncontacted').length,
        parked_coming_up_count: allLeads.filter(isComingUp).length,
        demoted_by_flo_last_26h: (demotions.data ?? []).map(d => ({
          lead: nameByLeadId.get(d.lead_id) ?? `Lead ${d.lead_id}`,
          what: d.note,
        })),
      },
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: MODEL,
      // 4000: the 1800 ceiling truncated a real briefing mid-JSON
      // ("Unexpected end of JSON input", 2026-09-07). Output is billed on
      // what's WRITTEN, not the ceiling — a normal briefing stays ~500.
      max_tokens: 4000,
      // Sonnet 5 THINKS by default (adaptive), and thinking spends the same
      // max_tokens budget — two ceiling hits in a row were her reasoning,
      // not the briefing. This is a read-and-report job: thinking off.
      thinking: { type: 'disabled' },
      system: `You are Flo, the operations briefer for Paramount Recording Studios (four buildings: Paramount, Ameraycan, Encore, Track — Hollywood, CA). Every morning at 8:50 you read the night's notes and the operational record and write the day's briefing.

VOICE — HEADLINES, NOT EXPLANATIONS (the standing ruling, amended 2026-09-07):
- A line is a tap on the shoulder: "this needs your attention." The reader taps through for the story — you point, you do not explain.
- Max 12 words per line. Fragments beat sentences: "Encore AC flag — day 4, nobody owns it."
- Name people, buildings and day counts plainly. No pep, no praise, no adjectives that carry opinion, no exclamation marks, no emoji.
- Never scold and never speculate about reasons. Plain text only — no markdown, no bullet characters, no headings inside lines.

WHAT YOU WRITE — strict JSON, nothing else:
{"shared": Line[], "slices": {"owner": Line[], "manager": Line[], "billing": Line[], "asst_manager": Line[]}}
A Line is {"text": string, "go": string} — "go" names where the reader acts on it, from EXACTLY this set (omit "go" when none fits):
"notes" = office shift notes · "runner-notes" = the runner channel · "flags" = the flags log · "holds" = the calendar · "tasks" = the task list · "crm" = leads

shared — 2 to 5 lines everyone sees: what the night's notes say that matters today, new or worsening flags, which holds need a follow-up call this week (name the client and the day), and the CRM pipeline: leads overdue for a follow-up (worst first — name and days overdue, go "crm") and any lead you demoted overnight — going cold is news, never silent. If two nights of notes mention the same problem, say so — patterns are the point.
slices.manager / slices.billing / slices.asst_manager — that seat's own outstanding record: duties whose due days went unticked (use the tick record and due_days; daily duties are due Monday–Friday only), tasks open past a few days, flags in their lane nobody owns. 1 to 3 lines each. If a seat is fully caught up, exactly one line: {"text": "Nothing outstanding."}
slices.owner — the cross-seat read for the owners: who is behind on what, repeated problems, anything aging that nobody owns. 2 to 4 lines.

RULES:
- The whole briefing stays under 120 words across all sections. One fact per line. When there is more than fits, keep the oldest and the worsening — drop the rest; the pages have the long tail.
- Use ONLY the data provided. Never invent a number, a name, or an event. If the data for a section is empty, write less, not filler.
- Do not restate dashboard numbers (review counts, money) — the dashboard computes those live; your value is reading the words.
- Weekends: duties are not due Saturday or Sunday. A gap on those days is not a miss.
- Dates in the data are the studio's operational days (the day rolls at 8:50 AM — overnight notes belong to the night before).`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    })

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Flo wrote past the token ceiling — raise max_tokens or tighten the prompt')
    }
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('')
    // Take the outermost {...} — armour against fences or a stray preamble.
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('Briefing came back with no JSON')
    const text = raw.slice(start, end + 1)
    const parsed = JSON.parse(text) as {
      shared: unknown
      slices: { owner?: unknown; manager?: unknown; billing?: unknown; asst_manager?: unknown }
    }
    if (!Array.isArray(parsed.shared) || typeof parsed.slices !== 'object' || !parsed.slices) {
      throw new Error('Briefing came back malformed')
    }
    // Normalize through the ONE shared shape (lib/floLines) — tolerates plain
    // strings, drops unknown go keys. What lands in the row is always FloLine[].
    const shared: FloLine[] = normFloLines(parsed.shared)
    const slices = {
      owner: normFloLines(parsed.slices.owner),
      manager: normFloLines(parsed.slices.manager),
      billing: normFloLines(parsed.slices.billing),
      asst_manager: normFloLines(parsed.slices.asst_manager),
    }

    const write = opts.force
      ? await db.from('flo_briefings').upsert(
          { date: today, model: MODEL, shared, slices },
          { onConflict: 'date' },
        )
      : await db.from('flo_briefings').insert(
          { date: today, model: MODEL, shared, slices },
        )
    if (write.error) throw write.error

    return {
      ok: true, date: today,
      lines: shared.length,
      inputs: {
        notes: payload.office_shift_notes.length,
        runner_notes: payload.runner_notes_last_26h.length,
        open_flags: payload.open_flags.length,
        holds: payload.holds_next_7_days.length,
        tasks: payload.open_tasks.length,
      },
    }
  } catch (err) {
    console.error('flo-briefing failed:', err)
    // Report into app_errors so the failure shows in Admin → Errors — a
    // missing briefing is silent otherwise (the dashboard just shows nothing).
    await db.from('app_errors').insert({
      message: `Flo briefing (${opts.source}): ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000),
      url: '/api/cron/flo-briefing',
      meta: { source: opts.source },
    }).then((): void => undefined, (): void => undefined)
    return { ok: false, error: String(err) }
  }
}
