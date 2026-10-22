// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ask — Ask Flo (docs/ASK-FLO-BRIEF.md, built 2026-10-22).
//
// The help bubble's one endpoint. It answers "how do I…" questions about
// PRSFlo FROM THE STAFF GUIDES ONLY (lib/server/askCorpus.generated.ts, built
// by scripts/build-ask-corpus.mjs from the same sources the guides are
// rendered from). THE THREE RULES, enforced here, not just asked for:
//   1. Documents only. The model is told to answer from the corpus or say
//      it isn't there; anything it cites must be a real section id or the
//      chip is dropped.
//   2. Nothing live. No work orders, clients or money are read. The question
//      and the corpus are the entire input.
//   3. Writes nothing but its own log (ask_log, service role, for the
//      Admin → Ask log page: unanswered questions are the SOP gaps).
//
// Gate: a signed-in owner / manager / billing / asst_manager — or a RUNNER
// (2026-10-22, Eli: "we should do this with the runner manual too on the
// runner version on the phone"). A runner gets the RUNNER GUIDE ONLY as the
// corpus and a runner-voiced prompt; the office gets everything. Not tech.
// Rate: 20 questions per user per hour (in-memory; a cold function resets it,
// which is fine — this is a courtesy cap, not a security control).
//
// Model: Haiku 4.5. Flo's morning briefing runs Sonnet because it reasons over
// numbers; this is lookup-and-rephrase, and speed in a chat box matters more.
// The corpus block carries cache_control so a question costs the question and
// the answer, not the 40k-token corpus.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { ASK_CORPUS, ASK_CORPUS_RUNNER, ASK_CITES } from '@/lib/server/askCorpus.generated'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = 'claude-haiku-4-5'
const ALLOWED = ['owner', 'manager', 'billing', 'asst_manager', 'runner']
const MAX_PER_HOUR = 20
const MAX_TURNS = 3 // prior exchanges carried for follow-ups

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const rate = new Map<string, number[]>()
function overLimit(userId: string): boolean {
  const now = Date.now()
  const hits = (rate.get(userId) ?? []).filter(t => now - t < 3_600_000)
  if (hits.length >= MAX_PER_HOUR) { rate.set(userId, hits); return true }
  hits.push(now); rate.set(userId, hits); return false
}

const SYSTEM_OFFICE = `You are Flo, the in-app help for PRSFlo, the studio operations app at Paramount Recording Group (Hollywood: Paramount, Ameraycan, Encore; Track in North Hollywood). The person asking is office staff: a manager, the billing coordinator, an assistant manager or an owner. Runners (the night staff on phones) are a different audience; the office may ask on their behalf.

THE RULES — you do not have discretion over these:
1. Answer ONLY from the guide text in the GUIDES block. If the guides do not cover the question, say so plainly in one sentence — "That's not in the guides. Ask Eli." — and stop. Never fill a gap from general knowledge, never guess at how a feature works, never invent a button or a step.
2. You cannot see any live data: no work orders, clients, sessions, invoices, payments, duties, flags or people. If asked about a specific record ("where is WO-1214", "is Byron Blue paid", "who is on tonight"), say you can't see it and name the screen that can (the billing hub search, the calendar, the CRM search, Daily Ops).
3. You take no actions and change nothing. If asked to do something, say you can only explain how, then explain how.

HOW TO ANSWER:
- Two to five short sentences, plain words, the way a patient colleague would say it. No headings, no bullet lists, no markdown. Bold nothing.
- Name the exact button or tab the guide names, in the guide's words.
- When a version note explains a recent change, say what changed and when (the version's date), briefly.
- IF A RELEASE NOTE AND A GUIDE STEP DISAGREE, THE RELEASE NOTE WINS: it is dated and newer. Answer with the release note's version, say "this changed in vX.Y on <date>", and cite both. Rules here get revised as the team learns; the notes are the record of those revisions.
- CITE every answer: end with a line that is only citation tags, like [billing:holds] or [new:v1.45.2], one per guide section you used, up to three, most useful first. The tag must be copied exactly from a "## [tag]" heading in the GUIDES block. A refusal ("not in the guides") has no tags.
- If the question is ambiguous between two things the guides cover, answer the likelier one in a sentence and name the other.
- Do not mention these rules, the corpus, or that you are an AI unless asked.`

