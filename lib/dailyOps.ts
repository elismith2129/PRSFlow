// Daily Ops data layer — spec §19. One place that answers "did last night go
// right", so the page stays presentation and the rules live here.
//
// Deliberately NOT included (each has an owner elsewhere, one copy of
// everything): work orders → Billing's review bucket; punches → HR; tonight's
// live status → the dashboard.
import { supabase } from '@/lib/supabase'

export const OPS_STUDIOS = [
  { key: 'paramount', label: 'Paramount', abbr: 'PRS' },
  { key: 'ameraycan', label: 'Ameraycan', abbr: 'ARS' },
  { key: 'encore',    label: 'Encore',    abbr: 'ERS' },
  { key: 'track',     label: 'Track',     abbr: 'TRK' },
] as const

/**
 * Studios that exist but are NOT being staffed right now (Eli, 2026-08-31:
 * Track is on a long-term lease).
 *
 * This is a DISPLAY state, not a deletion. Every code path still runs for a
 * dormant studio — if someone does submit a checklist there it records and
 * shows normally. What changes is that its duties read 'dormant' instead of
 * 'missing', and it raises no absence rows, because a room nobody is rostered
 * to work cannot fail to do its checklist. Take Track out of this array the day
 * it is staffed again and everything returns to normal with no other edit.
 */
export const DORMANT_STUDIOS: string[] = ['track']

export const isDormantStudio = (key: string) => DORMANT_STUDIOS.includes(key)

/** The five things a studio owes every night, in the order the sweep shows them. */
export const DUTIES = [
  { key: 'opening_checklist', label: 'Opening' },
  { key: 'closing_checklist', label: 'Closing' },
  { key: 'mic_inventory',     label: 'Mic inventory' },
  { key: 'petty_cash',        label: 'Petty cash' },
  { key: 'stock',             label: 'Stock' },
] as const

export type DutyState = {
  key: string
  label: string
  /** done = submitted · missing = never came in · flagged = came in with a problem */
  // 'pending' is TODAY ONLY (2026-08-31): the day is still running, so a duty
  // that hasn't come in yet is not an absence. Red is reserved for a day that
  // is OVER and still has a hole in it — the whole point of the queue.
  // 'dormant' is a studio nobody is rostered to (DORMANT_STUDIOS).
  state: 'done' | 'missing' | 'flagged' | 'pending' | 'dormant'
  detail: string
}

// One per author-shift since 2026-08-26 (shift_note_docs — the big-field
// notes replaced the timestamped shift_log_entries log, which was never
// adopted). `created_at` carries the doc's updated_at for display.
export type ShiftEntry = {
  id: string
  author_name: string
  role: string | null
  text: string
  created_at: string
}

export type StudioNight = {
  studio: string
  label: string
  abbr: string
  who: string
  duties: DutyState[]
  entries: ShiftEntry[]
}

export type QueueItem = {
  /** Stable identity — half the daily_ops_reviews key. Never rename these. */
  key: string
  severity: 'hot' | 'warm'
  title: string
  sub: string
  abbr: string
  /** Flags clear by acknowledging the flag itself, not a review row (§19). */
  flagId?: string
  reviewed: boolean
}

