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

/**
 * Staff lines that will be worked but never charged (RULING 2026-08-13).
 *
 * Eli: "I want there to be a notification that arises when there is an
 * engineering line that doesn't have a rate on it — noticing it's something we
 * have to manually enter and that can create errors."
 *
 * The rate is typed by hand on every line and there is no default any more (the
 * old $55 inheritance was removed the same day), so a forgotten rate is now the
 * likeliest way a session gets under-billed. It is silent by nature: the line
 * still shows a name and hours, and simply contributes $0 to the total.
 *
 * A WARNING, NOT A BLOCK — unlike missing times. A rateless staff line is
 * sometimes correct: an assistant is never rated on the work order (see the
 * runner WO page), and a line can legitimately be logged before the rate is
 * agreed. Refusing to complete would stop real work over a judgement call.
 *
 * Only flags lines that would otherwise BILL — the times have to be readable,
 * because a line with no times computes no hours and is already caught by
 * findMissingTimes.
 */
export function findMissingEngRates(
  rows: Array<ValidatableStudioRow & { eng_rate?: string | null }>,
): RowTimeProblem[] {
  const out: RowTimeProblem[] = []

  for (const r of rows) {
    if (!staffLineActive(r)) continue
    if ((r.eng_rate ?? '').trim()) continue
    // No readable clock → no hours → nothing to under-charge. That row's real
    // problem is its missing times, and it is reported there instead.
    if (badTime(r.eng_from_time) || badTime(r.eng_to_time)) continue

    const standalone = !r.studio || r.studio.trim() === ''
    const who = r.eng_role === 'engineer' ? '1ST' : '2ND'
    const place = standalone ? who : `Studio ${r.studio} · ${who}`
    out.push({
      rowId: r.id,
      where: `${whereDate(r.date)} · ${place}`,
      fields: [r.eng_name?.trim() || 'no name'],
    })
  }

  return out
}

/** One sentence for the warning banner. Null when every staff line has a rate. */
export function missingEngRatesMessage(problems: RowTimeProblem[]): string | null {
  if (problems.length === 0) return null
  const detail = problems.map(p => `${p.where} (${p.fields[0]})`).join(' · ')
  return problems.length === 1
    ? `One staff line has hours but no rate, so it will bill $0: ${detail}`
    : `${problems.length} staff lines have hours but no rate, so they will bill $0: ${detail}`
}

/**
 * The same person billed twice on the same day (RULING 2026-08-13).
 *
 * FOUND IN LIVE DATA (WO-1018, 29–30 July): each day had a studio row carrying
 * its staff sub-row AND a separate standalone staff row for the SAME engineer,
 * same rate, same hours. Both contribute to the engineer total, so the session
 * was billing that engineer twice — and on screen it just looks like two lines.
 *
 * Nothing creates this automatically. `+ Add Engineer` pre-fills the previous
 * staff line's name, rate and times as a convenience, so pressing it on a
 * session that already has that engineer on the studio row produces an exact
 * duplicate. Easy to do, invisible afterwards.
 *
 * A WARNING, not a block: two lines for one person on one day is legitimate
 * when someone genuinely worked two separate calls. Only the person looking at
 * it can tell, so it says what it found and leaves the decision alone.
 */
export function findDuplicateStaffLines(
  rows: Array<ValidatableStudioRow & { eng_rate?: string | null }>,
): RowTimeProblem[] {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

  // Staff carried by a STUDIO row — the sub-row. Keyed by date + person.
  const onStudioRow = new Set<string>()
  for (const r of rows) {
    const standalone = !r.studio || r.studio.trim() === ''
    if (standalone || r.eng_visible === false) continue
    if (!norm(r.eng_name)) continue
    onStudioRow.add(`${r.date ?? ''}|${norm(r.eng_name)}`)
  }

  const out: RowTimeProblem[] = []
  for (const r of rows) {
    const standalone = !r.studio || r.studio.trim() === ''
    if (!standalone || !norm(r.eng_name)) continue
    if (!onStudioRow.has(`${r.date ?? ''}|${norm(r.eng_name)}`)) continue
    out.push({
      rowId: r.id,
      where: whereDate(r.date),
      fields: [r.eng_name!.trim()],
    })
  }
  return out
}

/** One sentence for the duplicate-staff warning. Null when there are none. */
export function duplicateStaffMessage(problems: RowTimeProblem[]): string | null {
  if (problems.length === 0) return null
  const detail = problems.map(p => `${p.fields[0]} on ${p.where}`).join(' · ')
  return problems.length === 1
    ? `${detail} is on two lines for that day, so they will be charged twice. Delete one unless they really worked two calls.`
    : `${problems.length} staff lines are duplicates and will be charged twice: ${detail}. Delete the extras unless they really worked two calls.`
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
