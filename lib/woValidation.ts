// ─────────────────────────────────────────────────────────────────────────────
// lib/woValidation — the checks a work order must pass before it can be COMPLETED.
//
// RULING 2026-08-10 (Eli): "for any row, it's going to need start and end time.
// If it's left blank, we need a stop to completing the WO. A message and a
// highlight of the error, like most forms."
//
// WHY IT EXISTS: a row with no times still contributes money to the WO. The
// engineer charge falls back to a stored hours figure when the clock can't be
// read, so a blank-time row can quietly add cost to the Grand Total while
// showing "—" on screen. Rather than make that mismatch readable, this stops the
// bad data from being signed off at all — fix the cause, not the symptom.
//
// Deliberately a pure function in its own file, not a check inside the popup:
// the admin WO screen and the runner's Finish are two separate code paths to the
// same "this WO is done" decision, and they must not be able to disagree about
// what "done" requires.
//
// Blocks COMPLETING only. Saving is always allowed — a session in progress often
// has no end time yet, and refusing to save would lose the rest of someone's work.
// ─────────────────────────────────────────────────────────────────────────────

import { timeToMins } from '@/lib/time'

/** Only the fields the check looks at, so both the popup's form rows and raw DB rows fit. */
export type ValidatableStudioRow = {
  id: string
  studio?: string | null
  date?: string | null
  from_time?: string | null
  to_time?: string | null
  eng_visible?: boolean | null
  eng_name?: string | null
  eng_role?: 'engineer' | 'assistant' | null
  eng_from_time?: string | null
  eng_to_time?: string | null
}

export type RowTimeProblem = {
  rowId: string
  /** Human location for the message: "Aug 12 · Studio A" / "Aug 12 · 2ND". */
  where: string
  /** Which fields are missing or unreadable, in display order. */
  fields: string[]
}

/** Blank, whitespace, or something TimeInput could not parse. */
function badTime(t: string | null | undefined): boolean {
  if (!t || !t.trim()) return true
  return isNaN(timeToMins(t))
}

/** "2026-08-12" → "Aug 12". Falls back to "(no date)" so a row is still findable. */
function whereDate(iso: string | null | undefined): string {
  if (!iso) return '(no date)'
  const d = new Date(iso + 'T12:00:00')
  if (isNaN(d.getTime())) return iso
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`
}

/**
 * Is this row's staff line in play?
 *
 * A standalone staff row (studio === '') is nothing BUT a staff line, so always.
 * On a studio row it's the sub-row's visibility — `eng_visible: false` is what
 * `staff_mode: 'none'` seeds, and an unstaffed session must not be asked for
 * engineer hours. A named-but-rateless "engineer, TBD" IS staffed and does need
 * times (CLAUDE.md — a name is optional, the role is not).
 */
function staffLineActive(r: ValidatableStudioRow): boolean {
  const standalone = !r.studio || r.studio.trim() === ''
  if (standalone) return true
  return r.eng_visible !== false
}

/**
 * Every row missing a required time. Empty array means the WO can be completed.
 *
 * Rules:
 *   • A studio row needs its own From and To.
 *   • Any active staff line needs From and To (they mirror the session times on
 *     creation, so a blank here means something was actively cleared).
 *   • A standalone staff row has no session times of its own — only staff times
 *     are required.
 */
export function findMissingTimes(rows: ValidatableStudioRow[]): RowTimeProblem[] {
  const out: RowTimeProblem[] = []

  for (const r of rows) {
    const standalone = !r.studio || r.studio.trim() === ''
    const fields: string[] = []

    if (!standalone) {
      if (badTime(r.from_time)) fields.push('From')
      if (badTime(r.to_time)) fields.push('To')
    }

    if (staffLineActive(r)) {
      const who = r.eng_role === 'engineer' ? '1ST' : '2ND'
      if (badTime(r.eng_from_time)) fields.push(`${who} From`)
      if (badTime(r.eng_to_time)) fields.push(`${who} To`)
    }

    if (fields.length === 0) continue

    const place = standalone
      ? r.eng_role === 'engineer' ? '1ST' : '2ND'
      : `Studio ${r.studio}`
    out.push({ rowId: r.id, where: `${whereDate(r.date)} · ${place}`, fields })
  }

  return out
}

/** One sentence for the banner. Null when there is nothing wrong. */
export function missingTimesMessage(problems: RowTimeProblem[]): string | null {
  if (problems.length === 0) return null
  const detail = problems
    .map(p => `${p.where} (${p.fields.join(', ')})`)
    .join(' · ')
  return problems.length === 1
    ? `This work order can't be completed — one row is missing times: ${detail}`
    : `This work order can't be completed — ${problems.length} rows are missing times: ${detail}`
}