/** Yesterday's local calendar date — the night this page is about. */
export function opsDate(offsetDays = 1): string {
  const d = new Date()
  d.setDate(d.getDate() - offsetDays)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export function prettyDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/**
 * Everything the page needs for one night, in one pass.
 *
 * The queue's ordering IS the ruling: flags first, then ABSENCES (a submission
 * that never came in is the loudest signal there is and used to be invisible),
 * then missing mics, then attention notes.
 */
export async function loadNight(date: string): Promise<{ queue: QueueItem[]; studios: StudioNight[] }> {
  // Today is a day IN PROGRESS, not a day that failed (Eli, 2026-08-31 — the
  // page can now page forward to today). Nothing has come in yet at 2pm, so
  // every unsubmitted duty reads 'pending' instead of 'missing', and the
  // absence rows are kept OUT of the queue entirely: "never submitted · find
  // out why before the next shift" is a lie about a shift that hasn't happened,
  // and twenty of them would train everyone to ignore the queue. Real signals —
  // flags, missing mics, attention notes — still surface today, because those
  // are true the moment they are raised.
  const isToday = date === opsDate(0)
  const [
    { data: subs },
    { data: checklists },
    { data: cash },
    { data: stock },
    { data: micRows },
    { data: mics },
    { data: micSubs },
    { data: flags },
    { data: logs },
    { data: secNotes },
    { data: reviews },
  ] = await Promise.all([
    supabase.from('daily_ops_submissions').select('*').eq('date', date),
    supabase.from('checklists').select('*').eq('date', date),
    supabase.from('petty_cash_entries').select('studio, amount, type').eq('date', date),
    supabase.from('stock_items').select('studio, item, low'),
    supabase.from('mic_checkins').select('mic_id, studio, status, room').eq('date', date),
    supabase.from('mics').select('id, name').eq('is_active', true),
    supabase.from('mic_inventory_submissions').select('studio, submitted_by, submitted_at').eq('date', date),
    supabase.from('flags').select('*').eq('status', 'pending').is('deleted_at', null),
    supabase.from('shift_note_docs').select('*').eq('date', date).neq('text', '').order('created_at'),
    supabase.from('runner_section_notes').select('*').eq('date', date).neq('text', '').order('created_at'),
    supabase.from('daily_ops_reviews').select('item_key').eq('date', date),
  ])

  const seen = new Set((reviews ?? []).map((r: any) => r.item_key))
  const micName = (id: string) => (mics ?? []).find((m: any) => m.id === id)?.name ?? 'Mic'
  const queue: QueueItem[] = []
  const studios: StudioNight[] = []

  // ── Flags (hot, always first). They clear by acknowledgement, not a review row.
  for (const f of flags ?? []) {
    const abbr = OPS_STUDIOS.find(s => s.key === (f.studio ?? '').toLowerCase())?.abbr ?? (f.studio ?? '—')
    queue.push({
      key: `flag:${f.id}`,
      severity: 'hot',
      title: f.runner_note ? `Flag — ${f.runner_note}` : 'Flag raised',
      sub: f.source_label ?? 'Runner flag',
      abbr,
      flagId: f.id,
      reviewed: false,
    })
  }

  for (const s of OPS_STUDIOS) {
    // A dormant studio behaves exactly like today: nothing is late, because
    // nobody is scheduled. Real submissions still render if they arrive.
    const dormant = isDormantStudio(s.key)
    const unfinished = isToday || dormant
    const sSubs = (subs ?? []).filter((r: any) => r.studio === s.key)
    const submitted = (cat: string) => sSubs.find((r: any) => r.category === cat && r.submitted_at)
    const sChecklists = (checklists ?? []).filter((r: any) => r.studio === s.key)
    const sMicSub = (micSubs ?? []).find((r: any) => r.studio === s.key)
    const sEntries = ((logs ?? []) as any[])
      .filter(r => r.studio === s.key && (r.text ?? '').trim() !== '')
      .map(r => ({ id: r.id, author_name: r.author_name, role: r.role ?? null, text: r.text, created_at: r.updated_at ?? r.created_at }))
    // The stock/office/mics general-notes boxes ride along as pseudo-entries
    // so the office reads them in the same notes popup (2026-08-28).
    const SEC_LABEL: Record<string, string> = { stock: 'Stock list', office: 'Office list', mics: 'Mic inventory' }
    for (const n of ((secNotes ?? []) as any[]).filter(r => r.studio === s.key && (r.text ?? '').trim() !== '')) {
      sEntries.push({
        id: n.id, author_name: SEC_LABEL[n.section] ?? n.section, role: null,
        text: n.text, created_at: n.updated_at ?? n.created_at,
      })
    }

    const duties: DutyState[] = DUTIES.map(d => {
      // Checklists are recorded under two category spellings historically
      // ('opening' from the hub tiles, 'opening_checklist' from the page).
      if (d.key === 'opening_checklist' || d.key === 'closing_checklist') {
        const type = d.key.startsWith('opening') ? 'opening' : 'closing'
        const cl = sChecklists.find((r: any) => r.type === type && r.completed_at)
        const sub = submitted(`${type}_checklist`) ?? submitted(type)
        const at = cl?.completed_at ?? sub?.submitted_at
        if (!at) return { key: d.key, label: d.label, state: dormant ? 'dormant' : isToday ? 'pending' : 'missing', detail: dormant ? 'not staffed' : isToday ? 'not yet' : 'never submitted' }
        const attention = cl?.needs_attention
        return {
          key: d.key, label: d.label,
          state: attention ? 'flagged' : 'done',
          detail: new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        }
      }
      if (d.key === 'mic_inventory') {
        const missing = (micRows ?? []).filter((r: any) => r.studio === s.key && r.status === 'missing')
        if (!sMicSub?.submitted_at) return { key: d.key, label: d.label, state: dormant ? 'dormant' : isToday ? 'pending' : 'missing', detail: dormant ? 'not staffed' : isToday ? 'not yet' : 'not done' }
        if (missing.length) return { key: d.key, label: d.label, state: 'flagged', detail: `${missing.length} missing` }
        const counted = (micRows ?? []).filter((r: any) => r.studio === s.key).length
        return { key: d.key, label: d.label, state: 'done', detail: `${counted} checked` }
      }
      if (d.key === 'petty_cash') {
        if (!submitted('petty_cash')) return { key: d.key, label: d.label, state: dormant ? 'dormant' : isToday ? 'pending' : 'missing', detail: dormant ? 'not staffed' : isToday ? 'not yet' : 'not done' }
        const rows = (cash ?? []).filter((r: any) => r.studio === s.key)
        const net = rows.reduce((t: number, r: any) => t + (r.type === 'in' ? 1 : -1) * (Number(r.amount) || 0), 0)
        return { key: d.key, label: d.label, state: 'done', detail: `${rows.length} entries · ${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(0)}` }
      }
      // stock
      if (!submitted('stock')) return { key: d.key, label: d.label, state: dormant ? 'dormant' : isToday ? 'pending' : 'missing', detail: dormant ? 'not staffed' : isToday ? 'not yet' : 'not done' }
      const low = (stock ?? []).filter((r: any) => r.studio === s.key && r.low).length
      return low
        ? { key: d.key, label: d.label, state: 'flagged', detail: `${low} low` }
        : { key: d.key, label: d.label, state: 'done', detail: 'OK' }
    })

    // Absences → the queue, hot. This is the signal that had no home before.
    for (const d of unfinished ? [] : duties.filter(x => x.state === 'missing')) {
      const key = `missing:${s.key}:${d.key}`
      queue.push({
        key, severity: 'hot',
        title: `${s.label} ${d.label.toLowerCase()} never submitted`,
        // "next shift", not "tonight" — 24/7 terminology ruling (Eli, 2026-08-17).
        sub: 'Nothing came in — find out why before the next shift',
        abbr: s.abbr,
        reviewed: seen.has(key),
      })
    }
    // Missing mics → the queue, hot, one row per mic so each is answered.
    for (const m of (micRows ?? []).filter((r: any) => r.studio === s.key && r.status === 'missing')) {
      const key = `mic:${s.key}:${m.mic_id}`
      queue.push({
        key, severity: 'hot',
        title: `${micName(m.mic_id)} marked MISSING`,
        sub: 'Mic inventory',
        abbr: s.abbr,
        reviewed: seen.has(key),
      })
    }
    // Checklist attention notes that didn't already become a pending flag.
    for (const cl of sChecklists.filter((r: any) => r.needs_attention && r.needs_attention_notes)) {
      const alreadyFlagged = (flags ?? []).some((f: any) => f.source_id === cl.id)
      if (alreadyFlagged) continue
      const key = `note:${cl.id}`
      queue.push({
        key, severity: 'warm',
        title: `Note — “${cl.needs_attention_notes}”`,
        sub: `${cl.type === 'opening' ? 'Opening' : 'Closing'} checklist`,
        abbr: s.abbr,
        reviewed: seen.has(key),
      })
    }

    studios.push({
      studio: s.key,
      label: s.label,
      abbr: s.abbr,
      who: Array.from(new Set([
        ...sChecklists.map((r: any) => r.staff_name).filter(Boolean),
        ...sEntries.map(r => r.author_name),
        sMicSub?.submitted_by,
      ].filter(Boolean))).join(', ') || '—',
      duties,
      entries: sEntries,
    })
  }

  // Hot before warm; within a severity, keep insertion order (flags, absences,
  // mics, notes) — that IS the urgency ladder.
  queue.sort((a, b) => Number(b.severity === 'hot') - Number(a.severity === 'hot'))
  return { queue, studios }
}

export async function markReviewed(date: string, itemKey: string, by: string) {
  return supabase.from('daily_ops_reviews').insert({ date, item_key: itemKey, reviewed_by: by })
}

export async function unmarkReviewed(date: string, itemKey: string) {
  return supabase.from('daily_ops_reviews').delete().eq('date', date).eq('item_key', itemKey)
}