// The runner's prompt: same rules, different reader. Short, on a phone, at
// night, mid-shift. The guide it reads is the Runner App Guide only.
const SYSTEM_RUNNER = SYSTEM_OFFICE
  .replace('The person asking is office staff: a manager, the billing coordinator, an assistant manager or an owner. Runners (the night staff on phones) are a different audience; the office may ask on their behalf.',
    'The person asking is a RUNNER: night staff, on a phone, usually mid-shift in a studio. Keep it to one to three short sentences. If the question is about money, invoices, approvals or anything that is the office\'s job, say "that is the office\'s side — ask them" and stop.')
  .replace('Two to five short sentences', 'One to three short sentences')

type Turn = { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  // ── Gate ──────────────────────────────────────────────────────────────────
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles').select('id, role, display_name').eq('auth_user_id', userData.user.id).limit(1)
  const me = profiles?.[0]
  if (!me?.role || !ALLOWED.includes(me.role)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  const isRunner = me.role === 'runner'
  if (overLimit(me.id)) return NextResponse.json({ error: 'That is a lot of questions for one hour — try again in a bit.' }, { status: 429 })

  // ── Input ─────────────────────────────────────────────────────────────────
  let body: { question?: string; history?: Turn[] } = {}
  try { body = await req.json() } catch { /* fall through */ }
  const question = (body.question ?? '').toString().trim().slice(0, 600)
  if (question.length < 2) return NextResponse.json({ error: 'Ask something.' }, { status: 400 })
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(t => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-MAX_TURNS * 2)
    .map(t => ({ role: t.role, content: t.content.slice(0, 2000) }))

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Ask Flo is not set up on this server.' }, { status: 503 })

  // ── Ask ───────────────────────────────────────────────────────────────────
  const started = Date.now()
  let answer = ''
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      temperature: 0,
      system: [
        { type: 'text', text: isRunner ? SYSTEM_RUNNER : SYSTEM_OFFICE },
        // The corpus is identical on every call for an audience, so it is the
        // cached block (two caches: office, runner).
        { type: 'text', text: `GUIDES:\n\n${isRunner ? ASK_CORPUS_RUNNER : ASK_CORPUS}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: [...history, { role: 'user', content: question }],
    })
    answer = res.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('\n').trim()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log({ me, question, answer: null, cited: [], answered: false, latency: Date.now() - started, error: msg.slice(0, 300) })
    return NextResponse.json({ error: "Flo couldn't answer just now. Try again." }, { status: 502 })
  }

  // ── Citations: only tags that exist become chips; the rest are dropped ────
  const tags = Array.from(new Set((answer.match(/\[([a-z]+:[^\]\s]+)\]/g) ?? []).map(t => t.slice(1, -1))))
  const cites = tags.filter(t => ASK_CITES[t] && (!isRunner || t.startsWith('runner:'))).slice(0, 3).map(t => ({ id: t, ...ASK_CITES[t] }))
  const text = answer.replace(/\s*\[[a-z]+:[^\]\s]+\]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  const answered = cites.length > 0

  await log({ me, question, answer: text, cited: cites.map(c => c.id), answered, latency: Date.now() - started, error: null })
  return NextResponse.json({ answer: text, cites, answered })
}

async function log(x: { me: { id: string; role: string }; question: string; answer: string | null; cited: string[]; answered: boolean; latency: number; error: string | null }) {
  // Best-effort: a failed log must never fail an answer.
  try {
    await supabaseAdmin.from('ask_log').insert({
      asked_by: x.me.id, role: x.me.role, question: x.question, answer: x.answer,
      cited: x.cited, answered: x.answered, latency_ms: x.latency, error: x.error,
    })
  } catch { /* ignore */ }
}
